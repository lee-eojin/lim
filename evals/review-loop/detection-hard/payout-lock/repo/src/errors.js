export class PayoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PayoutError';
  }
}
