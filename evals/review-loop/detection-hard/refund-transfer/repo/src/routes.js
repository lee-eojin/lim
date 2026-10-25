import { payOutSeller } from './payouts.js';

export const routes = {
  'POST /payouts': ({ seller, amountCents }) => payOutSeller(seller, amountCents),
};
