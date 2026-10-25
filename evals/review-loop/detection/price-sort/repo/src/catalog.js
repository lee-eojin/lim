let cache = null;

export async function loadCatalog(fetchItems) {
  if (cache === null) {
    cache = { items: await fetchItems(), loadedAt: Date.now() };
  }
  return cache;
}

export function listProducts(catalog, category) {
  return catalog.items.filter((item) => !category || item.category === category);
}
