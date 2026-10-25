const products = [];

export function addProduct(product) {
  products.push(product);
}

export function listProducts(limit) {
  return products.filter((product) => product.visible).slice(0, limit);
}
