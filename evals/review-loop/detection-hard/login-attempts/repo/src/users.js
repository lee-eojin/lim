import { normalizeEmail } from './emails.js';

export class UserStore {
  constructor() {
    this.byEmail = new Map();
  }

  add(user) {
    this.byEmail.set(normalizeEmail(user.email), user);
  }

  findByEmail(email) {
    return this.byEmail.get(normalizeEmail(email));
  }
}
