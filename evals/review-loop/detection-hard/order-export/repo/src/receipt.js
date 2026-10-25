import { formatDate, formatMoney } from './invoice.js';

export function renderReceipt(order, payment) {
  return [
    `Receipt for order ${order.id}`,
    `Paid ${formatMoney(payment.amountCents)} on ${formatDate(payment.paidAt)}`,
    `Card ending ${payment.cardLast4}`,
  ].join('\n');
}
