const orders = [];

export function addOrder(order) {
  orders.push(order);
  return order;
}

export function findOrder(id) {
  return orders.find((order) => order.id === id) ?? null;
}

export function listOrders({ from, to }) {
  return orders.filter((order) => order.createdAt >= from && order.createdAt < to);
}
