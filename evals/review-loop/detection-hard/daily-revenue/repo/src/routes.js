import { dayStatement } from './statement.js';

export function registerRoutes(app, { ledger }) {
  app.get('/statements/:date', (request) => {
    const day = Date.parse(`${request.params.date}T00:00:00Z`);
    if (Number.isNaN(day)) return { status: 400, body: { error: 'date must be YYYY-MM-DD' } };
    return { status: 200, body: dayStatement(ledger, day) };
  });
}
