import { lineTotal } from './lines.js';

export function orderTotal(order) {
  return order.lines.reduce((sum, line) => sum + lineTotal(line), 0);
}
