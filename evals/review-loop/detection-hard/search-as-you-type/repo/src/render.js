export function renderResults(list, products) {
  list.replaceChildren(...products.map((product) => {
    const item = document.createElement('li');
    item.textContent = product.name;
    return item;
  }));
}
