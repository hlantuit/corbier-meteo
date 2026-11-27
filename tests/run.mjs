// Offline render test: serves the site and answers every external request with fixtures.
import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); const { chromium } = require('playwright');
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import * as F from './fixtures.mjs';
const root = path.resolve(process.argv[2] || '..'); const out = process.argv[3] || '/tmp/shots'; fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.geojson': 'application/json' };
const srv = http.createServer((q, r) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html')); if (!fs.existsSync(p)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); }).listen(8765);
const now = Date.now();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const vw = +(process.env.VW || 1440), vh = +(process.env.VH || 900);
const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: +(process.env.DPR || 1) });
const page = await ctx.newPage();
const errors = []; const misses = new Set();
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
await page.route('**/*', async route => {
  const url = route.request().url();
  const json = o => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
  if (url.startsWith('http://localhost:8765')) return route.continue();
  if (url.includes('historical-forecast-api.open-meteo.com')) return json(F.historical(url, now));
  if (url.includes('api.open-meteo.com/v1/forecast')) return json(F.forecast(url, now));
  if (url.includes('ensemble-api.open-meteo.com')) return json(F.ensemble(url, now));
  if (url.includes('seasonal-api.open-meteo.com')) return json(F.seasonal(url, now));
  if (url.includes('tabular-api.data.gouv.fr')) return json(F.tabular(url, now));
  if (url.includes('data.geopf.fr/wms-r')) return route.fulfill({ status: 200, contentType: 'image/geotiff', headers: { 'access-control-allow-origin': '*' }, body: F.geotiff(url) });
  if (url.includes('data.geopf.fr/wfs')) return json(F.wfs(url));
  if (url.includes('overpass-api.de')) return json(F.overpass());
  if (url.includes('skaping.s3') || url.includes('quanteec')) return route.fulfill({ status: 200, contentType: 'image/jpeg', body: fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), url.includes('quanteec') ? 'cam-live.jpg' : 'cam-pano.jpg')) });
  if (url.includes('data.geopf.fr/wmts') || url.includes('gibs.earthdata')) return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: F.transparentPng });
  misses.add(url.slice(0, 120)); return route.fulfill({ status: 404, body: '' });
});
await page.goto('http://localhost:8765/index.html' + (process.env.HASH || ''), { waitUntil: 'load' });
await page.waitForTimeout(+(process.env.WAIT || 9000));
if (process.env.LANG_EN) { await page.click('button[data-lang="en"]'); await page.waitForTimeout(1500); }
if (process.env.MODE3D) { await page.click('#btn-3d'); await page.waitForTimeout(6000); }
if (process.env.SNOWLINE) { await page.click('input[value="line"]'); await page.waitForTimeout(2500); }
if (process.env.SNOWNOW) { await page.click('input[value="depth"]'); await page.waitForTimeout(2500); }
if (process.env.DAY) { await page.click(`.day[data-d="${process.env.DAY}"]`); await page.waitForTimeout(2000); }
if (process.env.CUMUL) { await page.click('.seg-mini button[data-c="1"]'); await page.waitForTimeout(2000); }
if (process.env.PROBE) console.log('PROBE', await page.evaluate(process.env.PROBE));
await page.screenshot({ path: `${out}/hero.png` });
if (!process.env.HERO_ONLY) {
  await page.screenshot({ path: `${out}/full.png`, fullPage: true });
  for (const id of ['h48', 'd15', 'models', 'season', 'archive']) { const el = await page.$('#' + id); if (el) await el.screenshot({ path: `${out}/${id}.png` }); }
}
console.log('ERRORS:\n' + errors.slice(0, 30).join('\n')); console.log('MISSES:\n' + [...misses].join('\n'));
await browser.close(); srv.close();
