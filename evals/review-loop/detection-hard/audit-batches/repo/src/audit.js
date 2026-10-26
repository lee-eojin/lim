import { createAuditWriter } from './audit-writer.js';
import { config } from './config.js';
import { EventBuffer } from './event-buffer.js';

const buffer = new EventBuffer({ size: config.auditBatchSize, write: createAuditWriter(config.auditFile) });

export function recordAudit(actorId, action, target) {
  buffer.add({ at: new Date().toISOString(), actorId, action, target });
}

export function flushAudit() {
  buffer.flush();
}
