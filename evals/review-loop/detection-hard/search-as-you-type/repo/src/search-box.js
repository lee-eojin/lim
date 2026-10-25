import { searchProducts } from './api.js';
import { renderResults } from './render.js';

export function attachSearch(form, input, list) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const products = await searchProducts(input.value.trim());
    renderResults(list, products);
  });
}
