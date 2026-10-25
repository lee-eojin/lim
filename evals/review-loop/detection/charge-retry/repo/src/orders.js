import { chargeOrder } from './payments.js';

export async function placeOrder(order, gateway, warehouse) {
  const charged = await chargeOrder(order, gateway);
  if (charged.status === 'paid') {
    await warehouse.ship(charged.id);
  }
  return charged;
}
