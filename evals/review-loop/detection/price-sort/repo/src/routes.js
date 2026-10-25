import { listProducts } from './catalog.js';

export function productsHandler(catalog, query) {
  return listProducts(catalog, query.category);
}
