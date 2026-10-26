import { archiveDay } from './archive.js';
import { pushMetrics } from './metrics.js';

export async function runNightly(days, services) {
  const archived = [];
  for (const day of days) {
    try {
      archived.push(await archiveDay(day, services));
    } catch (error) {
      console.error(`archive for ${day} failed`, error);
    }
  }
  await pushMetrics(services.metrics, [{ name: 'reports.archived', value: archived.length }]);
  return archived;
}
