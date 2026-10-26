import { startOfDay } from './dates.js';

export function chargeRenewal(ledger, subscription, periodStart) {
  ledger.record({
    at: startOfDay(periodStart),
    kind: 'renewal',
    subscriptionId: subscription.id,
    amountCents: subscription.priceCents,
  });
}

export function chargeUpgrade(ledger, subscription, at, amountCents) {
  ledger.record({ at, kind: 'upgrade', subscriptionId: subscription.id, amountCents });
}
