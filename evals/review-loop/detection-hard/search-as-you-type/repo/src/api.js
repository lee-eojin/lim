export async function searchProducts(term) {
  const response = await fetch(`/api/products?q=${encodeURIComponent(term)}`);
  if (!response.ok) throw new Error(`search failed: ${response.status}`);
  return response.json();
}
