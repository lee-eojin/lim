import { featuresFor } from './plans.js';

export function canUse(account, feature) {
  return featuresFor(account.plan).includes(feature);
}
