export function report(error, context = {}) {
  console.error(JSON.stringify({ level: 'error', message: error.message, ...context }));
}
