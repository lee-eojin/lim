import { listProducts } from './catalog.js';

export function homePage(catalog) {
  return { newest: listProducts(catalog).slice(-4) };
}
