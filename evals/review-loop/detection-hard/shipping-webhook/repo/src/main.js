import { healthCheck } from './health.js';
import { routes, startServer } from './server.js';

routes.set('GET /health', healthCheck);

startServer(Number(process.env.PORT ?? 3000));
