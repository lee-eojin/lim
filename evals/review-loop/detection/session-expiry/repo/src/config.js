export const config = {
  sessionTtlSeconds: Number(process.env.SESSION_TTL_SECONDS ?? 1800),
  cookieName: 'sid',
};
