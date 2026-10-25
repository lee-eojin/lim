import { fetchRate } from './rates.js';

export async function priceIn(client, product, currency) {
  const rate = await fetchRate(client, currency);
  return Math.round(product.priceCents * rate);
}
