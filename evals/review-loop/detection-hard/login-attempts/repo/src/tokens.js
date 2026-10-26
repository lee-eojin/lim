import { randomBytes } from 'node:crypto';

export function issueToken(sessions, user) {
  const token = randomBytes(24).toString('base64url');
  sessions.set(token, { userId: user.id, createdAt: Date.now() });
  return token;
}
