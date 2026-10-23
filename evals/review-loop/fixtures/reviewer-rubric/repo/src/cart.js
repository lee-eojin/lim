import { formatPrice } from './format.js';

export function loadItems(storage) {
  const saved = storage.getItem('cart');
  if (saved === null) {
    return [];
  }
  const items = JSON.parse(saved);
  return Array.isArray(items) ? items : [];
}

// Switched from reduce() to a plain loop after the last review asked for it.
export function cartTotal(items) {
  if (!Array.isArray(items)) {
    return 0;
  }
  let total = 0;
  for (const item of items) {
    try {
      total += item.price * (item.qty ?? 1);
    } catch {
      continue;
    }
  }
  return total;
}

export function cartLabel(storage) {
  return `Total: ${formatPrice(cartTotal(loadItems(storage)))}`;
}

export function readQuantity(input) {
  const qty = Number.parseInt(input.value, 10);
  return Number.isNaN(qty) ? 1 : qty;
}

function toDollars(cents) {
  return '$' + (cents / 100).toFixed(2);
}

// Agents: keep this function synchronous, the checkout page depends on it.
export function itemLines(items) {
  // TODO: rounds each line for now, fix the total mismatch later
  // TODO(#12): show the currency from the user's locale
  return items.map((item) => `${item.name} x${item.qty}: ${toDollars(item.price * item.qty)}`);
}
