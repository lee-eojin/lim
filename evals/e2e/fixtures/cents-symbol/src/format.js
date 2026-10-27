export function formatCents(cents, symbol = '$') {
  return `${symbol}${(cents / 100).toFixed(2)}`;
}
