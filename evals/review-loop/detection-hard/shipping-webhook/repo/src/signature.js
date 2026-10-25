import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.SHIPPING_WEBHOOK_SECRET ?? '';

export function verifySignature(header, rawBody) {
  if (!SECRET || typeof header !== 'string') return false;
  const expected = createHmac('sha256', SECRET).update(rawBody).digest('hex');
  const given = Buffer.from(header, 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}
