const prices = new Map([
  ['MUG-01', 1200],
  ['TEE-02', 2400],
  ['CAP-03', 1800],
]);

export function priceOf(sku) {
  return prices.get(sku);
}

export function isKnownSku(sku) {
  return prices.has(sku);
}
