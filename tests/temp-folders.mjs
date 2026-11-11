import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after } from 'node:test';

const created = [];

export function removeAfterTests(folder) {
  created.push(folder);
  return folder;
}

export const temporaryFolder = (prefix) => removeAfterTests(mkdtempSync(path.join(tmpdir(), prefix)));

export const removeFolder = (folder) => rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

after(() => {
  const failures = [];
  for (const folder of created.splice(0)) {
    try {
      removeFolder(folder);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, `could not remove ${failures.length} temporary folder(s)`);
});
