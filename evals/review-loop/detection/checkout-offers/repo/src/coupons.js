const coupons = new Map();

export function addCoupon(coupon) {
  coupons.set(coupon.code, coupon);
}

export function findCoupon(code) {
  return coupons.get(code.trim().toUpperCase()) ?? null;
}
