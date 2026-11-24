#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRunnerArgs, runClaude } from '../clear-explain/run-explain.mjs';
import { serializeResults } from '../review-loop/run-detection.mjs';
import { pool, readEvidence } from '../verify/run-benchmark.mjs';
import { ACT, LINK, leadStarts, withoutLeftOut } from './clauses.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const PLUGINS = ['review-loop', 'verify', 'clear-explain'].map((name) => path.join(repoRoot, 'plugins', name));
const SCRIPTS = {
  loop: path.join(repoRoot, 'plugins/review-loop/skills/review-loop/scripts/loop.mjs'),
  verify: path.join(repoRoot, 'plugins/verify/skills/verify/scripts/verify.mjs'),
  'check-clarity': path.join(repoRoot, 'plugins/clear-explain/skills/clear-explain/scripts/check-clarity.mjs'),
};
export const ALLOWED_TOOLS = [
  'Skill', 'Agent', 'Read', 'Grep', 'Glob', 'Write', 'Edit', 'TodoWrite',
  ...Object.values(SCRIPTS).map((script) => `Bash(node ${script.split(path.sep).join('/')}:*)`),
];
const FORBIDDEN_CHARS = new RegExp(`[${String.fromCharCode(0x2014, 0xb7)}]`);

const usage = `Usage: node evals/e2e/run-sessions.mjs [options]

Builds a small git repository per scenario (one commit and an uncommitted change), runs one
headless claude -p session there with the review-loop, verify, and clear-explain plugins loaded
and no user settings, and checks the session's tool calls and the scripts' saved state in
.git/lim/ against what the skills say should happen. Uses your Claude account.

  --scenario <name>     run only this scenario (repeatable): NAMES
  --model <name>        model (default: claude-opus-5-5)
  -j, --concurrency <n> sessions at once (default: 1)
  --label <text>        added to the results file name
  --keep                keep the temporary repositories and each session's raw stream
`;

export function labelOf(name, input = {}, workDir = '') {
  if (name === 'Bash') {
    const call = scriptCall(input.command);
    return call ? `${call.script} ${call.args}`.trim() : `Bash ${input.command}`;
  }
  if (name === 'Agent' || name === 'Task') return `Agent ${input.subagent_type ?? ''}`.trim();
  if (name === 'Skill') return `Skill ${input.skill ?? input.command ?? ''}`.trim();
  const file = input.file_path ?? input.notebook_path ?? input.path;
  if (file) return `${name} ${workDir && file.startsWith(`${workDir}/`) ? file.slice(workDir.length + 1) : file}`;
  return name;
}

export function scriptCall(command) {
  const match = /^\s*node\s+"?([^\s"]*?\/(loop|verify|check-clarity)\.mjs)"?(?:\s+(.*))?$/s.exec(String(command ?? ''));
  return match ? { script: match[2], path: match[1], args: (match[3] ?? '').trim() } : null;
}

export function sessionTimeline(events, workDir = '') {
  const results = new Map();
  for (const event of events) {
    if (event.type !== 'user') continue;
    for (const block of event.message?.content ?? []) {
      if (block.type !== 'tool_result') continue;
      const text = Array.isArray(block.content) ? block.content.map((part) => part.text ?? '').join('\n') : String(block.content ?? '');
      results.set(block.tool_use_id, { isError: Boolean(block.is_error), output: text });
    }
  }
  const final = events.findLast((event) => event.type === 'result');
  const denied = new Set((final?.permission_denials ?? []).map((denial) => denial.tool_use_id));
  const timeline = [];
  for (const event of events) {
    if (event.type !== 'assistant') continue;
    const parent = event.parent_tool_use_id ?? null;
    for (const block of event.message?.content ?? []) {
      if (block.type === 'text' && !parent) timeline.push({ kind: 'text', text: block.text });
      if (block.type !== 'tool_use') continue;
      const result = results.get(block.id);
      timeline.push({
        kind: 'tool', id: block.id, parent, tool: block.name, input: block.input ?? {}, label: labelOf(block.name, block.input, workDir),
        isError: result?.isError ?? null, output: result?.output ?? null, denied: denied.has(block.id),
      });
    }
  }
  return timeline;
}

export function buildSession(events, repo = {}) {
  const timeline = sessionTimeline(events, repo.workDir ?? '');
  const final = events.findLast((event) => event.type === 'result') ?? null;
  return {
    timeline,
    steps: timeline.filter((item) => item.kind === 'tool' && !item.parent),
    subagentSteps: timeline.filter((item) => item.kind === 'tool' && item.parent),
    finalMessage: String(final?.result ?? ''),
    final,
    ledger: repo.ledger ?? [],
    reviewState: repo.reviewState ?? null,
    verify: repo.verify ?? { runs: 0, latest: {} },
    changedFiles: repo.changedFiles ?? [],
    commits: repo.commits ?? 1,
    files: repo.files ?? {},
  };
}

const short = (text, length = 160) => String(text ?? '').replace(/\s+/g, ' ').slice(0, length);

export function inOrder(steps, patterns) {
  const matched = [];
  let from = 0;
  for (const pattern of patterns) {
    const index = steps.findIndex((step, position) => position >= from && pattern.test(step.label));
    if (index === -1) {
      return { pass: false, evidence: `${matched.join(' -> ') || 'nothing matched'}; then no step matches ${pattern}` };
    }
    matched.push(`#${index} ${short(steps[index].label, 60)}`);
    from = index + 1;
  }
  return { pass: true, evidence: matched.join(' -> ') };
}

function found(steps, pattern, what) {
  const index = steps.findIndex((step) => pattern.test(step.label));
  return { pass: index !== -1, evidence: index === -1 ? `no ${what}` : `#${index} ${short(steps[index].label)}` };
}

function none(steps, pattern, what) {
  const result = found(steps, pattern, what);
  return { pass: !result.pass, evidence: result.evidence };
}

export function reportShownAfter(session, pattern, { lastOnly = false } = {}) {
  const runs = session.timeline.flatMap((item, index) => (item.kind === 'tool' && !item.parent && pattern.test(item.label) && !item.isError ? [index] : []));
  if (!runs.length) return { pass: false, evidence: `no successful step matches ${pattern}` };
  const results = (lastOnly ? runs.slice(-1) : runs).map((index) => reportFollows(session.timeline, index));
  return results.find((result) => !result.pass) ?? results.at(-1);
}

function reportFollows(timeline, index) {
  const rest = timeline.slice(index + 1);
  const textAt = rest.findIndex((item) => item.kind === 'text' && item.text.trim());
  const toolAt = rest.findIndex((item) => item.kind === 'tool' && !item.parent);
  if (textAt === -1) return { pass: false, evidence: 'no text after it' };
  const text = rest[textAt].text;
  const toolFirst = toolAt !== -1 && toolAt < textAt;
  return {
    pass: text.trimStart().startsWith('```') && !toolFirst,
    evidence: `next text: "${short(text, 80)}"${toolFirst ? `; a tool ran first: ${short(rest[toolAt].label, 80)}` : ''}`,
  };
}

const ledgerEvents = (session, kind) => session.ledger.filter((entry) => entry.event === kind);
const findingsOf = (state) => (state ? [...(state.resolved ?? []), ...(state.open ?? []), ...(state.cards ?? []), ...(state.deferred ?? [])] : []);
const isBlocking = (item) => item.severity === 'P1' || item.severity === 'P2';

const noQuestions = { id: 'no-question', text: 'never calls AskUserQuestion', check: (s) => none(s.steps, /^AskUserQuestion/, 'AskUserQuestion') };
const noCommit = {
  id: 'no-commit-or-push',
  text: 'does not commit or push',
  check: (s) => {
    const attempt = none(s.steps, /^Bash .*git\s+(commit|push)\b/, 'git commit or push');
    return { pass: attempt.pass && s.commits === 1, evidence: `${attempt.evidence}; commits in the repository: ${s.commits}` };
  },
};
const endsWithSummary = {
  id: 'ends-with-summary',
  text: 'runs loop summary as the last loop command',
  check: (s) => {
    const last = s.steps.filter((step) => /^loop /.test(step.label)).at(-1);
    if (last?.label !== 'loop summary') return { pass: false, evidence: `last loop command: ${last ? short(last.label) : 'none'}` };
    return { pass: true, evidence: last.label };
  },
};

export function reportNotPastedAfter(session, pattern) {
  const runs = session.timeline.flatMap((item, index) => (item.kind === 'tool' && !item.parent && pattern.test(item.label) && !item.isError ? [index] : []));
  if (!runs.length) return { pass: true, evidence: `no successful step matches ${pattern}` };
  for (const index of runs) {
    const rest = session.timeline.slice(index + 1);
    const textAt = rest.findIndex((item) => item.kind === 'text' && item.text.trim());
    const toolAt = rest.findIndex((item) => item.kind === 'tool' && !item.parent);
    if (textAt === -1 || (toolAt !== -1 && toolAt < textAt)) continue;
    const text = rest[textAt].text;
    if (text.trimStart().startsWith('```')) {
      return { pass: false, evidence: `pasted after ${short(session.timeline[index].label)}: "${short(text, 80)}"` };
    }
  }
  return { pass: true, evidence: `no pasted report after ${runs.length} match(es)` };
}

const hookOwnsLoopReports = {
  id: 'hook-owns-loop-reports',
  text: 'does not paste a loop report the hook already shows',
  check: (s) => reportNotPastedAfter(s, /^loop (record\b|summary$)/),
};

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DOTTED_NAME = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+/g;
const OFFER_OPENER = String.raw`\b(?:want me to|would you like|should i|shall i|can i|i can(?!['’]t)|i could|you could|you may want to|if you want|if you'd like|let me know if|happy to)\b`;
const OFFER_TO_ACT = String.raw`${OFFER_OPENER}.{0,40}\b(?:fix|delete|remove|change|update|edit|drop|strip|clean up)\b[^;,]{0,60}`;
const OFFER_CUE = String.raw`\b(?:if you(?:['’]d| would)? (?:like|prefer|want)|let me know|just say the word)\b`;
const PASSIVE_ACT = String.raw`\b(?:could|can|may|might|should|would)(?:\s+(?:still|also|always|easily|just))?\s+be\s+(?:fixed|deleted|removed|changed|updated|edited|dropped|stripped|cleaned up)\b`;

const DONE = 'fixed|deleted|removed|changed|updated|edited|dropped|stripped|cleaned up';
const LEAD = String.raw`(?:^|[:\[]")[\s*_>•-]*`;
const PUSH = String.raw`(?:\?|\bbefore (?:committing|you commit|the commit)\b)`;
const NEAR = String.raw`(?:(?!\b(?:and|or|but|not)\b)[^;,]){0,20}?`;
const GAP = String.raw`(?:(?!\b(?:nothing|no|not|none)\b)[^;,:?]){0,40}?`;
const MODAL = 'should|shall|could|can|would|may|might|must';
const DUE = String.raw`\b(?:${MODAL}|ought to|needs? to|has to|is to|are to)(?:\s+(?:still|also|always|easily|just|really))?\s+be\s+(?:${DONE})\b`;
const OPENING = String.raw`(?:(?:and|but|so|then|also|still)[,\s]+)?`;
const ONE = String.raw`(?!(?:when|where|why|how|what|which|who|whether|if|then|so|not|now|later|it|its|their|i|we|you|keep|leave|commit|${ACT}|${MODAL}|move|go|proceed|continue|skip|ship|merge|do|add|rerun|run|decide|push|[a-z]+ing)\b|[\w-]+\s+(?:it|this|that|them|these|those|on|up|later)\b)[a-z][\w-]*`;
const FINDING_NOUN = 'check|coverage|flake|script|cleanup|deadlock|leak|race|condition|bug|typo|timeout';
const PLURAL = String.raw`(?:these|those)\s+two|them|these|those|both`;
const WHOLE = String.raw`all\s+of\s+(?:them|these|those)|the\s+two|all|everything`;
const FOLLOW = String.raw`findings|issues|now|first|then|too|again|perhaps|always|afterwards|as\s+well|(?:this|that)\s+(?:time|round|week|way)`;
const NOT_NOUN = 'findings|issues|bugs|things|plus|perhaps|sometimes|besides|across|versus|thus|minus|whereas|overseas|thanks|cheers|pls|yours|ours|hers|theirs|his|its|this|towards|backwards|forwards|afterwards|upwards|downwards|onwards|inwards|outwards|always|sideways|anyways|nowadays|less|unless|regardless|nevertheless|nonetheless|doubtless|indoors|outdoors|upstairs|downstairs';
const TAIL = String.raw`(?:before|after|during|until|in)\s+(?:the|this|that|our|your|next)\s+[\w-]+(?:\s+[\w-]+)?\s*\?`;
const BARE = String.raw`${ONE}(?:\s+[a-z][\w-]*)?`;
const TASK_VERB = 'send|translate|write|publish|refactor|rename|notify|announce|ask|tell|share|discuss|explain|verify|investigate|inspect|revisit|bump|rebase|squash|revert|rewrite|reword|rework|recheck|retest|finish|try|see|make|create|let';
const NOUNS = String.raw`(?!(?:${NOT_NOUN})\b)[a-z][\w-]+s\b`;
const MODIFIER = String.raw`(?!(?:${NOT_NOUN}|${LINK})(?![\w-]))[a-z][\w-]*`;
const NARROW = 'but|except|without|excluding|unlike|than|not|only|just|even|beyond|inside|outside|near|off|out|up|down|behind|like|still|following|pending|later';
const OTHER = String.raw`(?:(?:the|this|that|your|a|an|another)\s+(?!(?:[\w-]+\s+){0,2}(?:it|this|that|them|these|those)\b)[^\s?;,]+(?:\s+[^\s?;,]+){0,2}\s*\?|[A-Z]+-\d+\b|\x60[^\x60]|(?=[\w$]*(?:[._][\w$]|\())[a-z_$])`;
const FORMER = String.raw`(?:(?:the|this|that|your|a|an|another)\s+(?:[\w-]+\s+){0,2}[\w-]+|[A-Z]+-\d+|[._\x60(][\w$\x60)]+|(?<=\b(?:about|with|for)\s+)${BARE}|(?<=\bat\s+)${ONE})`;
const SUBJECT = String.raw`(?:(?:the|this|that|your)\s+)?(?:[\w-]+\s+)?`;
const REACH = String.raw`(?:(?!\b(?:and|or|but|not|nothing|no|none)\b)[^;,:?"]){0,40}?`;
const HOLD = String.raw`(?:(?!\b(?:and|or|but|not|while|whereas|though|although|unless|until|if|when|once|since|because)\b)[^;,]){0,20}?`;
const MARK = String.raw`[\s*_>•-]*`;
const BESIDE = String.raw`(?<!\b(?:near|next\s+to|beside|alongside|around|above|below|after|before|behind|under)\s+(?:(?:the|this|that|your|a|an)\s+)?(?:[\w-]+\s+)?)`;
const SAID = 'said|says|noted|notes|flagged|flags|suggested|suggests|recommended|recommends|found|thought|thinks|wrote|reported|reports|asked|wanted|wants|raised|mentioned|argued';
const VOICE = String.raw`\b(?:(?:reviewer|review|finding|report)\s+(?:(?:also|had|has)\s+)?(?:${SAID})|you\s+(?:said|answered|noted|wrote|mentioned)|(?:according\s+to|per)\s+(?:the\s+|your\s+)?(?:reviewer|review|finding|report)|reviewer['’]s\s+[\w-]+)\b`;
const SPEAKER_CHANGE = String.raw`(?=\S)(?<=[,;:.!?—–]\s*|\b(?:but|so|and|then)\s+)(?:(?:i\s+ask(?:ed)?|let\s+me\s+ask|i\s+wonder(?:ed)?|i(?:['’]d|\s+would)\s+ask)\b|(?<!${VOICE},\s*)my\s+(?:own\s+)?(?:question|take)\s+(?:is|was)\b)(?<!(?:(?<![\w.!?,])'|(?<!\w)‘)(?!\s)(?:[^'’\n]|\b['’]\b)*)`;
const QUOTED = String.raw`(?<!${VOICE}(?:(?:(?!${SPEAKER_CHANGE})[^"“]){0,30}|(?:(?!${SPEAKER_CHANGE})[^"“.?!,;:\n]){0,80}[:,]\s*)(?:\\?["“][^"”]*|(?:(?<![\w.!?,])'|(?<!\w)‘)(?!\s)(?:[^'’]|\b['’]\b)*))`;
const REPORTED = String.raw`(?<!${VOICE}(?:(?!\bbut\b|${SPEAKER_CHANGE}${QUOTED})[^;])*)`;
const TURN = String.raw`(?:${LEAD}|(?:${QUOTED}[,;]|[,;]\\?["”'’]${QUOTED}|${SPEAKER_CHANGE}${QUOTED}\s*:(?:\s*\\?["“'‘])?)\s*)${OPENING}`;
const DENIED = String.raw`(?<!(?:\bnot|n['’]t|\bnever)\s+(?:(?!(?:and|but|or)\b)[\w-]+\s+){0,4})`;
const DAY = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday';
const DAYPART = 'morning|afternoon|evening|night';
const COUNT = String.raw`an?|one|two|three|four|five|six|seven|eight|nine|ten|\d+|a\s+few|a\s+couple\s+of|several`;
const WHEN = String.raw`so|too|before|first|again|just\s+now|earlier(?:\s+today)?|today|tonight|yesterday(?:\s+(?:${DAYPART}))?|(?:on\s+)?(?:${DAY})(?:\s+(?:${DAYPART}))?|(?:last|this)\s+(?:${DAYPART}|week|weekend|month|${DAY})|(?:${COUNT})\s+(?:minutes?|hours?|days?|nights?|weeks?|months?|rounds?|reviews?)\s+(?:ago|back|earlier|before)|in\s+(?:the\s+)?(?:previous|last|first|earlier)\s+(?:review|round)|in\s+round\s+\d+`;
const CREDIT = String.raw`[^;,]{0,60}[,(]\s*(?:as\s+)?(?:the\s+)?${VOICE}(?:\s+(?:${WHEN}))?`;
const CREDITED = String.raw`(?!${CREDIT}\s*(?:[,.;)!?]|$))`;
const INCLUDING = String.raw`,\s*(?:including|plus|and\s+also|as\s+well\s+as|along\s+with|together\s+with)\s+(?:(?:the|this|that|your)\s+)?`;
const TAG = String.raw`,?\s+(?:too|as\s+well)\b`;
const NOT_VERB = String.raw`its|yes|besides|sometimes|always|perhaps|[a-z]*(?:wards|ways|adays)`;
const HEAD_NOUN = 'calls|statements|lines|logs|entries|usages|uses|references|occurrences|instances|messages|outputs|prints|imports|tests|checks|comments|leftovers|ones|findings|issues|things|bugs';
const OBJECT_LEAD = 'the|a|an|this|its|their|our|your|my';
const BY_TIME = `deadline|cutoff|end|time|way|next|weekend|${DAYPART}|${DAY}`;
const QUANTIFIER = 'each|every|all|some|no';
const VERB_LIKE = String.raw`(?!(?:${NOT_VERB})\b)[a-z]+[b-hj-rtv-z]s\b`;
const ASIDE = String.raw`(?:\s*,\s*(?:as|per|like|at|by)\s[^;,.?!]{1,40},)?`;
const OBJECT_END = String.raw`(?!${ASIDE}\s+(?:(?:(?:still|also|just|now)\s+)?(?:stays?|remains?|is|are|was|were|will|would|can|could|should|shall|must|may|might|has|have|had|does|do|did|gets?|keeps?|sits?|lives?|goes|seems?|looks?)\b|(?:still|also|just|now)\s+${VERB_LIKE}|(?!(?:${HEAD_NOUN})\b)${VERB_LIKE}(?!\s*\?)|(?:${HEAD_NOUN})\s+(?!(?:${OBJECT_LEAD}|${QUANTIFIER})\s+[\w$\x60.-]+(?:\s+[\w$\x60.-]+)?\s+(?:${SAID}|[a-z]+ed)(?![\w-])(?!\s+by\s+(?:${OBJECT_LEAD})\s+(?!(?:${BY_TIME})(?![\w-]))[\w$\x60]))(?:(?:${OBJECT_LEAD})\s+(?:[\w$\x60]|(?:["“][^"”?\n]*["”]|['‘][^'’?\n]*['’])\s*(?:[.!]|$))|(?:these|those)\s+${NOUNS}(?=\s*(?:[.!?;]|$)|\s+[a-z]+ed\s+by\s+(?:${OBJECT_LEAD})\s+(?!(?:${BY_TIME})(?![\w-]))[\w$\x60])|(?:${QUANTIFIER})\s+(?!(?:${LINK}|across|along|above|below)(?![\w-]))[\w$\x60]|["“'‘\x60])))`;
const AND_TOO = String.raw`,\s*and\s+(?:(?:the|this|that|your)\s+)?`;
const BOUND = String.raw`(?:(?:still|also|just|now)\s+)?(?:(?:need|have|want)\s+to\s+)?`;
const AGREE = String.raw`(?:(?:yes|ok|okay|sure)[,\s]+)?`;
const ITEM = String.raw`(?<=^[\s>]*(?:[*•–—-]|\d+[.)])\s+(?:[A-Z]+-\d+\s+)?(?:\[\w+\]\s+)?(?:\S+:\d+\s+)?)`;
const LISTED = String.raw`(?<=[\])(:"'\`*_•–—-]\s*|:\d+\s+)`;
const LIST_PREFIX = /^[\s>]*(?:[*•–—-]|\d+[.)])\s+(?:[A-Z]+-\d+\s+)?(?:\[\w+\]\s+)?(?:\S+:\d+\s+)?/;
const KEPT_LISTING = /^[\s>#*_]*(?:kept as is(?:\s+at\s+your\s+request)?|[^\n]*\byou\s+kept\s+before\s+(?:was|were)\s+raised\s+again(?:,\s*including)?):[\s*_]*$/i;

function offersToAct(anchor, segment, own = segment) {
  const name = `(?<![\\w$.-])${anchor}(?![\\w$-]|\\.[\\w$])`;
  const act = `(?:(?:just|also|still)\\s+)?(?:${ACT})\\s+`;
  const lead = '(?:the|this|that|your|our|a|an)\\s+';
  const ident = `(?!(?:${LINK})\\b)[a-z][\\w-]*(?:\\.[a-z][\\w-]*)*`;
  const word = `(?:[\\x60]${ident}[\\x60]|${ident})`;
  const thing = `${word}(?:\\s+${word}){0,2}`;
  const kept = `(?:[\\x60*_"“]*${name}[\\x60*_"”]*|['‘]${name}['’])`;
  const later = '(?:\\s+(?:now|first|later|today|too|again|also|as\\s+well|for\\s+you|right\\s+away|instead))*';
  const first = `(?:${lead})?(?:${word}\\s+)?${kept}`;
  const second = `(?:${lead})?${thing}${later}\\s+and\\s+(?:${act}${first}|(?:${lead}(?:${word}\\s+)?)?${kept})`;
  const more = `(?:\\s+and\\s+(?:${act}(?:${lead})?|${lead})${thing}${later})?`;
  const closing = `${OPENING}(?:(?:i|we)(?:\\s+will|['’]ll)|we\\s+(?:can|could))\\s+${act}(?:${first}|${second})${later}${more}\\s*,?\\s*(?:${OFFER_CUE}|\\bif\\s+(?:that|it)\\s+helps\\b)\\s*[.!?]?\\s*$`;
  return new RegExp(`${OFFER_TO_ACT}(?:${BESIDE}${anchor}|${INCLUDING}${anchor}${OBJECT_END}|${AND_TOO}${anchor}(?=${TAG}))`, 'i').test(segment)
    || new RegExp(`${BESIDE}${anchor}[^;,]{0,40}${PASSIVE_ACT}[^;]{0,60}${OFFER_CUE}`, 'i').test(segment)
    || new RegExp(`${OFFER_CUE}[^;]{0,20}${BESIDE}${anchor}[^;,]{0,40}${PASSIVE_ACT}`, 'i').test(segment)
    || new RegExp(`${LEAD}(?:(?:and|or|so|then|also|maybe|still)\\s+)?(?=(?:${ACT})\\b)${GAP}${BESIDE}${anchor}[^;,]{0,60}?${PUSH}`, 'i').test(segment)
    || new RegExp(`(?:\\b(?:would you (?:like|prefer)|do you (?:want|need))\\b|${LEAD}want\\b|${OFFER_CUE})${NEAR}${BESIDE}${anchor}${NEAR}\\b(?:${DONE})\\b`, 'i').test(segment)
    || new RegExp(`${LEAD}${OPENING}${SUBJECT}${anchor}${NEAR}${DUE}${CREDITED}[^;,]{0,60}?${PUSH}`, 'i').test(segment)
    || new RegExp(`${TURN}(?:${MODAL})(?:n['’]t)?\\b(?:${NEAR}${BESIDE}${anchor}${NEAR}\\bbe\\s+(?:${DONE})\\b|\\s+(?:i|we|you)\\s+${BOUND}(?=(?:${ACT})\\b)${REACH}${BESIDE}${anchor})`, 'i').test(segment)
    || new RegExp(`${TURN}(?:(?:is|are|do|does)(?:n['’]t)?\\b${NEAR}${BESIDE}${anchor}${NEAR}\\bto\\s+be\\s+(?:${DONE})\\b|(?:do|does)(?:n['’]t)?\\s+(?:i|we|you)\\s+${BOUND}(?=(?:${ACT})\\b)${REACH}${BESIDE}${anchor})`, 'i').test(segment)
    || new RegExp(`${REPORTED}${DENIED}${BESIDE}${anchor}${HOLD}${DUE}${CREDITED}`, 'i').test(own)
    || new RegExp(`^${MARK}${closing}`, 'i').test(own)
    || leadStarts(own).some((at) => new RegExp(`^\\s+${closing}`, 'i').test(own.slice(at)))
    || offersAfterCredit(anchor, own);
}

const SENTENCE_BREAK = new RegExp(String.raw`((?<=[.?!])(?<!(?:^|\n)[ \t>]*\d+\.)${QUOTED}(?!(?<=${OFFER_OPENER}.{0,40}\b(?:${ACT})\s*:?\s*["“][^"”]*)[^"”\n]*\s+(?:["'](?=\S)|[“‘]))\s+)`, 'i');
const SENTENCE_END = new RegExp(`${SENTENCE_BREAK.source}$`, 'i');
const OWN_TURN = String.raw`(?:[.?!]\s+|,\s*(?=(?:but|so)\b(?:[^"“”‘’']|(?<=\w)['’](?=\w))*?\b(?:i|me|my|we|us|our)\b))(?=\S)|(?=${SPEAKER_CHANGE})`;
const LINE_TOKEN = new RegExp(String.raw`(?<voice>${VOICE})|(?<mine>${OWN_TURN})|(?=(?<open>["“‘]|(?<!\w)')?)(?=(?<shut>["”]|[’'](?!\w))?)["“”‘’']`, 'gi');
const QUOTE_ENDS = { '"': '"”', '“': '"”', '‘': '’', "'": "'" };
const POSSESSIVE = new RegExp(String.raw`^\ws'[ \t]+(?!(?:${LINK})\b)\w(?:(?!\n\s*\n)(?:[^']|(?<=\w)'(?=\w)))*?(?<=\S)'(?!\w)`, 'i');
const OFFERED_ACT = new RegExp(String.raw`${OFFER_OPENER}.{0,40}\b(?:${ACT})\s*$`, 'i');
const OFFER_OPENS = new RegExp(OFFER_OPENER, 'i');

function blocksOf(prose) {
  const blocks = [];
  let [start, from, startsLine, quote, theirs] = [0, 0, true, '', false];
  for (const gap of prose.matchAll(/\n\s*/g)) {
    const to = gap.index + gap[0].length;
    if (to === prose.length) break;
    let [reviewer, cut, heard] = [false, -1, 0];
    for (const found of prose.slice(from, gap.index).matchAll(LINE_TOKEN)) {
      const { voice, mine, open, shut } = found.groups;
      const at = from + found.index;
      if (quote) {
        if (shut && QUOTE_ENDS[quote].includes(shut) && !(quote === "'" && POSSESSIVE.test(prose.slice(at - 2)))) quote = '';
      } else if (open) [quote, theirs] = [open, reviewer && !OFFER_OPENS.test(prose.slice(heard, at))];
      else if (voice) [reviewer, cut, heard] = [true, -1, at + voice.length];
      else if (mine !== undefined && reviewer) [reviewer, cut] = [false, at + mine.length];
    }
    const ended = Boolean(quote) && theirs && gap[0].includes('\n', 1);
    if (ended) quote = '';
    const text = prose.slice(start, gap.index);
    const quoteNext = /["“'‘]/.test(prose[to]);
    from = to;
    if (quote ? quoteNext || (theirs && !UNQUOTED_END.test(text)) : quoteNext && !ended && (!reviewer || /[:,]\s*$/.test(text) || OFFERED_ACT.test(prose.slice(heard, gap.index)))) {
      if (!quote && reviewer) [quote, theirs, from] = [prose[to], true, to + 1];
      else if ((!quote || !(theirs || gap[0].includes('\n', 1))) && cut !== -1) {
        blocks.push([prose.slice(start, cut).trimEnd(), startsLine]);
        [start, startsLine] = [cut, false];
      }
    } else {
      blocks.push([text.replace(SENTENCE_END, ''), startsLine]);
      [start, startsLine, quote] = [to, true, ''];
    }
  }
  return [...blocks, [prose.slice(start), startsLine]];
}

const lineSegmentsOf = (prose) => blocksOf(prose).flatMap(([block, startsLine]) => block.split(SENTENCE_BREAK).flatMap((part, index, parts) => (index % 2 ? [] : [[part, index ? parts[index - 1].includes('\n') : startsLine]])));
const segmentsOf = (prose) => lineSegmentsOf(prose).map(([part]) => part);

const TITLE_SKIP = new Set([...LINK.split('|'), ...ACT.split('|'), 'the', 'a', 'an', 'this', 'that', 'these', 'those', 'is', 'are', 'was', 'were', 'be', 'it', 'its']);
const LINKS = new Set(LINK.split('|'));
const stem = (word) => (word.length > 3 ? word.replace(/(?<![sui])s$/, '').replace(/e$/, '') : word);
function phrasesOf(text) {
  return String(text ?? '').toLowerCase().split(/[?.!,;:()\n]/).flatMap((part) => {
    const phrases = [{ words: [], afterLink: false }];
    for (const word of part.match(/[a-z0-9_$]+(?:\.[a-z0-9_$]+)*/g) ?? []) {
      if (LINKS.has(word)) phrases.push({ words: [], afterLink: true });
      else if (word.length > 1 && !TITLE_SKIP.has(word)) phrases.at(-1).words.push(stem(word));
    }
    return phrases.filter((phrase) => phrase.words.length);
  });
}
const titleWords = (text) => phrasesOf(text).flatMap((phrase) => phrase.words);

function otherFindings(session, kept) {
  const ids = new Set(kept.map((item) => item.id).filter(Boolean));
  const titles = new Set(kept.map((item) => item.title));
  const keptWords = new Set(kept.flatMap((item) => titleWords(item.title)));
  const recorded = [...['open', 'resolved', 'cards', 'deferred', 'kept'].flatMap((list) => session.reviewState?.[list] ?? []), ...ledgerEvents(session, 'decision')];
  const others = recorded.filter((item) => item.title && !ids.has(item.id) && !titles.has(item.title));
  return [...new Set(others.map((item) => item.title))].map((title) => new Set(titleWords(title).filter((word) => !keptWords.has(word))));
}

const namesFinding = (others, phrase) => others.some((words) => phrase.words.every((word) => words.has(word)));
const namesOther = (others, text) => phrasesOf(text).some((phrase) => namesFinding(others, phrase));
const askedAboutOther = (others, question) => {
  const object = phrasesOf(question).find((phrase) => phrase.afterLink);
  return object !== undefined && namesFinding(others, object);
};

function optionActs(anchor, question, others = []) {
  const options = Array.isArray(question?.options) ? question.options : [];
  const choices = options.flatMap((option) => [option?.label, option?.description]).flatMap((text) => segmentsOf(String(text ?? '')));
  const direct = new RegExp(`^${MARK}${AGREE}(?=(?:${ACT})\\b)${REACH}${BESIDE}${anchor}`, 'i');
  if ([...segmentsOf(String(question?.header ?? '')), ...choices].some((text) => direct.test(text))) return true;
  const due = new RegExp(`${REPORTED}${DENIED}${BESIDE}${anchor}${HOLD}${DUE}${CREDITED}`, 'i');
  if (choices.some((text) => due.test(text))) return true;
  const asked = `${question?.header ?? ''}\n${question?.question ?? ''}`;
  const named = new RegExp(`${BESIDE}${anchor}`, 'i').test(asked);
  const code = `\\x60?${anchor}\\x60?`;
  const coordinated = [
    ...[...asked.matchAll(/\b(?:and|or)\s+([^?.!;\n]+)/gi)].map((found) => found[1]),
    new RegExp(`([^?.!;\\n]+?)\\s*,?\\s+(?:and|or)\\s+(?:(?:the|this|that|your)\\s+)?${code}`, 'i').exec(asked)?.[1],
  ];
  const askedAbout = String(question?.question ?? '');
  const elsewhere = !new RegExp(`${BESIDE}${anchor}`, 'i').test(askedAbout) && askedAboutOther(others, askedAbout);
  const paired = others.length ? elsewhere || coordinated.some((phrase) => phrase !== undefined && namesOther(others, phrase)) : new RegExp(`${FORMER}\\s*,?\\s+(?:and|or)\\s+(?:(?:the|this|that|your)\\s+)?${code}|${code}\\s*,?\\s*(?:and|or)\\s+(?:${OTHER}|(?!(?:${TASK_VERB})(?![\\w-]))(?:${BARE}(?:\\s+(?:first|too|as\\s+well))?\\s*\\?|(?=${BARE}\\s+${TAIL})(?:[a-z][\\w-]*\\s+)?(?:${FINDING_NOUN})\\s+${TAIL}))`, 'i').test(asked);
  const wholeBefore = (next) => `(?:${WHOLE})\\b(?=[\\s.!]*$|\\s*,|\\s+(?:${next})\\b(?![-'’]))`;
  const pronoun = new RegExp(`^${MARK}${AGREE}(?:${ACT})\\b(?:\\s+(?:it|this|that|them|these|those)\\b|\\s+${wholeBefore(FOLLOW)}|[\\s.!]*$)`, 'i');
  const plural = new RegExp(`^${MARK}${AGREE}(?:${ACT})\\b\\s+(?:(?:${PLURAL})\\b(?!\\s+(?:(?:the|your|of(?!\\s+(?:them|these|those)\\b)|two)\\b|${NOUNS}|(?:of\\s+(?:these|those)\\s+(?:${MODIFIER}\\s+)?|${MODIFIER}\\s+)${NOUNS}(?=[\\s.!]*$)))|${wholeBefore(`${FOLLOW}|(?!(?:${NARROW})\\b)(?:${LINK})`)})`, 'i');
  return named && choices.some((text) => (paired ? plural : pronoun).test(text));
}

function restatedTitles(records) {
  const texts = records.flatMap((item) => [item.title, item.quote]).map((text) => String(text ?? '').trim()).filter((text) => new RegExp(DUE, 'i').test(text));
  const exact = (text) => text.split('\x60').map((part) => escapeRegex(part).replace(/\s+/g, '\\s+')).join('\\x60?');
  const loose = (text) => `\\x60?${escapeRegex(text.replace(/\x60/g, '')).replace(/\s+/g, '\\x60?\\s+\\x60?').replace(/^[A-Za-z]/, (letter) => `[${letter.toUpperCase()}${letter.toLowerCase()}]`)}`;
  return texts.length ? new RegExp(`(?:${LISTED}(?:${texts.map(exact).join('|')})|${ITEM}(?:${texts.map(loose).join('|')}))`, 'g') : null;
}

function actsOn(anchors, records, segments, questions, others = []) {
  const listed = restatedTitles(records);
  let underKept = false;
  const spare = (text) => withoutLeftOut(String(text ?? ''), anchors);
  const asked = questions.map((question) => ({ header: spare(question?.header), question: spare(question?.question), options: (Array.isArray(question?.options) ? question.options : []).map((option) => ({ label: spare(option?.label), description: spare(option?.description) })) }));
  const pairs = segments.map(([segment, startsLine]) => {
    const prefix = segment.match(LIST_PREFIX)?.[0];
    if (prefix === undefined && (startsLine || KEPT_LISTING.test(segment))) underKept = KEPT_LISTING.test(segment);
    if (!listed) return [spare(segment), spare(segment)];
    if (prefix === undefined || underKept) return [spare(segment), spare(segment.replace(listed, ' '))];
    const lead = segment.slice(prefix.length).match(/^[\s"'“‘\x60*_]*/)[0];
    return [spare(segment), spare(prefix + lead + segment.slice(prefix.length + lead.length).replace(listed, ' '))];
  });
  return anchors.some((anchor) => pairs.some(([segment, own]) => offersToAct(anchor, segment, own)) || asked.some((question) => optionActs(anchor, question, others)));
}

const ADVERB = 'still|also|always|really|just|now|definitely|probably|certainly|clearly|obviously|surely|likely|perhaps|maybe|actually|honestly|simply|truly|indeed';
const DUE_SUBJECT = new RegExp(String.raw`^(?:(the|a|an|this|that|your)\s+)?(.+?)(?:\s+(?:${ADVERB}))*\s+${DUE}`, 'i');

const CLAUSE = 'if|when|unless|because|since|and|or|but|so|then|which|while|though|although|once|until|whether|before|after|as|whenever|till';

function subjectAnchor(text) {
  const found = text.match(DUE_SUBJECT);
  const subject = (found?.[2] ?? '').replace(/\x60/g, '');
  if (subject.length < (found?.[1] ? 2 : 3) || /^(?:it|this|that|these|those|they|them)$/i.test(subject)) return [];
  const words = escapeRegex(subject).replace(/\s+/g, '\\x60?\\s+\\x60?');
  return [`(?<![\\w$./-]\\x60?)${words}(?!\\x60?[./-]?\\x60?[\\w$])(?!\\x60?['’]s\\b)(?!\\x60?(?:\\s+(?!(?:${ADVERB}|${CLAUSE})(?![\\w-]))[\\w\\x60-]+)+(?:\\s+(?:${ADVERB}))*\\s+${DUE})`];
}

function keptAnchors(records) {
  const texts = records.flatMap((item) => [item.title, item.quote]).map((text) => String(text ?? '').trim().replace(/[;,]+$/, ''));
  const files = records.map((item) => item.file ?? '').join('\n');
  const names = texts.flatMap((text) => text.match(DOTTED_NAME) ?? []).filter((name) => !files.includes(name));
  const whole = (text) => (names.includes(text) ? `(?<![\\w$])${escapeRegex(text)}(?=s?(?![\\w$]))` : escapeRegex(text).replace(/\s+/g, '\\s+'));
  const anchors = [...new Set([...texts, ...names])].filter((text) => text.length >= 6).map(whole);
  return [...new Set([...anchors, ...texts.flatMap(subjectAnchor)])];
}

function keepStep(session, id) {
  const keepOf = new RegExp(`--id[= ]${escapeRegex(id)}(?:\\s|$)`);
  const decides = session.timeline.flatMap((item, index) => (item.kind === 'tool' && !item.parent && /^loop decide\b/.test(item.label) && item.isError !== true ? [index] : []));
  const keeps = decides.filter((index) => /^loop decide\b.*--choice keep\b/.test(session.timeline[index].label) && keepOf.test(session.timeline[index].label));
  const confirmed = keeps.filter((index) => session.timeline[index].isError === false);
  return (confirmed.length ? confirmed : keeps.length ? keeps : decides)[0] ?? -1;
}

function proseAfterKeep(session, id) {
  const keepAt = keepStep(session, id);
  if (keepAt === -1) return session.finalMessage ?? '';
  return proseFrom(session, keepAt + 1);
}

function questionsFrom(session, start) {
  return session.timeline.slice(start)
    .filter((item) => item.kind === 'tool' && !item.parent && item.tool === 'AskUserQuestion')
    .flatMap((item) => (Array.isArray(item.input?.questions) ? item.input.questions : []));
}

function messagesFrom(session, start) {
  const after = session.timeline.slice(start).flatMap((item) => {
    if (item.kind === 'text') return [item.text];
    if (item.kind === 'tool' && !item.parent && item.tool === 'AskUserQuestion') return [JSON.stringify(item.input ?? {})];
    return [];
  });
  return [...after, session.finalMessage ?? ''];
}

function proseFrom(session, start) {
  return messagesFrom(session, start).join('\n');
}

const LEGACY_ACT = 'fix|delete|remove|change|update|edit';
const OFFER_TAIL = String.raw`\?|\b(?:but|unless|until|yet|though|however|if you|let me know|want me|happy to)\b`;
const REFUSED = String.raw`(?<!\b(?:can['’]t|cannot|won['’]t|will\s+not)\s+)`;
const STILL_OFFERS = String.raw`(?=.*(?:${OFFER_TAIL}))`;
const UNCHANGED = String.raw`(?!\s+(?:stays?|remains?)\s+(?:unchanged|untouched|as\s+is)\s+before committing\b(?!.*(?:${OFFER_TAIL}|\b(?:${LEGACY_ACT})\b)))`;
const LATER_OFFER = new RegExp(String.raw`\?|\b(?:want me|should i|shall i|let me know|if you|happy to)\b|${REFUSED}\b(?:${LEGACY_ACT})\b`, 'i');
const FINDING_ID = /\b[A-Z]+-\d+\b/g;
const PRONOUN_TAIL = String.raw`(?:\s+(?:first|right\s+now)\b)*(?:(?=\s*(?:[.?!,;:)](?![.\w])|$))|\s+(?:for\s+you|later|now|too|again|instead|then|please|before|after|if\s+you|when\s+you|as\s+well|yourself|today|tomorrow|soon|here|without|in\s+the\s+next)\b)`;
const PRONOUN = String.raw`(?:it|(?:that|this)(?:\s+one)?)\b${PRONOUN_TAIL}`;
const QUOTE_CREDITED = String.raw`(?![^;]{0,60}?[,?!]["”’']\s*(?:as\s+)?(?:the\s+)?${VOICE})`;
const CANNOT = String.raw`(?<!\bcannot\s+(?:(?!(?:and|but|or)\b)[\w-]+\s+){0,4})`;
const PRONOUN_OFFER = new RegExp(String.raw`${REPORTED}${QUOTED}${DENIED}${CANNOT}\b(?:you could|you can|i can|i could|want me to|like me to|should i|shall i|can i|happy to|if you want|if you['’]d like)\b(?:\s+(?:just|also|still))?\s+(?:${LEGACY_ACT})\s+${PRONOUN}${CREDITED}${QUOTE_CREDITED}|${REPORTED}${QUOTED}${DENIED}${CANNOT}\b(?:it|that one|this one)\s+(?:could|can|may|might|should)\s+(?:still\s+)?be\s+(?:fixed|deleted|removed|changed|updated|edited)\b${CREDITED}${QUOTE_CREDITED}`, 'i');
const PRONOUN_OFFER_NEXT = new RegExp(`^(?:(?:would|do)\\s+you\\s+)?(?:${PRONOUN_OFFER.source})`, 'i');

function offersAfterCredit(anchor, own) {
  const credited = new RegExp(`${REPORTED}${QUOTED}${BESIDE}${anchor}${HOLD}${DUE}${CREDIT}\\s*(?:[,;)]\\s*)+(?:(?:and|but|so|or|then)\\s+)*`, 'gi');
  return [...own.matchAll(credited)].some((found) => PRONOUN_OFFER_NEXT.test(own.slice(found.index + found[0].length)));
}
const idsIn = (text) => text.match(FINDING_ID) ?? [];
const UNQUOTED_END = new RegExp(String.raw`${QUOTED}$`, 'i');
const pronounOffer = (id, part, next) => idsIn(part).includes(id) && idsIn(part).every((found) => found === id) && !idsIn(next).length && UNQUOTED_END.test(part) && PRONOUN_OFFER.test(next);

export function keptNotReoffered(session) {
  const keptRecords = [
    ...ledgerEvents(session, 'decision').filter((entry) => entry.choice === 'keep' && entry.id),
    ...(session.reviewState?.kept ?? []).filter((item) => item.id),
    ...['open', 'cards', 'deferred'].flatMap((list) => session.reviewState?.[list] ?? []).filter((item) => item.id && item.decision === 'keep'),
  ];
  const keptIds = [...new Set(keptRecords.map((item) => item.id))];
  const keptBefore = [...new Map((session.reviewState?.kept ?? []).filter((item) => !item.id && item.title).map((item) => [item.fingerprint ?? item.title, item])).values()];
  if (!keptIds.length && !keptBefore.length) return { pass: true, evidence: 'no kept findings' };
  const askText = session.steps
    .filter((step) => step.tool === 'AskUserQuestion')
    .map((step) => JSON.stringify(step.input ?? {}))
    .join('\n');
  const prose = [
    session.finalMessage ?? '',
    ...session.timeline.filter((item) => item.kind === 'text').map((item) => item.text),
    askText,
  ].join('\n');
  const reoffered = keptIds.filter((id) => {
    const legacy = new RegExp(`(?:fix|delete|remove|change|update|edit).{0,60}${id}\\b|${id}\\b.{0,60}(?:before committing|you could|or delete|or fix)`, 'i');
    const offer = new RegExp(`(?:${REFUSED}|${STILL_OFFERS}|(?=(?:${LEGACY_ACT})\\b.*${REFUSED}\\b(?:${LEGACY_ACT})\\b))(?:${LEGACY_ACT}).{0,60}${id}\\b|${id}\\b(?:.{0,60}(?:you could|or delete|or fix)|${UNCHANGED}.{0,60}before committing)`, 'i');
    const listedKeep = new RegExp(`kept as is[\\s\\S]{0,120}${id}\\b|${id}\\b[\\s\\S]{0,80}kept`, 'i');
    const keepAt = keepStep(session, id);
    const reoffers = (texts) => texts.some((text, at) => segmentsOf(text).some((part, index, parts) => offer.test(part) || (legacy.test(part) && LATER_OFFER.test([...parts.slice(index + 1), ...texts.slice(at + 1)].join('\n'))) || (keepAt !== -1 && pronounOffer(id, part, parts[index + 1] ?? ''))) && !listedKeep.test(text));
    const offered = keepAt === -1
      ? (offer.test(prose) || reoffers([prose])) && !listedKeep.test(prose)
      : reoffers(messagesFrom(session, keepAt + 1));
    if (offered) return true;
    const records = keptRecords.filter((item) => item.id === id);
    const others = otherFindings(session, records);
    const anchors = [...keptAnchors(records), `\\b${escapeRegex(id)}\\b`];
    const questions = keepAt === -1 ? [] : questionsFrom(session, keepAt + 1);
    return actsOn(anchors, records, lineSegmentsOf(proseAfterKeep(session, id)), questions, others);
  });
  const sessionSegments = lineSegmentsOf(proseFrom(session, 0));
  const sessionQuestions = questionsFrom(session, 0);
  const reofferedBefore = keptBefore.filter((item) => actsOn(keptAnchors([item]), [item], sessionSegments, sessionQuestions, otherFindings(session, [item])));
  const named = (items) => items.map((item) => `"${item.title}"`);
  const failed = [...reoffered, ...named(reofferedBefore)];
  return {
    pass: failed.length === 0,
    evidence: failed.length ? `re-offered: ${failed.join(', ')}` : `kept settled: ${[...keptIds, ...named(keptBefore)].join(', ')}`,
  };
}

const keptSettled = {
  id: 'kept-not-reoffered',
  text: 'does not offer to fix a finding recorded as keep',
  check: keptNotReoffered,
};

function resolvedReproduced(session) {
  const resolved = session.reviewState?.resolved ?? [];
  const item = resolved.find((finding) => finding.reproduced);
  if (!item) return { pass: false, evidence: `resolved: ${resolved.map((finding) => `${finding.id} ${finding.severity}`).join(', ') || 'none'}; none reproduced` };
  return {
    pass: item.rerun?.status === 'pass',
    evidence: `${item.id} ${item.severity} "${short(item.title, 70)}": reproduced by ${item.reproduced.check} failing, rerun ${item.rerun?.status ?? 'none'}`,
  };
}

function regressionFor(session, filter) {
  const blocking = (session.reviewState?.resolved ?? []).filter((item) => isBlocking(item) && filter(item));
  if (!blocking.length) return { pass: false, evidence: 'no resolved P1 or P2 of this kind' };
  const proofs = ledgerEvents(session, 'regression');
  const missing = blocking.filter((item) => !proofs.some((entry) => entry.id === item.id));
  const shown = proofs.map((entry) => `${entry.id}: ${entry.proof ?? `no test (${short(entry.reason, 80)})`}`).join('; ') || 'none';
  return { pass: missing.length === 0, evidence: missing.length ? `no regression entry for ${missing.map((item) => item.id).join(', ')}; ledger: ${shown}` : shown };
}

function secondReviewClean(session) {
  const records = ledgerEvents(session, 'record');
  const last = records.at(-1);
  if (!last) return { pass: false, evidence: 'no record in the ledger' };
  return { pass: records.length >= 2 && last.decision === 'stop' && last.reason === 'clean', evidence: `${records.length} records; last: round ${last.round} ${last.decision} ${last.reason ?? ''}` };
}

const changedOnly = (allowed) => (s) => {
  const extra = s.changedFiles.filter((file) => !allowed.some((pattern) => pattern.test(file)));
  return { pass: extra.length === 0, evidence: `${extra.length ? `unexpected: ${extra.join(', ')}; ` : ''}changed: ${s.changedFiles.join(', ') || 'nothing'}` };
};

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const FINDING_BASES = ['measured', 'inferred', 'guessed'];
const REVIEW_FILE = /\.lim-review\/round-\d+\.json$/;

export function findingBasisLabeled(session) {
  const writes = session.timeline.filter((item) => item.kind === 'tool' && item.tool === 'Write' && REVIEW_FILE.test(item.input?.file_path ?? ''));
  if (!writes.length) return { pass: false, evidence: 'no review file written' };
  for (const write of writes) {
    const name = path.basename(write.input.file_path);
    const review = parseJson(write.input.content);
    if (!review || !Array.isArray(review.findings)) return { pass: false, evidence: `${name}: not a review` };
    for (const [index, finding] of review.findings.entries()) {
      const label = finding?.id ?? `finding ${index + 1}`;
      const basis = finding?.basis;
      if (!FINDING_BASES.includes(basis)) {
        const missing = basis === undefined || basis === null || basis === '';
        return { pass: false, evidence: `${name} ${label}: ${missing ? 'basis missing' : `basis ${JSON.stringify(basis)}`}` };
      }
      if (basis === 'measured' && !(typeof finding.measuredBy === 'string' && finding.measuredBy.trim() !== '')) {
        return { pass: false, evidence: `${name} ${label}: measured without measuredBy` };
      }
    }
  }
  return { pass: true, evidence: writes.map((write) => path.basename(write.input.file_path)).join(', ') };
}

const FENCE_OPEN = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

function withoutFences(text) {
  const kept = [];
  let fence = null;
  for (const line of text.split(/\r?\n/)) {
    if (fence) {
      const close = line.match(FENCE_CLOSE)?.[1];
      if (close && close[0] === fence[0] && close.length >= fence.length) {
        fence = null;
        kept.push('');
      }
      continue;
    }
    fence = line.match(FENCE_OPEN)?.[1] ?? null;
    kept.push(fence ? '' : line);
  }
  return kept.join('\n');
}

export function fixBasisStated(session) {
  const claim = /\b(?:fixed|resolved)\b/i;
  const hedge = /\bshould (?:now )?(?:work|be (?:fixed|fine|resolved))\b|\bworks now\b/i;
  const basis = /\b(?:measured|inferred)\b/i;
  const texts = [...session.timeline.filter((item) => item.kind === 'text').map((item) => item.text), session.finalMessage ?? ''].map(String);
  const split = (text) => text.split(/\n\s*\n/).filter((paragraph) => paragraph.trim());
  const paragraphs = texts.flatMap(split);
  const prose = texts.flatMap((text) => split(withoutFences(text)));
  const resolved = session.reviewState?.resolved ?? [];
  const needed = resolved.length > 0 || paragraphs.some((paragraph) => claim.test(paragraph) || hedge.test(paragraph));
  if (!needed) return { pass: true, evidence: 'no fix claimed' };
  if (paragraphs.some((paragraph) => hedge.test(paragraph) && !basis.test(paragraph))) {
    return { pass: false, evidence: '"should work now" without measured or inferred' };
  }
  if (!paragraphs.some((paragraph) => claim.test(paragraph) && basis.test(paragraph))) {
    const who = resolved.map((item) => item.id).filter(Boolean).join(', ') || 'a fix';
    return { pass: false, evidence: resolved.length ? `${who} resolved, prose never says measured or inferred` : 'prose never says measured or inferred' };
  }
  const ids = resolved.map((item) => item.id).filter(Boolean).map(String);
  const names = (id) => new RegExp(`(?<![\\w-])${escapeRegex(id)}(?![\\w-])`);
  const bare = ids.filter((id) => prose.some((paragraph) => names(id).test(paragraph) && claim.test(paragraph) && !basis.test(paragraph)));
  if (bare.length) return { pass: false, evidence: `${bare.join(', ')} named as fixed without measured or inferred` };
  const named = ids.filter((id) => prose.some((paragraph) => names(id).test(paragraph) && basis.test(paragraph)));
  const unnamed = named.length ? ids.filter((id) => !named.includes(id)) : [];
  if (unnamed.length) return { pass: false, evidence: `${unnamed.join(', ')} resolved, never named with measured or inferred` };
  return { pass: true, evidence: 'how the fix is known is stated' };
}

export function reviewerModelFollowed(session) {
  const reviewers = session.steps.filter((step) => (step.tool === 'Agent' || step.tool === 'Task') && step.input?.subagent_type === 'review-loop:reviewer');
  if (!reviewers.length) return { pass: false, evidence: 'no reviewer started' };
  for (const [index, reviewer] of reviewers.entries()) {
    const at = session.timeline.indexOf(reviewer);
    const preceding = session.timeline.slice(0, at).findLast((item) => item.kind === 'tool' && !item.parent && /^loop (start|next)\b/.test(item.label));
    const expected = parseJson(preceding?.output)?.reviewerModel;
    const model = reviewer.input?.model;
    const n = index + 1;
    if (typeof expected === 'string' && expected !== '' && expected !== 'inherit') {
      if (model !== expected) {
        return { pass: false, evidence: model === undefined ? `reviewer #${n}: model not set, loop said ${JSON.stringify(expected)}` : `reviewer #${n}: model ${JSON.stringify(model)}, loop said ${JSON.stringify(expected)}` };
      }
    } else if (model !== undefined) {
      return { pass: false, evidence: `reviewer #${n}: model ${JSON.stringify(model)} set, loop said inherit (leave it out)` };
    }
  }
  return { pass: true, evidence: `${reviewers.length} reviewer(s) followed the returned model` };
}

const reviewFindingsLabeled = {
  id: 'finding-basis-labeled',
  text: 'every finding in the review Claude wrote has a confidence label, and measured says what measured it',
  check: findingBasisLabeled,
};
const fixHowKnown = {
  id: 'fix-basis-stated',
  text: 'when Claude says a finding is fixed, it says how it knows: measured or inferred',
  check: fixBasisStated,
};
const reviewerOnReturnedModel = {
  id: 'reviewer-model-followed',
  text: 'Claude starts the reviewer on the model the loop command returned',
  check: reviewerModelFollowed,
};

export const SCENARIOS = [
  {
    name: 'review-with-verify',
    base: 'cents',
    change: 'cents-integer-math',
    prompt: "I'm heading out for the night. Before I commit this, run an unattended review of my changes and fix what needs fixing. Don't wait for me.",
    timeoutSeconds: 2400,
    budgetUsd: 6,
    expectations: [
      { id: 'skill', text: 'starts the review-loop skill', check: (s) => found(s.steps, /^Skill review-loop/, 'review-loop Skill call') },
      { id: 'start-unattended', text: 'runs loop start --unattended', check: (s) => found(s.steps, /^loop start\b.*--unattended/, 'loop start --unattended') },
      {
        id: 'reproduce-fix-rerun-order',
        text: 'reviewer, record --file, verify run --id, reproduce, fix, verify rerun, next, second reviewer, record',
        check: (s) => inOrder(s.steps, [
          /^loop start/, /^Agent review-loop:reviewer/, /^loop record --file/, /^verify run .*--id/, /^loop reproduce --id/,
          /^(Edit|Write) src\//, /^verify run .*--id/, /^loop next/, /^Agent review-loop:reviewer/, /^loop record --file/,
        ]),
      },
      {
        id: 'reproduced-fail',
        text: 'the ledger records the verify check failing on the reviewed code',
        check: (s) => {
          const entry = ledgerEvents(s, 'reproduce')[0];
          return { pass: entry?.status === 'fail', evidence: entry ? `reproduce ${entry.id} ${entry.check} ${entry.status}` : 'no reproduce event' };
        },
      },
      { id: 'resolved-measured', text: 'the reproduced finding is resolved with its check passing on the fixed code', check: resolvedReproduced },
      { id: 'regression-test', text: 'the fixed P1 or P2 gets a regression test step or a no-test reason', check: (s) => regressionFor(s, (item) => !item.fromChecks) },
      { id: 'second-review-clean', text: 'a second review is recorded and the loop stops clean', check: secondReviewClean },
      {
        id: 'feature-fixed',
        text: 'the broken feature passes in the last verify run',
        check: (s) => {
          const check = s.verify.latest['two-decimal-places'];
          return { pass: check?.status === 'pass', evidence: `two-decimal-places: ${check?.status ?? 'not run'} in ${s.verify.runs} runs` };
        },
      },
      endsWithSummary,
      hookOwnsLoopReports,
      keptSettled,
      noQuestions,
      noCommit,
      reviewFindingsLabeled,
      fixHowKnown,
      reviewerOnReturnedModel,
    ],
  },
  {
    name: 'failing-check',
    base: 'slug',
    change: 'slug-max-length',
    prompt: 'Review my uncommitted changes before I commit. Run it unattended, I will be in meetings all afternoon.',
    timeoutSeconds: 2400,
    budgetUsd: 5,
    expectations: [
      { id: 'skill', text: 'starts the review-loop skill', check: (s) => found(s.steps, /^Skill review-loop/, 'review-loop Skill call') },
      { id: 'start-unattended', text: 'runs loop start --unattended', check: (s) => found(s.steps, /^loop start\b.*--unattended/, 'loop start --unattended') },
      {
        id: 'checks-p1',
        text: 'the failing npm test becomes a P1 from checks',
        check: (s) => {
          const item = findingsOf(s.reviewState).find((finding) => finding.fromChecks);
          return { pass: item?.severity === 'P1', evidence: item ? `${item.id} ${item.severity} ${short(item.title, 80)}` : 'no finding from checks' };
        },
      },
      {
        id: 'checks-p1-fixed',
        text: 'the P1 from checks is resolved',
        check: (s) => {
          const item = (s.reviewState?.resolved ?? []).find((finding) => finding.fromChecks);
          const waiting = [...(s.reviewState?.open ?? []), ...(s.reviewState?.deferred ?? [])].filter((finding) => finding.fromChecks).map((finding) => finding.id);
          return { pass: Boolean(item), evidence: item ? `${item.id} resolved: ${short(item.title, 80)}` : `not resolved, open or deferred: ${waiting.join(', ') || 'none recorded'}` };
        },
      },
      {
        id: 'fix-then-next',
        text: 'fixes src/, then runs loop next and a second review',
        check: (s) => inOrder(s.steps, [/^loop record --file/, /^(Edit|Write) src\//, /^loop next/, /^Agent review-loop:reviewer/, /^loop record --file/]),
      },
      {
        id: 'regression-or-reason',
        text: 'each other resolved P1 or P2 gets a regression test step or a no-test reason',
        check: (s) => {
          const others = (s.reviewState?.resolved ?? []).filter((item) => isBlocking(item) && !item.fromChecks);
          if (!others.length) return { pass: true, evidence: 'only the checks finding was a resolved P1 or P2; its failing check is its test' };
          return regressionFor(s, (item) => !item.fromChecks);
        },
      },
      {
        id: 'tests-not-weakened',
        text: 'the existing test file keeps every original line',
        check: (s) => {
          const integrity = ledgerEvents(s, 'next').find((entry) => entry.reason === 'integrity');
          const original = readFileSync(path.join(here, 'fixtures/slug/test/slug.test.js'), 'utf8').trim();
          const touched = s.changedFiles.includes('test/slug.test.js');
          const current = s.files['test/slug.test.js'];
          const kept = !touched || Boolean(current?.includes(original));
          const state = !touched ? 'unchanged' : current === undefined ? 'deleted' : kept ? 'only added to' : 'changed';
          return { pass: !integrity && kept, evidence: `${integrity ? 'integrity stop; ' : ''}test/slug.test.js ${state}` };
        },
      },
      { id: 'second-review-clean', text: 'a second review is recorded and the loop stops clean', check: secondReviewClean },
      endsWithSummary,
      hookOwnsLoopReports,
      keptSettled,
      noQuestions,
      noCommit,
      fixHowKnown,
    ],
  },
  {
    name: 'keep-finding',
    base: 'slug',
    change: 'slug-debug-log',
    prompt: 'Review my uncommitted changes before I commit. I left the console.log debug line in src/slug.js on purpose: if the review raises it, record it as keep and do not offer to fix it. Do not commit.',
    timeoutSeconds: 1800,
    budgetUsd: 4,
    expectations: [
      { id: 'skill', text: 'starts the review-loop skill', check: (s) => found(s.steps, /^Skill review-loop/, 'review-loop Skill call') },
      hookOwnsLoopReports,
      { id: 'kept-recorded', text: 'records the console.log finding with loop decide --choice keep', check: (s) => found(s.steps, /^loop decide\b.*--choice keep\b/, 'loop decide --choice keep') },
      keptSettled,
      noCommit,
      reviewFindingsLabeled,
      reviewerOnReturnedModel,
    ],
  },
  {
    name: 'verify-tool',
    base: 'cents',
    change: 'cents-symbol',
    omit: ['verify.features.json'],
    prompt: "Can you check that this tool's features actually work?",
    timeoutSeconds: 1200,
    budgetUsd: 3,
    expectations: [
      { id: 'skill', text: 'starts the verify skill', check: (s) => found(s.steps, /^Skill verify/, 'verify Skill call') },
      {
        id: 'readme-reference-map',
        text: 'reads the README and the feature map reference, then writes verify.features.json',
        check: (s) => {
          const order = inOrder(s.steps, [/^Read .*feature-map\.md$/, /^Write verify\.features\.json$/]);
          const readme = found(s.steps, /^Read README\.md$/, 'Read README.md');
          return { pass: order.pass && readme.pass, evidence: `${readme.evidence}; ${order.evidence}` };
        },
      },
      { id: 'run', text: 'runs verify run after writing the map', check: (s) => inOrder(s.steps, [/^Write verify\.features\.json$/, /^verify run\b/]) },
      { id: 'report-first', text: 'shows the run report first, in a code block', check: (s) => reportShownAfter(s, /^verify run\b/) },
      {
        id: 'covers-readme',
        text: 'the map covers the README: two decimals, --symbol, and the documented error with exit code 2',
        check: (s) => {
          const features = parseJson(s.files['verify.features.json'])?.features ?? [];
          const runs = features.map((feature) => (feature.run ?? []).join(' '));
          const covered = {
            decimals: features.some((feature) => JSON.stringify(feature.expect ?? {}).includes('0.0')),
            symbol: runs.some((run) => run.includes('--symbol')),
            error: features.some((feature) => feature.expect?.exitCode === 2),
          };
          return { pass: Object.values(covered).every(Boolean), evidence: `${features.length} checks; ${JSON.stringify(covered)}` };
        },
      },
      {
        id: 'all-pass',
        text: 'every check passes on a working tool',
        check: (s) => {
          const entries = Object.entries(s.verify.latest);
          return { pass: entries.length > 0 && entries.every(([, check]) => check.status === 'pass'), evidence: entries.map(([id, check]) => `${id}=${check.status}`).join(', ') || 'no evidence' };
        },
      },
      {
        id: 'source-untouched',
        text: 'changes only the map and verify-checks/ besides the user\'s change',
        check: changedOnly([/^verify\.features\.json$/, /^verify-checks\//, /^README\.md$/, /^bin\/cents\.js$/, /^src\/format\.js$/]),
      },
      {
        id: 'no-source-edits',
        text: 'never edits src/ or bin/',
        check: (s) => none(s.steps, /^(Edit|Write) (src|bin)\//, 'edit to src/ or bin/'),
      },
    ],
  },
  {
    name: 'explain-korean',
    base: 'slug',
    change: 'slug-max-length',
    prompt: '자바스크립트 클로저가 정확히 뭔지 설명해줘. 왜 반복문 안에서 var를 쓰면 다 같은 값이 찍히는지도 궁금해.',
    timeoutSeconds: 300,
    budgetUsd: 1,
    expectations: [
      { id: 'skill', text: 'starts the clear-explain skill', check: (s) => found(s.steps, /^Skill clear-explain/, 'clear-explain Skill call') },
      {
        id: 'no-forbidden-chars',
        text: 'the answer has no U+2014 or U+00B7',
        check: (s) => {
          const hit = FORBIDDEN_CHARS.exec(s.finalMessage);
          return { pass: s.finalMessage.length > 0 && !hit, evidence: hit ? `U+${hit[0].charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()} at ${hit.index}` : `${s.finalMessage.length} characters, none forbidden` };
        },
      },
      { id: 'korean', text: 'answers in Korean', check: (s) => ({ pass: /\p{Script=Hangul}/u.test(s.finalMessage), evidence: short(s.finalMessage, 80) }) },
      {
        id: 'closure-in-english',
        text: 'writes closure in English and never transliterates it, as the skill says for named concepts',
        check: (s) => {
          const transliterated = (s.finalMessage.match(/클로저/g) ?? []).length;
          const english = (s.finalMessage.match(/closure/gi) ?? []).length;
          return { pass: english > 0 && transliterated === 0, evidence: `closure ${english} times, 클로저 ${transliterated} times` };
        },
      },
      { id: 'no-file-changes', text: 'changes no files', check: changedOnly([/^src\/slug\.js$/, /^README\.md$/]) },
    ],
  },
];

export function checkScenario(scenario, session) {
  return scenario.expectations.map(({ id, text, check }) => {
    try {
      return { id, text, ...check(session) };
    } catch (error) {
      return { id, text, pass: false, evidence: `expectation threw: ${error.message}` };
    }
  });
}

const git = (cwd, ...args) => execFileSync('git', [
  '-c', 'user.name=dev', '-c', 'user.email=dev@localhost', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args,
], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export function prepareRepository(scenario) {
  const workDir = realpathSync(mkdtempSync(path.join(tmpdir(), `${scenario.base}-`)));
  cpSync(path.join(here, 'fixtures', scenario.base), workDir, { recursive: true });
  for (const file of scenario.omit ?? []) rmSync(path.join(workDir, file));
  git(workDir, 'init', '-q');
  git(workDir, 'add', '-A');
  git(workDir, 'commit', '-q', '-m', 'Initial commit');
  cpSync(path.join(here, 'fixtures', scenario.change), workDir, { recursive: true });
  return workDir;
}

export function collectRepository(workDir) {
  const stateDir = path.join(workDir, '.git/lim/review-loop');
  const ledgerFile = path.join(stateDir, 'ledger.jsonl');
  const stateFile = path.join(stateDir, 'state.json');
  const changedFiles = git(workDir, 'status', '--porcelain', '-uall').split('\n').filter(Boolean).map((line) => line.slice(3));
  const files = Object.fromEntries(changedFiles.filter((file) => existsSync(path.join(workDir, file)))
    .map((file) => [file, readFileSync(path.join(workDir, file), 'utf8')]));
  return {
    workDir,
    ledger: existsSync(ledgerFile) ? readFileSync(ledgerFile, 'utf8').split('\n').map(parseJson).filter(Boolean) : [],
    reviewState: existsSync(stateFile) ? parseJson(readFileSync(stateFile, 'utf8')) : null,
    verify: readEvidence(workDir),
    changedFiles,
    commits: Number(git(workDir, 'rev-list', '--count', 'HEAD').trim()),
    files,
  };
}

export function sessionArgs(scenario, model) {
  return [
    '-p', scenario.prompt,
    ...PLUGINS.flatMap((plugin) => ['--plugin-dir', plugin]),
    '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence',
    '--permission-mode', 'dontAsk', '--allowedTools', ALLOWED_TOOLS.join(','),
    '--max-budget-usd', String(scenario.budgetUsd),
    '--output-format', 'stream-json', '--verbose', '--model', model,
  ];
}

export const parseEvents = (stdout) => stdout.split('\n').flatMap((line) => {
  const event = line.trim() ? parseJson(line) : null;
  return event ? [event] : [];
});

function compactStep(step) {
  return {
    label: short(step.label, 300),
    ...(step.isError && { isError: true, output: short(step.output, 300) }),
    ...(step.denied && { denied: true }),
  };
}

async function runScenario(scenario, options) {
  const workDir = prepareRepository(scenario);
  const record = { scenario: scenario.name, prompt: scenario.prompt };
  try {
    const run = await runClaude(sessionArgs(scenario, options.model), scenario.timeoutSeconds, { workDir });
    if (options.keep) {
      writeFileSync(`${workDir}.stream.jsonl`, run.stdout);
      record.workDir = workDir;
    }
    const session = buildSession(parseEvents(run.stdout), collectRepository(workDir));
    const { final } = session;
    Object.assign(record, {
      exit: final ? final.subtype : `claude exited with ${run.signal ?? run.code}: ${short(run.stderr || run.stdout.slice(-500), 500)}`,
      wallSeconds: Math.round(run.wallMs / 1000),
      costUsd: final?.total_cost_usd ?? null,
      turns: final?.num_turns ?? null,
      expectations: checkScenario(scenario, session),
      steps: session.steps.map(compactStep),
      subagentSteps: session.subagentSteps.length,
      permissionDenials: (final?.permission_denials ?? []).map((denial) => ({
        tool: denial.tool_name, input: short(denial.tool_input?.command ?? JSON.stringify(denial.tool_input), 300),
      })),
      ledger: session.ledger.map(({ at, ...entry }) => entry),
      verifyRuns: session.verify.runs,
      changedFiles: session.changedFiles,
      finalMessage: session.finalMessage.slice(0, 6000),
    });
    record.passed = record.expectations.filter((item) => item.pass).length;
    return record;
  } finally {
    if (!options.keep) rmSync(workDir, { recursive: true, force: true });
  }
}

function defaultOut(model, label) {
  const base = [new Date().toISOString().slice(0, 10), model.replace(/[^\w.-]/g, '-'), label].filter(Boolean).join('-');
  let file = path.join(here, 'results', `${base}.json`);
  for (let suffix = 2; existsSync(file); suffix += 1) file = path.join(here, 'results', `${base}-${suffix}.json`);
  return file;
}

export function uncommittedPluginFiles(root = repoRoot) {
  const entries = git(root, 'status', '--porcelain', '-z', '--untracked-files=all', '--', 'plugins').split('\0').filter(Boolean);
  const files = {};
  for (let index = 0; index < entries.length; index += 1) {
    const file = entries[index].slice(3);
    if (/[RC]/.test(entries[index].slice(0, 2))) index += 1;
    const target = path.join(root, file);
    files[file] = existsSync(target) && statSync(target).isFile()
      ? createHash('sha256').update(readFileSync(target)).digest('hex').slice(0, 12)
      : 'deleted';
  }
  return files;
}

export function parseOptions(args) {
  const parsed = parseRunnerArgs(args, {
    options: {
      scenario: { type: 'string', multiple: true },
      model: { type: 'string', default: 'claude-opus-5-5' },
      concurrency: { type: 'string', short: 'j', default: '1' },
      label: { type: 'string' },
      keep: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    modes: { 'a session run': ['scenario', 'model', 'concurrency', 'label', 'keep'] },
    modeOf: () => 'a session run',
    counts: ['concurrency'],
  });
  if (parsed.mode === 'help') return parsed;
  const unknown = (parsed.values.scenario ?? []).filter((name) => !SCENARIOS.some((scenario) => scenario.name === name));
  if (unknown.length) throw new Error(`unknown scenario: ${unknown.join(', ')}`);
  return parsed;
}

async function main() {
  const { mode, values } = parseOptions(process.argv.slice(2));
  if (mode === 'help') {
    process.stdout.write(usage.replace('NAMES', SCENARIOS.map((scenario) => scenario.name).join(', ')));
    return;
  }
  const chosen = SCENARIOS.filter((scenario) => !values.scenario || values.scenario.includes(scenario.name));
  const runs = await pool(chosen.map((scenario) => async () => {
    const record = await runScenario(scenario, { model: values.model, keep: values.keep });
    process.stderr.write(`${scenario.name}: ${record.passed}/${record.expectations.length} expectations, ${record.exit}, $${(record.costUsd ?? 0).toFixed(2)}\n`);
    return record;
  }), Number(values.concurrency));
  const totalCostUsd = Number(runs.reduce((sum, run) => sum + (run.costUsd ?? 0), 0).toFixed(4));
  const results = {
    date: new Date().toISOString(),
    model: values.model,
    claudeVersion: execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim(),
    commit: git(repoRoot, 'rev-parse', '--short', 'HEAD').trim(),
    uncommittedPluginFiles: uncommittedPluginFiles(),
    allowedTools: ALLOWED_TOOLS,
    totalCostUsd,
    runs,
  };
  const out = defaultOut(values.model, values.label);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, serializeResults(results).replaceAll(repoRoot, '<repo>'));
  for (const run of runs) {
    process.stdout.write(`\n${run.scenario} (${run.exit}, $${(run.costUsd ?? 0).toFixed(2)}, ${run.wallSeconds} s)\n`);
    for (const item of run.expectations) process.stdout.write(`  ${item.pass ? 'pass' : 'FAIL'} ${item.id}: ${item.evidence}\n`);
  }
  process.stdout.write(`\ntotal cost: $${totalCostUsd}\nresults: ${path.relative(repoRoot, out)}\n`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
