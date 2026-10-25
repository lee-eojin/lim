import { getCustomer, listCustomers } from './customers.js';

export async function customersHandler(db, query) {
  if (query.id) {
    return getCustomer(db, query.id);
  }
  return listCustomers(db);
}
