import { endOfDay, isoDate, startOfDay } from './dates.js';

export function dayStatement(ledger, day) {
  const from = startOfDay(day);
  const entries = ledger.entriesBetween(from, endOfDay(day));
  const totalCents = entries.reduce((sum, entry) => sum + entry.amountCents, 0);
  return { date: isoDate(from), entries, totalCents };
}
