import { getUsr } from './users.js';

export function profileView(id) {
  const user = getUsr(id);
  return user ? { id: user.id, displayName: user.displayName } : null;
}
