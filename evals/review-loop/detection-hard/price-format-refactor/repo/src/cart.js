import { STORE_CURRENCY, STORE_LOCALE } from './config.js';

function formatPrice(cents) {
  return new Intl.NumberFormat(STORE_LOCALE, { style: 'currency', currency: STORE_CURRENCY }).format(cents / 100);
}

export function cartSummary(cart) {
  const subtotalCents = cart.items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  return {
    lines: cart.items.map((item) => `${item.quantity} x ${item.name}: ${formatPrice(item.priceCents * item.quantity)}`),
    subtotal: formatPrice(subtotalCents),
  };
}
