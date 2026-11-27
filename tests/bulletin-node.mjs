// Runs scripts/update-bulletin.mjs offline: every request is answered by the test fixtures (no GITHUB_TOKEN → draft only)
import * as F from './fixtures.mjs';
import { fileURLToPath } from 'node:url';
const now = Date.now();
globalThis.fetch = async url => {
  url = String(url);
  const body = url.includes('historical-forecast-api') ? F.historical(url, now) : url.includes('api.open-meteo.com/v1/forecast') ? F.forecast(url, now)
    : url.includes('ensemble-api') ? F.ensemble(url, now) : url.includes('tabular-api') ? F.tabular(url, now) : null;
  return { ok: !!body, status: body ? 200 : 404, json: async () => body || {} };
};
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
delete process.env.GITHUB_TOKEN;
await import('../scripts/update-bulletin.mjs');
