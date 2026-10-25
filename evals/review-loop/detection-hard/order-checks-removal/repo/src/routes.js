import { createOrder } from './orders.js';
import { validateOrderBody } from './validate.js';

export const routes = {
  'POST /orders': ({ body }) => {
    const problem = validateOrderBody(body);
    if (problem) return { status: 400, body: { error: problem } };
    return { status: 201, body: createOrder(body) };
  },
};
