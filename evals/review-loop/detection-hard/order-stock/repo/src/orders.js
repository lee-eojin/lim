let nextId = 1;

export function createOrder(items) {
  const quantities = new Map();
  for (const { sku, quantity } of items) {
    quantities.set(sku, (quantities.get(sku) ?? 0) + quantity);
  }
  const lines = [...quantities].map(([sku, quantity]) => ({ sku, quantity }));
  return { id: `ord_${nextId++}`, lines, status: 'pending' };
}

export async function processOrder(orderId, { orders }) {
  const order = await orders.get(orderId);
  if (order.status !== 'pending') return order;
  const confirmed = { ...order, status: 'confirmed' };
  await orders.set(orderId, confirmed);
  return confirmed;
}
