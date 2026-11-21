export const ACT = 'fix|delete|remove|change|update|edit|drop|strip|clean up';
export const DONE = 'fixed|deleted|removed|changed|updated|edited|dropped|stripped|cleaned up';
export const SAID = 'said|says|noted|notes|flagged|flags|suggested|suggests|recommended|recommends|found|thought|thinks|wrote|reported|reports|asked|wanted|wants|raised|mentioned|argued';
export const DAY = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday';
export const DAYPART = 'morning|afternoon|evening|night';
export const BY_TIME = `deadline|cutoff|end|time|way|next|weekend|${DAYPART}|${DAY}`;
export const OBJECT_LEAD = 'the|a|an|this|its|their|our|your|my';
export const QUANTIFIER = 'each|every|all|some|no';
export const LINK = 'in|on|at|by|to|for|from|with|without|within|into|onto|over|under|via|per|about|around|against|among|between|behind|beside|beyond|inside|outside|near|off|out|up|down|through|throughout|toward|than|as|like|unlike|except|before|after|during|until|till|since|and|or|but|nor|so|yet|if|unless|when|whenever|while|where|wherever|once|because|though|although|then|now|not|also|too|again|first|later|today|tomorrow|tonight|please|just|only|still|even|using|including|excluding|regarding|following|pending';
export const NOT_NOUN = 'findings|issues|bugs|things|plus|perhaps|sometimes|besides|across|versus|thus|minus|whereas|overseas|thanks|cheers|pls|yours|ours|hers|theirs|his|its|this|towards|backwards|forwards|afterwards|upwards|downwards|onwards|inwards|outwards|always|sideways|anyways|nowadays|less|unless|regardless|nevertheless|nonetheless|doubtless|indoors|outdoors|upstairs|downstairs';

const setOf = (words) => new Set(words.split('|'));
const LEADS = setOf(OBJECT_LEAD);
const QUANTITIES = setOf(QUANTIFIER);
const TIMES = setOf(BY_TIME);
const LINKS = setOf(LINK);
const SPEECH = setOf(SAID);
const ACTED = setOf(DONE.replace('|cleaned up', '|cleaned'));
const FINDING_WORDS = setOf('findings|issues|bugs|things');
const NOT_OBJECT_NOUN = new Set([...setOf(NOT_NOUN)].filter((word) => !FINDING_WORDS.has(word)));
const PLURAL_NOUN = setOf('children|people|men|women|data|metadata|media|criteria|feet|teeth|mice');
const SOURCE_TIME = setOf('start|beginning|outset');
const PERSON = setOf('reviewer|reviewers|author|authors|team|teams|user|users|maintainer|maintainers|developer|developers|contributor|contributors|owner|owners|person|people');
const TOKEN = /\x60[^\x60\n]*\x60|[A-Za-z0-9_$]+(?:[.'’-][A-Za-z0-9_$]+)*|["“”‘’']|[^\sA-Za-z0-9_$]/g;

export function tokensOf(text) {
  const open = [];
  return [...text.matchAll(TOKEN)].map((found) => {
    const [mark, start] = [found[0], found.index];
    const end = start + mark.length;
    const token = (kind) => ({ kind, text: mark, start, end });
    if (mark.length > 1 && mark[0] === '\x60') return token('code');
    if (/^[A-Za-z0-9_$]/.test(mark)) return token('word');
    if (!/^["“”‘’']$/.test(mark)) return token('punct');
    const kind = '"“”'.includes(mark) ? 'double' : 'single';
    const [before, after] = [text[start - 1] ?? ' ', text[end] ?? ' '];
    const pair = kind === 'double' ? open.lastIndexOf('double') : open.length - 1;
    const shuts = mark !== '“' && mark !== '‘' && pair !== -1 && open[pair] === kind && (kind === 'double' || /\S/.test(before));
    if (shuts) {
      open.length = pair;
      return token('close');
    }
    const opens = mark !== '”' && mark !== '’' && (kind === 'double' || !/\w/.test(before)) && /\S/.test(after);
    if (!opens) return token('punct');
    const opened = token('open');
    open.push(kind);
    return opened;
  });
}

const wordOf = (token) => (token?.kind === 'word' ? token.text.toLowerCase() : '');
const namesThing = (token) => token?.kind === 'word' || token?.kind === 'code';
const endsSentence = (token) => !token || (token.kind === 'punct' && '.!?'.includes(token.text));

function agentPhrase(tokens, at) {
  return wordOf(tokens[at]) === 'by' && LEADS.has(wordOf(tokens[at + 1])) && namesThing(tokens[at + 2]) && !TIMES.has(wordOf(tokens[at + 2]));
}

function sourcePhrase(tokens, at) {
  if (wordOf(tokens[at]) !== 'from' || !LEADS.has(wordOf(tokens[at + 1])) || !namesThing(tokens[at + 2])) return false;
  const words = [];
  for (let next = at + 2; words.length < 3 && tokens[next]?.kind === 'word'; next += 1) words.push(wordOf(tokens[next]));
  return !words.some((word) => TIMES.has(word) || SOURCE_TIME.has(word));
}

const isParticiple = (token, speech) => token?.kind === 'word' && (/^[a-z]+ed$/i.test(token.text) || (speech && SPEECH.has(wordOf(token))));
const describesObject = (tokens, at) => agentPhrase(tokens, at + 1)
  || (!SPEECH.has(wordOf(tokens[at])) && !ACTED.has(wordOf(tokens[at])) && !PERSON.has(wordOf(tokens[at - 1])) && sourcePhrase(tokens, at + 1));
const isPluralNoun = (token) => token?.kind === 'word' && (PLURAL_NOUN.has(wordOf(token)) || (/^[a-z][\w-]+s$/i.test(token.text) && !NOT_OBJECT_NOUN.has(wordOf(token))));

const QUOTED_OBJECT = /^\s+(?:["“][^"”?\n]*["”]|['‘][^'’?\n]*['’])\s*(?:[.!]|$)/;
const QUANTITY_OBJECT = new RegExp(String.raw`^\s+(?!(?:${LINK}|across|along|above|below)(?![\w-]))[\w$\x60]`, 'i');

export function objectAfter(text) {
  if (/^["“'‘\x60]/.test(text)) return { lead: 'quote', object: true };
  const tokens = tokensOf(text);
  const lead = wordOf(tokens[0]);
  if (lead === 'these' || lead === 'those') {
    const closes = endsSentence(tokens[2]) || tokens[2].text === ';';
    return { lead: 'plural', object: isPluralNoun(tokens[1]) && (closes || (isParticiple(tokens[2], false) && describesObject(tokens, 2))) };
  }
  if (!LEADS.has(lead) && !QUANTITIES.has(lead)) return { lead: 'none', object: false };
  const relative = [2, 3].some((at) => tokens.slice(1, at).every(namesThing) && isParticiple(tokens[at], true) && !describesObject(tokens, at));
  if (relative) return { lead: 'relative', object: false };
  const rest = text.slice(tokens[0].end);
  if (!LEADS.has(lead)) return { lead: 'quantity', object: QUANTITY_OBJECT.test(rest) };
  return { lead: 'article', object: /^\s+[\w$\x60]/.test(rest) || QUOTED_OBJECT.test(rest) };
}
