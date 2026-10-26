export class JobQueue {
  constructor() {
    this.jobs = [];
    this.wake = null;
  }

  push(job) {
    this.jobs.push(job);
    if (this.wake) {
      this.wake();
      this.wake = null;
    }
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      while (this.jobs.length > 0) yield this.jobs.shift();
      await new Promise((resolve) => { this.wake = resolve; });
    }
  }
}
