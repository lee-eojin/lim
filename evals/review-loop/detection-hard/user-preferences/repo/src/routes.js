import { loadUser } from './users-store.js';

export function getUser(id) {
  const user = loadUser(id);
  if (!user) return { status: 404 };
  return { status: 200, body: { id: user.id, email: user.email } };
}
