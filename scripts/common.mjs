// Helpers shared by the data-update scripts (Node ≥ 20, no dependencies).
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

export async function getJSON(url, { tries = 4, wait = 5000 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'corbier-meteo (GitHub Actions)' } });
      const txt = await r.text();
      let j; try { j = JSON.parse(txt); } catch (e) { throw new Error(`HTTP ${r.status}: ${txt.slice(0, 160)}`); }
      if (j && j.error) {
        // Open-Meteo rate limits: wait a minute and retry
        if (/limit/i.test(j.reason || '')) { log('rate limited, waiting 65 s'); await sleep(65000); continue; }
        throw new Error(j.reason);
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return j;
    } catch (e) { last = e; log('retry', i + 1, String(e).slice(0, 160)); await sleep(wait * (i + 1)); }
  }
  throw last;
}

export function writeJSON(rel, obj) {
  const p = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj));
  log('wrote', rel, (fs.statSync(p).size / 1024).toFixed(1), 'kB');
}

// Météo-France hourly observations through the data.gouv.fr tabular API
export const MF = { latest: '7c18ae09-a2bb-49f5-9f0d-990bc8df78ef', previous: '10fcc3fa-d8cf-4b5d-bdda-e758939defdf' };
export async function fetchStationHourly(station, sinceKey /* 'YYYYMMDDHH' */) {
  const rows = {};
  for (const rid of [MF.previous, MF.latest]) {
    const u = new URL(`https://tabular-api.data.gouv.fr/api/resources/${rid}/data/`);
    u.searchParams.set('NUM_POSTE__exact', station);
    u.searchParams.set('AAAAMMJJHH__greater', sinceKey);
    u.searchParams.set('page_size', '200');
    let next = u.toString(); let pages = 0;
    while (next) {
      const j = await getJSON(next);
      for (const d of j.data || []) rows[String(d.AAAAMMJJHH)] = [d.T, d.RR1, d.NEIGETOT, d.HNEIGEF];
      next = j.links && j.links.next ? j.links.next : null; pages++;
    }
    log(`station ${station} resource ${rid.slice(0, 8)}: ${pages} pages`);
  }
  return rows;
}
