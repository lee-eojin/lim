const products = [];

export function addProduct(product) {
  products.push(product);
}

export function listProducts() {
  return products.filter((product) => product.visible);
}
