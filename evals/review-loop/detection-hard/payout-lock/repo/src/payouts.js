import { acquire } from './locks.js';

export async function sendPayout(payoutId, { payouts, bank }) {
  const release = await acquire(`payout:${payoutId}`);
  try {
    const payout = await payouts.get(payoutId);
    if (payout.status === 'sent') {
      return payout;
    }
    const transferId = await bank.send(payout.accountNumber, payout.amountCents);
    return await payouts.update(payoutId, { status: 'sent', transferId });
  } finally {
    release();
  }
}
