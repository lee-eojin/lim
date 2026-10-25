const rows = new Map();

export function saveUser(user) {
  rows.set(user.id, {
    id: user.id,
    email: user.email,
    preferences_json: user.savedPreferences ? JSON.stringify(user.savedPreferences) : null,
  });
}

export function loadUser(id) {
  const row = rows.get(id);
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    savedPreferences: row.preferences_json ? JSON.parse(row.preferences_json) : null,
  };
}
