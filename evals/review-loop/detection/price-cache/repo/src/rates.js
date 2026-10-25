export async function fetchRate(client, currency) {
  const response = await client.get(`/rates/${currency}`);
  return response.rate;
}
