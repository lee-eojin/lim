export class RateLimiter {
  constructor({ limit, windowMs, now = Date.now }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.windows = new Map();
  }

  allow(key) {
    const time = this.now();
    const window = this.windows.get(key);
    if (!window || time - window.startedAt >= this.windowMs) {
      this.windows.set(key, { startedAt: time, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= this.limit;
  }

  reset(key) {
    this.windows.delete(key);
  }
}
