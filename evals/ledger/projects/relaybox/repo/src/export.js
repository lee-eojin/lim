export function legacyExport(records) {
  return records.map((record) => `${record.id},${record.size}`).join('\n');
}

export function exportJson(records) {
  return JSON.stringify(records);
}
