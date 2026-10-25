import { priceOf } from './catalog.js';

let nextId = 1;

export function createOrder(body) {
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new Error('an order needs at least one item');
  }
  const lines = body.items.map((item) => {
    if (typeof item.quantity !== 'number' || item.quantity < 1) {
      throw new Error(`bad quantity for ${item.sku}`);
    }
    const priceCents = priceOf(item.sku);
    if (priceCents === undefined) {
      throw new Error(`unknown sku: ${item.sku}`);
    }
    return { sku: item.sku, quantity: item.quantity, priceCents };
  });
  const totalCents = lines.reduce((sum, line) => sum + line.priceCents * line.quantity, 0);
  return { id: `ord_${nextId++}`, lines, totalCents };
}
