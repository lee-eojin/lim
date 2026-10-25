const UNITS = [
  ['d', 24 * 60 * 60 * 1000],
  ['h', 60 * 60 * 1000],
  ['m', 60 * 1000],
  ['s', 1000],
  ['ms', 1],
];
const SIZE = new Map(UNITS);
const PART = /(\d+)(ms|d|h|m|s)/g;

export function parseDuration(text) {
  const input = String(text).replace(/\s+/g, '');
  let total = 0;
  let consumed = 0;
  for (const [part, amount, unit] of input.matchAll(PART)) {
    total += Number(amount) * SIZE.get(unit);
    consumed += part.length;
  }
  if (!input || consumed !== input.length) throw new Error(`Invalid duration: "${text}"`);
  return total;
}

export function formatDuration(milliseconds) {
  if (!Number.isInteger(milliseconds) || milliseconds < 0) {
    throw new Error('formatDuration needs a whole number of milliseconds, 0 or more');
  }
  if (milliseconds === 0) return '0s';
  const parts = [];
  let rest = milliseconds;
  for (const [unit, size] of UNITS) {
    const amount = Math.floor(rest / size);
    rest -= amount * size;
    if (amount) parts.push(`${amount}${unit}`);
  }
  return parts.join(' ');
}
