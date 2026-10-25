import { createServer } from 'node:http';

export const routes = new Map();

export function startServer(port) {
  return createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const handler = routes.get(`${request.method} ${request.url}`);
    if (!handler) {
      response.writeHead(404).end();
      return;
    }
    const result = await handler({ headers: request.headers, rawBody: Buffer.concat(chunks).toString('utf8') });
    response.writeHead(result.status, { 'content-type': 'application/json' }).end(JSON.stringify(result.body));
  }).listen(port);
}
