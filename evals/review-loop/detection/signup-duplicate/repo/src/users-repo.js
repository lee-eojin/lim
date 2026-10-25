export function createUsersRepo(db) {
  return {
    async exists(email) {
      const rows = await db.query('SELECT 1 FROM users WHERE email = $1', [email]);
      return rows.length > 0;
    },
    async insert(user) {
      await db.query('INSERT INTO users (email, name) VALUES ($1, $2)', [user.email, user.name]);
    },
  };
}
