import { STORE_ACCOUNT, transfer } from './ledger.js';

export function payOutSeller(seller, amountCents) {
  return transfer(seller.accountId, STORE_ACCOUNT, amountCents);
}
