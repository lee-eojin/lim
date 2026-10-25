export function createInvoice(account, now) {
  return { accountId: account.id, amountCents: account.planCents, issuedAt: now.toISOString() };
}
