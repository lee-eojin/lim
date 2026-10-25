export function formatMoney(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

export function renderInvoice(order) {
  const lines = order.items.map((item) => `${item.name} x${item.quantity}  ${formatMoney(item.priceCents * item.quantity)}`);
  return [
    `Invoice ${order.id}`,
    `Date: ${formatDate(order.createdAt)}`,
    ...lines,
    `Total: ${formatMoney(order.totalCents)}`,
  ].join('\n');
}
