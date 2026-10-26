import { appendFileSync } from 'node:fs';

const toLine = (event) => `${JSON.stringify(event)}\n`;

export function createAuditWriter(file) {
  return (events) => {
    appendFileSync(file, events.map(toLine).join(''));
  };
}
