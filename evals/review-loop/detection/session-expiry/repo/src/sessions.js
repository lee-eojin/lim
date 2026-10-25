import { randomUUID } from 'node:crypto';

const sessions = new Map();

export function createSession(userId) {
  const id = randomUUID();
  sessions.set(id, { userId });
  return id;
}

export function getSession(id) {
  return sessions.get(id) ?? null;
}
