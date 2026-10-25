import { isKnownSku } from './catalog.js';

const MAX_QUANTITY = 99;

export function validateOrderBody(body) {
  if (!body || typeof body !== 'object') return 'body must be an object';
  if (!Array.isArray(body.items) || body.items.length === 0) return 'items must be a non-empty array';
  for (const item of body.items) {
    if (!item || typeof item.sku !== 'string' || !isKnownSku(item.sku)) return `unknown sku: ${item?.sku}`;
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY) {
      return `quantity for ${item.sku} must be a whole number from 1 to ${MAX_QUANTITY}`;
    }
  }
  return null;
}
