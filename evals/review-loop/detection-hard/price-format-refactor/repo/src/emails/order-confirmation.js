import { STORE_CURRENCY, STORE_LOCALE } from '../config.js';

function money(cents) {
  return new Intl.NumberFormat(STORE_LOCALE, { style: 'currency', currency: STORE_CURRENCY }).format(cents / 100);
}

export function orderConfirmation(order) {
  return {
    subject: `We got your order ${order.id}`,
    text: [
      ...order.items.map((item) => `${item.quantity} x ${item.name}  ${money(item.priceCents * item.quantity)}`),
      `Total: ${money(order.totalCents)}`,
    ].join('\n'),
  };
}
