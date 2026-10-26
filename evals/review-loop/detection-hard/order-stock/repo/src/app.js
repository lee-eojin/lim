import { createServer } from 'node:http';

export function createApp() {
  const routes = [];
  const add = (method) => (pattern, handler) => {
    const names = [];
    const regex = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, name) => { names.push(name); return '([^/]+)'; })}$`);
    routes.push({ method, regex, names, handler });
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const route = routes.find((entry) => entry.method === req.method && entry.regex.test(url.pathname));
    if (!route) {
      res.writeHead(404).end();
      return;
    }
    const match = route.regex.exec(url.pathname);
    const params = Object.fromEntries(route.names.map((name, index) => [name, match[index + 1]]));
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    const result = await route.handler({ params, body, query: Object.fromEntries(url.searchParams) });
    res.writeHead(result.status, { 'content-type': 'application/json' }).end(result.body ? JSON.stringify(result.body) : undefined);
  });
  return { get: add('GET'), post: add('POST'), listen: (port) => server.listen(port) };
}
