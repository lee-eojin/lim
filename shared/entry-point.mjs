import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function isEntryPoint(moduleUrl) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync.native(process.argv[1]) === realpathSync.native(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
