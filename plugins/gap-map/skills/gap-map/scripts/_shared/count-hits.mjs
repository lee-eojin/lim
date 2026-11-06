
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SEARCH_FILE_LIMIT = 20000;

function listFiles(target, files, ignored, skippedFolders) {
  if (files.length > SEARCH_FILE_LIMIT || ignored.has(target)) return files;
  const stat = lstatSync(target);
  if (stat.isFile()) files.push(target);
  else if (stat.isDirectory()) {
    for (const name of readdirSync(target).sort()) {
      if (!skippedFolders.has(name)) listFiles(path.join(target, name), files, ignored, skippedFolders);
    }
  }
  return files;
}

export function countHitsSkipping(skippedFolders) {
  return function countHits(root, scope, needle, ignored = []) {
    const target = path.resolve(root, scope);
    if (!existsSync(target)) return { error: `scope ${scope} does not exist` };
    const files = listFiles(target, [], new Set(ignored.map((file) => path.resolve(file))), skippedFolders);
    if (files.length > SEARCH_FILE_LIMIT) return { error: `scope ${scope} has more than ${SEARCH_FILE_LIMIT} files; narrow it` };
    let hits = 0;
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (let index = text.indexOf(needle); index !== -1; index = text.indexOf(needle, index + needle.length)) hits += 1;
    }
    return { hits, files: files.length };
  };
}
