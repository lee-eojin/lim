const TOKEN = /\x60[^\x60\n]*\x60|[A-Za-z0-9_$]+(?:[.'’-][A-Za-z0-9_$]+)*|["“”‘’']|[^\sA-Za-z0-9_$]/g;

export function tokensOf(text) {
  const open = [];
  return [...text.matchAll(TOKEN)].map((found) => {
    const [mark, start] = [found[0], found.index];
    const end = start + mark.length;
    const token = (kind) => ({ kind, text: mark, start, end, spoken: open.includes('double') });
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
    const opens = mark !== '”' && mark !== '’' && (kind === 'double' || (!/\w/.test(before) && /\S/.test(after)));
    if (!opens) return token('punct');
    const opened = token('open');
    open.push(kind);
    return opened;
  });
}

const wordOf = (token) => (token?.kind === 'word' ? token.text.toLowerCase() : '');

export function leadStarts(text) {
  return tokensOf(text).filter((token) => wordOf(token) === 'so' && !token.spoken).map((token) => token.end);
}
