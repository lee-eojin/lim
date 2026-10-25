import { renderInvoice } from './invoice.js';
import { findOrder } from './orders-store.js';

export const routes = {
  'GET /orders/:id/invoice': ({ params }) => {
    const order = findOrder(params.id);
    if (!order) return { status: 404 };
    return { status: 200, headers: { 'content-type': 'text/plain' }, body: renderInvoice(order) };
  },
};
