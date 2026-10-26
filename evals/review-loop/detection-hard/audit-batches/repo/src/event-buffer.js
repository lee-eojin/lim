export class EventBuffer {
  constructor({ size, write }) {
    this.size = size;
    this.write = write;
    this.items = [];
  }

  add(event) {
    this.items.push(event);
    if (this.items.length >= this.size) this.flush();
  }

  flush() {
    if (this.items.length === 0) return;
    this.write(this.items);
    this.items.length = 0;
  }
}
