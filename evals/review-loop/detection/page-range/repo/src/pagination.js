export function paginate(items, page, size) {
  const start = page * size;
  return {
    items: items.slice(start, start + size),
    page,
    pages: Math.ceil(items.length / size),
  };
}
