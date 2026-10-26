export class KeyValueStore {
  constructor(entries = []) {
    this.values = new Map(entries);
  }

  async get(key) {
    const value = this.values.get(key);
    return value === undefined ? undefined : structuredClone(value);
  }

  async set(key, value) {
    this.values.set(key, structuredClone(value));
  }
}
