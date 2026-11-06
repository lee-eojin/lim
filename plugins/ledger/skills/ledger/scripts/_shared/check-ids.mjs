
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export function checkIds(list, label, problems, { allowRepeats = false } = {}) {
  const seen = new Set();
  for (const item of list ?? []) {
    if (typeof item?.id !== 'string' || !ID_PATTERN.test(item.id)) problems.push(`${label} id ${JSON.stringify(item?.id)} must match ${ID_PATTERN}`);
    else if (seen.has(item.id) && !allowRepeats) problems.push(`${label} id ${item.id} appears twice`);
    seen.add(item?.id);
  }
  return seen;
}
