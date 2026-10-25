export function slugify(text, { maxLength } = {}) {
  const slug = String(text)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!maxLength || slug.length <= maxLength) return slug;
  const cut = slug.slice(0, maxLength + 1);
  const lastHyphen = cut.lastIndexOf('-');
  return lastHyphen > 0 ? cut.slice(0, lastHyphen) : slug.slice(0, maxLength);
}
