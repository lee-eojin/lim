const DEFAULTS = { baseUrl: 'http://localhost:8080', retries: 2, timeoutMs: 5000 };

export function createClient(fetchImpl = fetch) {
  const config = DEFAULTS;
  return {
    async get(path) {
      let lastError;
      for (let attempt = 0; attempt <= config.retries; attempt += 1) {
        try {
          return await fetchImpl(`${config.baseUrl}${path}`, { signal: AbortSignal.timeout(config.timeoutMs) });
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError;
    },
  };
}
