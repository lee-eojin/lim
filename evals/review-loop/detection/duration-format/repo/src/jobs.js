import { formatBytes } from './format.js';

export async function runJob(job, log) {
  const startedAt = Date.now();
  const result = await job.run();
  log(`${job.name} wrote ${formatBytes(result.bytes)} in ${Date.now() - startedAt} ms`);
  return result;
}
