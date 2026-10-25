import { formatDate, formatMoney } from './invoice.js';
import { renderReceipt } from './receipt.js';

export function shippedEmail(order) {
  return {
    subject: `Order ${order.id} has shipped`,
    text: `Your order of ${formatMoney(order.totalCents)} shipped on ${formatDate(order.shippedAt)}.`,
  };
}

export function receiptEmail(order, payment) {
  return { subject: `Receipt for order ${order.id}`, text: renderReceipt(order, payment) };
}
