export async function getCustomer(db, id) {
  const rows = await db.query('SELECT id, name, email FROM customers WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function listCustomers(db, limit = 50) {
  return db.query('SELECT id, name, email FROM customers ORDER BY id LIMIT $1', [limit]);
}
