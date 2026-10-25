import { sendPayout } from './payouts.js';

export async function runPayouts(queue, services) {
  for await (const job of queue) {
    try {
      await sendPayout(job.payoutId, services);
      await job.ack();
    } catch (error) {
      console.error(`payout ${job.payoutId} failed`, error);
      await job.retryLater();
    }
  }
}
