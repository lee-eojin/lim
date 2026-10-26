import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { uploadArchive } from './storage.js';

export async function archiveDay(day, { bucket, dir }) {
  const file = path.join(dir, `${day}.ndjson`);
  const body = await readFile(file);
  const key = await uploadArchive(bucket, `reports/${day}.ndjson`, body);
  await unlink(file);
  return key;
}
