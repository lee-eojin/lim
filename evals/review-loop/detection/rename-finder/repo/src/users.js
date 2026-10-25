const users = new Map();

export function saveUser(user) {
  users.set(user.id, user);
  return user;
}

export function getUsr(id) {
  return users.get(id) ?? null;
}
