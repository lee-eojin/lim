export async function chargeOrder(order, gateway) {
  await gateway.charge(order.id, order.total);
  return { ...order, status: 'paid' };
}
