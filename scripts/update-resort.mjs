// Resort snow report of Le Corbier (Office de Tourisme page, public, robots.txt allows it):
// snow depth and fresh snow declared by the resort at L'Ouillon (2,431 m) and Le Corbier (1,550 m),
// snow quality, avalanche risk (European scale, copied by the resort from Météo-France's BERA),
// open pistes by colour and open lifts. Written to data/resort.json; on any parsing doubt the old file is kept.
import fs from 'node:fs';

const URL_EN = 'https://www.le-corbier.com/en/slope-snow-information/';
const log = (...a) => console.log('[resort]', ...a);

const RISK = { // English and French labels → level 1–5
  LOW: 1, FAIBLE: 1, MODERATE: 2, LIMITED: 2, LIMITE: 2, 'LIMITÉ': 2, CONSIDERABLE: 3, MARQUE: 3, 'MARQUÉ': 3,
  HIGH: 4, FORT: 4, 'VERY HIGH': 5, 'TRES FORT': 5, 'TRÈS FORT': 5,
};
const undef = v => !v || /^non d/i.test(v) || /^(n\/a|-|undefined)$/i.test(v);

const r = await fetch(URL_EN, { headers: { 'User-Agent': 'corbier-meteo (personal snow dashboard; github.com/hlantuit/corbier-meteo)' } });
if (!r.ok) { log('HTTP', r.status); process.exit(1); }
const html = await r.text();

// Pistes by colour: <span class="am-dot" style="...background:#4CAF50...">0/ 12
const COLOUR = { '#4caf50': 'green', '#1565c0': 'blue', '#c62828': 'red', '#212121': 'black' };
const pistes = {};
for (const m of html.matchAll(/am-dot"[^>]*background:\s*(#[0-9a-f]{6})[^>]*><\/span>\s*(\d+)\s*\/\s*(\d+)/gi)) {
  const k = COLOUR[m[1].toLowerCase()]; if (k) pistes[k] = { open: +m[2], total: +m[3] };
}

const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, '\n')
  .replace(/&#0?39;|&rsquo;/g, "'").replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n');

// Station blocks: "L'OUILLON - 2431m ... Avalanche risk: X"
const stations = [];
const re = /\n\s*([A-ZÀ-Ü' -]{3,40}?)\s*-\s*(\d{3,4})\s*m\s*\n([\s\S]*?Avalanche risk:\s*\n?\s*[^\n]+)/g;
for (const m of text.matchAll(re)) {
  const body = m[3]; const field = name => { const f = body.match(new RegExp(name + ':\\s*\\n?\\s*([^\\n]+)')); return f ? f[1].trim() : null; };
  const cm = v => (undef(v) ? null : (v.match(/(-?\d+(?:[.,]\d+)?)/) ? +v.match(/(-?\d+(?:[.,]\d+)?)/)[1].replace(',', '.') : null));
  const risk = field('Avalanche risk'); const level = undef(risk) ? null : (RISK[risk.toUpperCase()] ?? (risk.match(/^[1-5]/) ? +risk[0] : null));
  stations.push({
    name: m[1].trim().replace(/\b(\w)(\w*)/g, (_, a, b) => a + b.toLowerCase()).replace(/^L'(\w)/, (_, a) => "L'" + a.toUpperCase()),
    z: +m[2],
    lastUpdate: undef(field('Last update')) ? null : field('Last update'),
    lastSnowfall: undef(field('Last snowfall')) ? null : field('Last snowfall'),
    quality: undef(field('Snow quality')) ? null : field('Snow quality'),
    fresh: cm(field('Fresh snow')), total: cm(field('Total snow')),
    avalanche: undef(risk) ? null : risk, avalancheLevel: level,
  });
}
const lifts = {};
for (const [k, lab] of [['chairlift', 'Chairlift'], ['draglift', 'Drag lift'], ['carpet', 'Magic carpet']]) {
  const m = text.match(new RegExp(lab + ':\\s*\\n?\\s*(\\d+)\\s*/\\s*(\\d+)')); if (m) lifts[k] = { open: +m[1], total: +m[2] };
}
const nordic = (() => { const m = text.match(/Nordic area\s*\n\s*([\d.,]+)\s*km\s*\/\s*([\d.,]+)\s*km/); return m ? { open: +m[1].replace(',', '.'), total: +m[2].replace(',', '.') } : null; })();

const ok = stations.length >= 1 && stations.some(s => s.total !== null || s.avalancheLevel !== null);
if (!ok) { log('could not parse the report: data/resort.json left unchanged'); log(text.slice(0, 1500)); process.exit(1); }
const out = { fetched: new Date().toISOString(), source: URL_EN, stations, pistes, lifts, nordic };
fs.writeFileSync('data/resort.json', JSON.stringify(out, null, 1));
log(JSON.stringify(out));
