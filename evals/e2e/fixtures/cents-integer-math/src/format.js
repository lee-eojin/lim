export function formatCents(cents, symbol = '$') {
  const dollars = Math.floor(cents / 100);
  const rest = cents % 100;
  return `${symbol}${dollars}.${rest}`;
}
