import { createServer } from 'node:http';
import { formatSize } from './format.js';

export const port = Number(process.env.RELAY_PORT ?? 8080);

export function start() {
  return createServer((request, response) => {
    response.end(formatSize(Number(request.headers['content-length'] ?? 0)));
  }).listen(port);
}
