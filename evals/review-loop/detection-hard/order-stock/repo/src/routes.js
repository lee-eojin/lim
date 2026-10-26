import { createOrder } from './orders.js';

const validItem = (item) => typeof item?.sku === 'string' && Number.isInteger(item.quantity) && item.quantity > 0;

export function registerRoutes(app, { orders, queue }) {
  app.post('/orders', async (request) => {
    const items = request.body?.items;
    if (!Array.isArray(items) || items.length === 0 || !items.every(validItem)) {
      return { status: 400, body: { error: 'items must be a non-empty list of { sku, quantity }' } };
    }
    const order = createOrder(items);
    await orders.set(order.id, order);
    queue.push({ orderId: order.id });
    return { status: 202, body: order };
  });

  app.get('/orders/:id', async (request) => {
    const order = await orders.get(request.params.id);
    return order ? { status: 200, body: order } : { status: 404 };
  });
}
