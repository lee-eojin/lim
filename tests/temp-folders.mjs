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
  for (const folder of created.splice(0)) removeFolder(folder);
});
