import { createApp } from './app.js';
import { KeyValueStore } from './kv.js';
import { JobQueue } from './queue.js';
import { registerRoutes } from './routes.js';
import { runOrderWorker } from './worker.js';

const orders = new KeyValueStore();
const queue = new JobQueue();
const app = createApp();

registerRoutes(app, { orders, queue });
runOrderWorker(queue, { orders });
app.listen(Number(process.env.PORT ?? 3000));
