import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  answerArgs, compareJudgePasses, heldOutRequests, judgePrompt, opensWithAnswer, parseJudgeOutput, parseOptions, parseStream, redact, rejudge, rescore, selectQuestions,
  serialize, skillVersion, summarize, summarizeTriggers, swapOrder, triggerArgs, triggerRequests, unblind,
} from '../../evals/clear-explain/run-explain.mjs';

const questionsFile = fileURLToPath(new URL('../../evals/clear-explain/questions.json', import.meta.url));
const triggersFile = fileURLToPath(new URL('../../evals/clear-explain/triggers.json', import.meta.url));
const heldOutFile = fileURLToPath(new URL('../../evals/clear-explain/triggers-held-out.json', import.meta.url));
const MIDDLE_DOT = String.fromCharCode(0x00b7);
const EM_DASH = String.fromCharCode(0x2014);

test('the question set has at least 12 questions in English and Korean with unique ids', () => {
  const questions = JSON.parse(readFileSync(questionsFile, 'utf8'));
  assert.ok(questions.length >= 12);
  assert.equal(new Set(questions.map((question) => question.id)).size, questions.length);
  assert.ok(questions.some((question) => question.lang === 'en'));
  assert.ok(questions.some((question) => question.lang === 'ko'));
});

test('the trigger set has fixes and lookups and coding tasks in English and Korean that are not explanations', () => {
  const requests = JSON.parse(readFileSync(triggersFile, 'utf8'));
  const questions = JSON.parse(readFileSync(questionsFile, 'utf8'));
  assert.ok(requests.length >= 6);
  const ids = [...requests, ...questions].map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const lang of ['en', 'ko']) {
    const kinds = new Set(requests.filter((request) => request.lang === lang).map((request) => request.kind));
    for (const kind of ['fix', 'lookup', 'task']) assert.ok(kinds.has(kind), `${lang} has a ${kind} request`);
  }
});

test('an answer opens with the answer only when its first line is prose without a preamble', () => {
  assert.equal(opensWithAnswer('A closure is a function that keeps its outer variables.\n\n## More'), true);
  assert.equal(opensWithAnswer('**Short answer:** it runs twice because of Strict Mode.'), true);
  assert.equal(opensWithAnswer('\n## Closures\n\nA closure is...'), false);
  assert.equal(opensWithAnswer('- first point'), false);
  assert.equal(opensWithAnswer('| a | b |'), false);
  assert.equal(opensWithAnswer('```js\ncode\n```'), false);
  assert.equal(opensWithAnswer('Great question! A closure is...'), false);
  assert.equal(opensWithAnswer('좋은 질문이에요. 이벤트 루프는...'), false);
});

test('both arms run with no user settings and only the with arm loads the plugin', () => {
  const withArgs = answerArgs('What is X?', 'with', 'opus');
  const withoutArgs = answerArgs('What is X?', 'without', 'opus');
  for (const args of [withArgs, withoutArgs]) {
    assert.equal(args[args.indexOf('--setting-sources') + 1], '');
    assert.ok(args.includes('--strict-mcp-config'));
    assert.equal(args[args.indexOf('--model') + 1], 'opus');
  }
  assert.match(withArgs[withArgs.indexOf('--plugin-dir') + 1], /plugins[\\/]clear-explain$/);
  assert.ok(!withoutArgs.includes('--plugin-dir'));
});

test('a trigger run loads the plugin with the tools of a normal session and no user settings', () => {
  const args = triggerArgs('Fix this test.', 'opus', 6);
  assert.equal(args[args.indexOf('-p') + 1], 'Fix this test.');
  assert.ok(!args.includes('--tools'));
  assert.equal(args[args.indexOf('--setting-sources') + 1], '');
  assert.equal(args[args.indexOf('--max-turns') + 1], '6');
  assert.match(args[args.indexOf('--plugin-dir') + 1], /plugins[\\/]clear-explain$/);
});

test('the trigger summary counts how often the skill started for explanations and for other requests', () => {
  const run = (explain, started, extra = {}) => ({ explain, started, costUsd: 0.05, wallMs: 1000, ...extra });
  const summary = summarizeTriggers([run(true, true), run(true, true), run(true, false), run(false, false), run(false, true),
    run(false, false), run(false, false), run(false, true, { error: 'timeout' })]);
  assert.deepEqual(summary.explain, { prompts: 3, started: 2 });
  assert.deepEqual(summary.other, { prompts: 4, started: 1 });
  assert.equal(summary.trueTriggerRate, 0.67);
  assert.equal(summary.falseTriggerRate, 0.25);
  assert.equal(summary.errors, 1);
  assert.equal(summary.costUsd, 0.4);
  assert.equal(summarizeTriggers([]).falseTriggerRate, null);
});

test('the judge prompt hides the plugin name and keeps the order it is given', () => {
  assert.equal(redact('Using clear-explain and Clear-Explain.'), 'Using a guide and a guide.');
  const prompt = judgePrompt('Q?', 'first answer', 'second answer from clear-explain');
  assert.ok(prompt.indexOf('first answer') < prompt.indexOf('second answer'));
  assert.ok(!/clear-explain/i.test(prompt));
});

test('judge output is read from plain or fenced or surrounded JSON', () => {
  const verdict = { clearer: 'B', reason: 'r', answerFirst: { A: true, B: true }, factualError: { A: false, B: false } };
  assert.deepEqual(parseJudgeOutput(JSON.stringify(verdict)).verdict, verdict);
  assert.deepEqual(parseJudgeOutput(`\`\`\`json\n${JSON.stringify(verdict)}\n\`\`\``).verdict, verdict);
  assert.deepEqual(parseJudgeOutput(`Here: ${JSON.stringify(verdict)} done`).verdict, verdict);
  assert.ok(parseJudgeOutput('{"clearer": "C"}').error);
});

test('a verdict maps A and B back to the arms in the order the judge saw them', () => {
  const verdict = { clearer: 'A', reason: 'r', answerFirst: { A: true, B: false }, factualError: { A: false, B: true } };
  assert.deepEqual(unblind(verdict, ['without', 'with']), {
    winner: 'without', reason: 'r', answerFirst: { without: true, with: false }, factualError: { without: false, with: true },
  });
  assert.equal(unblind({ ...verdict, clearer: 'tie' }, ['with', 'without']).winner, 'tie');
});

test('the stream gives the result event and the skills invoked and the files read', () => {
  const stdout = [
    { type: 'system', subtype: 'init' },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'clear-explain:clear-explain' } }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/x/references/korean-rules.md' } }] } },
    { type: 'result', result: 'answer', total_cost_usd: 0.01 },
  ].map((event) => JSON.stringify(event)).join('\n');
  const parsed = parseStream(`${stdout}\nnot json\n`);
  assert.equal(parsed.result.result, 'answer');
  assert.deepEqual(parsed.skills, ['clear-explain:clear-explain']);
  assert.deepEqual(parsed.reads, ['korean-rules.md']);
});

const answerEntry = (text, skills = []) => ({ answer: text, skills, costUsd: 0.1, tokens: { total: 10 }, wallMs: 1000, score: {} });

function item(id, lang, winner, order) {
  return {
    id,
    lang,
    answers: { with: answerEntry('A closure keeps outer variables.', ['clear-explain:clear-explain']), without: answerEntry('It simply works.') },
    judge: { order, winner, answerFirst: { with: true, without: false }, factualError: { with: false, without: false }, costUsd: 0.01, tokens: { total: 5 }, wallMs: 500 },
  };
}

test('the summary counts wins and scores and cost and how often the judge picked the second answer', () => {
  const results = rescore({ items: [
    item('one', 'en', 'with', ['without', 'with']),
    item('two', 'ko', 'without', ['with', 'without']),
    item('three', 'en', 'tie', ['with', 'without']),
  ] });
  const { summary } = results;
  assert.equal(summary.with.wins, 1);
  assert.equal(summary.without.wins, 1);
  assert.equal(summary.ties, 1);
  assert.equal(summary.with.skillInvoked, 3);
  assert.equal(summary.with.issuesPer1000, 0);
  assert.equal(summary.without.issuesPer1000, 62.5);
  assert.equal(summary.with.opensWithAnswer, 3);
  assert.equal(summary.with.judgeAnswerFirst, 3);
  assert.deepEqual(summary.position, { withShownSecond: 1, judgePickedSecond: 2, withWinsShownSecond: 1, withWinsShownFirst: 0 });
  assert.equal(summary.en.questions, 2);
  assert.equal(summary.costUsd.total, 0.63);
  assert.equal(summarize([]).questions, 0);
});

test('rescore refuses a saved trigger results file and names the mode that wrote it', () => {
  const results = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`../../evals/clear-explain/results/${name}`, import.meta.url)), 'utf8'));
  assert.throws(() => rescore(results('2026-10-27-opus-triggers.json')), /written by --triggers/);
  assert.throws(() => rescore(results('2026-10-27-opus-held-out-triggers.json')), /written by --held-out/);
});

test('the second judge pass shows every pair in the opposite order and keeps the first pass', async () => {
  const stored = { judgeModel: 'sonnet', items: [
    item('one', 'en', 'with', ['without', 'with']),
    item('two', 'ko', 'with', ['with', 'without']),
  ] };
  const firstPass = structuredClone(stored.items.map((entry) => entry.judge));
  const calls = [];
  const judgeRun = async (question, answers, options, order) => {
    calls.push({ id: question.id, order, judgeModel: options.judgeModel });
    return { order, winner: order[1], costUsd: 0.02, tokens: { total: 7 }, wallMs: 2000 };
  };
  const results = await rejudge(stored, { judgeModel: 'sonnet' }, judgeRun);
  assert.deepEqual(swapOrder(['with', 'without']), ['without', 'with']);
  assert.deepEqual(calls, [
    { id: 'one', order: ['with', 'without'], judgeModel: 'sonnet' },
    { id: 'two', order: ['without', 'with'], judgeModel: 'sonnet' },
  ]);
  assert.deepEqual(results.items.map((entry) => entry.judge), firstPass);
  assert.deepEqual(stored.items.map((entry) => entry.judgeSwapped), [undefined, undefined]);
  assert.equal(results.swappedJudge.judgeModel, 'sonnet');
  assert.deepEqual(results.swappedJudge.summary, {
    questions: 2, withWinsFirstPass: 2, withWinsSecondPass: 1, bothWith: 1, bothWithout: 0, bothTie: 0, split: 1,
    secondPassPickedSecond: 2, errors: 0, costUsd: 0.04, tokens: 14, wallSeconds: 4,
  });
});

test('the comparison counts both passes for the skill, both for the baseline, and the questions where order decided', () => {
  const pass = (first, second) => ({ judge: { winner: first, order: ['with', 'without'] }, judgeSwapped: { winner: second, order: ['without', 'with'] } });
  const summary = compareJudgePasses([pass('with', 'with'), pass('without', 'without'), pass('with', 'without'), pass('tie', 'with'), { judge: { winner: 'with' } }]);
  assert.equal(summary.questions, 4);
  assert.equal(summary.bothWith, 1);
  assert.equal(summary.bothWithout, 1);
  assert.equal(summary.split, 2);
});

test('saved results write the two characters as JSON escapes that read back as the same text', () => {
  const answer = `A ${MIDDLE_DOT} B ${EM_DASH} C`;
  const text = serialize({ items: [{ answers: { with: { answer } } }] });
  assert.ok(!text.includes(MIDDLE_DOT));
  assert.ok(!text.includes(EM_DASH));
  assert.equal(JSON.parse(text).items[0].answers.with.answer, answer);
});

test('the held-out trigger set is new requests in English and Korean that are not in the tuning set', () => {
  const heldOut = JSON.parse(readFileSync(heldOutFile, 'utf8'));
  const tuning = [...JSON.parse(readFileSync(triggersFile, 'utf8')), ...JSON.parse(readFileSync(questionsFile, 'utf8'))];
  const others = heldOut.filter((entry) => entry.explain === false);
  const explanations = heldOut.filter((entry) => entry.explain === true);
  assert.equal(others.length + explanations.length, heldOut.length, 'every request says whether it asks for an explanation');
  assert.ok(others.length >= 8);
  assert.ok(explanations.length >= 6);
  for (const group of [others, explanations]) {
    for (const lang of ['en', 'ko']) assert.ok(group.some((entry) => entry.lang === lang), `${lang} in both groups`);
  }
  const tuningKinds = new Set(tuning.map((entry) => entry.kind));
  assert.ok(others.every((entry) => !tuningKinds.has(entry.kind)), 'other requests are of kinds the tuning set does not have');
  const ids = [...heldOut, ...tuning].map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  const tuningTexts = new Set(tuning.map((entry) => entry.prompt ?? entry.question));
  assert.ok(heldOut.every((entry) => !tuningTexts.has(entry.prompt)));
});

test('a held-out run keeps the explain flag of each request and the tuning run marks only the questions', () => {
  assert.deepEqual(heldOutRequests([{ id: 'a', prompt: 'p', explain: true }, { id: 'b', prompt: 'q' }]).map((entry) => entry.explain), [true, false]);
  const tuning = triggerRequests([{ id: 'q1', lang: 'en', question: 'What is X?' }], [{ id: 'r1', lang: 'en', kind: 'fix', prompt: 'Fix X.', explain: true }]);
  assert.deepEqual(tuning.map((entry) => [entry.id, entry.prompt, entry.explain]), [['q1', 'What is X?', true], ['r1', 'Fix X.', false]]);
});

test('the skill version records the body hash without the frontmatter and the description separately', () => {
  const body = '\n# clear-explain\n\nWrite an explanation.\n';
  const first = skillVersion(`---\nname: clear-explain\ndescription: Old words.\n---\n${body}`);
  const second = skillVersion(`---\nname: clear-explain\ndescription: New words.\n---\n${body}`);
  assert.notEqual(first.sha256, second.sha256);
  assert.equal(first.bodySha256, second.bodySha256);
  assert.deepEqual([first.description, second.description], ['Old words.', 'New words.']);
  assert.notEqual(skillVersion(`---\nname: clear-explain\ndescription: Old words.\n---\n${body}More.\n`).bodySha256, first.bodySha256);
});

test('counts must be whole numbers above 0 and each mode refuses the flags it would ignore', () => {
  for (const args of [['-j', '0'], ['--rejudge', 'old.json', '-j', 'four'], ['--timeout', '0'], ['--triggers', '--max-turns', 'x']]) {
    assert.throws(() => parseOptions(args), /must be a whole number above 0/, args.join(' '));
  }
  assert.throws(() => parseOptions(['--rescore', 'old.json', '-j', '2']), /-j is not used by --rescore/);
  assert.throws(() => parseOptions(['--rejudge', 'old.json', '--model', 'opus']), /--model is not used by --rejudge/);
  assert.throws(() => parseOptions(['--held-out', 'held.json', '--question', 'en-cors']), /--question is not used by --held-out/);
  assert.throws(() => parseOptions(['--max-turns', '3']), /--max-turns is not used by a judged run/);
  assert.equal(parseOptions(['--triggers', '--question', 'en-cors', '--max-turns', '3']).mode, '--triggers');
  assert.equal(parseOptions(['--help', '-j', '0']).mode, 'help');
});

test('an unknown question id is refused instead of being dropped', () => {
  const questions = JSON.parse(readFileSync(questionsFile, 'utf8'));
  assert.deepEqual(selectQuestions(questions, ['en-cors']).map((question) => question.id), ['en-cors']);
  assert.equal(selectQuestions(questions, undefined).length, questions.length);
  assert.throws(() => selectQuestions(questions, ['en-cors', 'en-typo']), /unknown question: en-typo/);
});
