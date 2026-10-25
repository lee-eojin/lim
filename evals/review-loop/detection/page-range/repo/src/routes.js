import { paginate } from './pagination.js';
import { listProducts } from './products.js';

const PAGE_SIZE = 20;

export function productsHandler(query) {
  const page = Number.parseInt(query.page ?? '0', 10);
  return paginate(listProducts(), page, PAGE_SIZE);
}
