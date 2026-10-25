import { listProducts } from './products.js';

const DEFAULT_LIMIT = 20;

export function productsHandler() {
  return listProducts(DEFAULT_LIMIT);
}
