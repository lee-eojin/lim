import { processOrder } from './orders.js';

export async function runOrderWorker(queue, services) {
  for await (const job of queue) {
    try {
      await processOrder(job.orderId, services);
    } catch (error) {
      console.error(`order ${job.orderId} failed`, error);
    }
  }
}
