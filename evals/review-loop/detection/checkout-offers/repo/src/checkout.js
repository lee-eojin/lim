import { findCoupon } from './coupons.js';

export function applyCoupon(cart, code) {
  const coupon = findCoupon(code);
  if (!coupon || coupon.expiresAt <= Date.now()) {
    return { ...cart, coupon: null };
  }
  return { ...cart, coupon, total: Math.round(cart.total * (1 - coupon.percent / 100)) };
}
