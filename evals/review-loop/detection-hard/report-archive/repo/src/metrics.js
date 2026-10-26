import { retry } from './retry.js';

export async function pushMetrics(client, points) {
  await retry(() => client.send('/metrics', points), { attempts: 2, label: 'metrics' });
}
