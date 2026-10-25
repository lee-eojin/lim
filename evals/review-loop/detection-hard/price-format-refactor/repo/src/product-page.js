import { STORE_CURRENCY, STORE_LOCALE } from './config.js';

function formatPrice(amountCents) {
  const formatter = new Intl.NumberFormat(STORE_LOCALE, { style: 'currency', currency: STORE_CURRENCY });
  return formatter.format(amountCents / 100);
}

export function productCard(product) {
  const price = formatPrice(product.priceCents);
  const was = product.listPriceCents > product.priceCents ? formatPrice(product.listPriceCents) : null;
  return { title: product.name, price, was };
}
