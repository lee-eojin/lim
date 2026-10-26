import { verifyPassword } from './passwords.js';
import { issueToken } from './tokens.js';

const INVALID = { status: 401, body: { error: 'invalid email or password' } };

export function login(body, { users, sessions }) {
  const user = users.findByEmail(body.email);
  if (!user || !verifyPassword(body.password, user.passwordHash)) return INVALID;
  return { status: 200, body: { token: issueToken(sessions, user) } };
}
