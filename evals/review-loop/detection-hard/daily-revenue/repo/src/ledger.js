export class Ledger {
  constructor() {
    this.entries = [];
  }

  record(entry) {
    this.entries.push(entry);
  }

  entriesBetween(from, to) {
    return this.entries.filter((entry) => entry.at >= from && entry.at <= to);
  }
}
