import { request } from './http.js';

export async function downloadExport(fetchImpl, baseUrl, exportId) {
  const response = await request(fetchImpl, `${baseUrl}/exports/${exportId}`);
  return response.arrayBuffer();
}
