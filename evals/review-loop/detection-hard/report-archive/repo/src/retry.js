import { report } from './errors.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function retry(task, { attempts = 3, delayMs = 200, label = 'task' } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (attempt === attempts) return report(error, { label, attempts });
      await sleep(delayMs * attempt);
    }
  }
}
