import { login } from './login.js';
import { RateLimiter } from './rate-limit.js';

export function registerRoutes(app, { users, sessions, mailer }) {
  const resetLimiter = new RateLimiter({ limit: 3, windowMs: 60 * 60 * 1000 });

  app.post('/login', (request) => login(request.body, { users, sessions }));

  app.post('/password-reset', async (request) => {
    if (!resetLimiter.allow(`reset:${request.ip}`)) return { status: 429, body: { error: 'too many requests' } };
    const user = users.findByEmail(request.body.email);
    if (user) await mailer.sendResetLink(user);
    return { status: 202 };
  });
}
