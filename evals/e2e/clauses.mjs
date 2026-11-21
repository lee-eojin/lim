export const ACT = 'fix|delete|remove|change|update|edit|drop|strip|clean up';
export const LINK = 'in|on|at|by|to|for|from|with|without|within|into|onto|over|under|via|per|about|around|against|among|between|behind|beside|beyond|inside|outside|near|off|out|up|down|through|throughout|toward|than|as|like|unlike|except|before|after|during|until|till|since|and|or|but|nor|so|yet|if|unless|when|whenever|while|where|wherever|once|because|though|although|then|now|not|also|too|again|first|later|today|tomorrow|tonight|please|just|only|still|even|using|including|excluding|regarding|following|pending';

const setOf = (words) => new Set(words.split('|'));
const LINKS = setOf(LINK);
const ACTS = setOf(ACT.replace('|clean up', ''));
const NEGATION = /^(?:not|never|no|nothing|none|neither|nor|without|cannot)$|n['’]t$/i;
const EXCLUDER = setOf('except|excluding');
const NAME_LEAD = setOf('the|this|your');
const CUE = /^\s*,?\s*(?:if\s+you(?:['’]d|\s+would)?\s+(?:like|prefer|want)|if\s+(?:that|it)\s+helps)\b/i;
const TOKEN = /\x60[^\x60\n]*\x60|[A-Za-z0-9_$]+(?:[.'’-][A-Za-z0-9_$]+)*|["“”‘’']|[^\sA-Za-z0-9_$]/g;

export function tokensOf(text) {
  const open = [];
  return [...text.matchAll(TOKEN)].map((found) => {
    const [mark, start] = [found[0], found.index];
    const end = start + mark.length;
    const token = (kind) => ({ kind, text: mark, start, end, depth: open.length, spoken: open.includes('double') });
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

export function leadStarts(text) {
  return tokensOf(text).filter((token) => wordOf(token) === 'so' && !token.spoken).map((token) => token.end);
}

function isLeftOut(text, tokens, [start, end]) {
  const first = tokens.findIndex((token) => token.end > start);
  const last = tokens.findLastIndex((token) => token.start < end);
  if (first === -1 || last < first) return false;
  const inCode = first === last && tokens[first].kind === 'code' && tokens[first].start === start - 1 && tokens[first].end === end + 1;
  const whole = tokens[first].start === start && (tokens[last].end === end || (tokens[last].end === end + 1 && text[end] === 's'));
  if (!inCode && !whole) return false;
  const quoted = tokens[first - 1]?.kind === 'open' && tokens[last + 1]?.kind === 'close';
  const [before, after] = quoted ? [first - 2, last + 2] : [first - 1, last + 1];
  const tail = tokens[after - 1].end;
  const cue = text.slice(tail).match(CUE)?.[0].length ?? 0;
  const next = tokens.find((token) => token.start >= tail + cue);
  if (!endsSentence(next) && next.kind !== 'close') return false;
  let at = before;
  const modifies = /^[a-z][\w-]*$/.test(tokens[at]?.text ?? '') && !LINKS.has(wordOf(tokens[at])) && !NAME_LEAD.has(wordOf(tokens[at]));
  if (modifies && NAME_LEAD.has(wordOf(tokens[at - 1]))) at -= 1;
  if (NAME_LEAD.has(wordOf(tokens[at]))) at -= 1;
  if (wordOf(tokens[at]) === 'for' && wordOf(tokens[at - 1]) === 'except') at -= 1;
  if (!EXCLUDER.has(wordOf(tokens[at]))) return false;
  const depth = tokens[at].depth;
  const isAct = (index) => ACTS.has(wordOf(tokens[index])) || (wordOf(tokens[index]) === 'up' && wordOf(tokens[index - 1]) === 'clean');
  let object = at - 1;
  while (object >= 0 && namesThing(tokens[object]) && !isAct(object)) {
    if (at - object > 4 || LINKS.has(wordOf(tokens[object])) || NEGATION.test(tokens[object].text) || tokens[object].depth !== depth) return false;
    object -= 1;
  }
  if (object === at - 1 || object < 0 || !isAct(object) || tokens[object].depth !== depth) return false;
  for (let back = object - 1; back >= 0 && namesThing(tokens[back]); back -= 1) {
    if (NEGATION.test(tokens[back].text)) return false;
  }
  return true;
}

export function withoutLeftOut(text, anchors) {
  if (!/\bexcept\b|\bexcluding\b/i.test(text)) return text;
  const tokens = tokensOf(text);
  const spans = anchors.flatMap((anchor) => [...text.matchAll(new RegExp(anchor, 'gi'))].map((found) => [found.index, found.index + found[0].length]));
  return spans.filter((span) => span[1] > span[0] && isLeftOut(text, tokens, span)).reduce((kept, [start, end]) => kept.slice(0, start) + ' '.repeat(end - start) + kept.slice(end), text);
}
