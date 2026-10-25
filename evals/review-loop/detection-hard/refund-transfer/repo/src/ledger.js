const balances = new Map();

export const STORE_ACCOUNT = 'store';

export function balanceOf(accountId) {
  return balances.get(accountId) ?? 0;
}

export function transfer(toAccountId, fromAccountId, amountCents) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new RangeError(`invalid amount: ${amountCents}`);
  }
  balances.set(fromAccountId, balanceOf(fromAccountId) - amountCents);
  balances.set(toAccountId, balanceOf(toAccountId) + amountCents);
  return { toAccountId, fromAccountId, amountCents };
}
