import { getUsr, saveUser } from './users.js';

export function deactivate(id) {
  const user = getUsr(id);
  if (!user) {
    return null;
  }
  return saveUser({ ...user, active: false });
}
