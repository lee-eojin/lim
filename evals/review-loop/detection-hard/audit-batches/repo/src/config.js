export const config = {
  port: Number(process.env.PORT ?? 3000),
  auditFile: process.env.AUDIT_FILE ?? 'audit.ndjson',
  auditBatchSize: 20,
};
