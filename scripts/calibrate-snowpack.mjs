// Multi-winter calibration of the snowpack model (assets/js/snowpack.js) against Météo-France snow depths.
//
// Observations: daily snow depth at 06 UTC (NEIGETOT06) from the Météo-France daily climatological files for Savoie
//   (data.gouv.fr "Données climatologiques de base - quotidiennes", open licence). Only dated, located Météo-France
//   measurements are used; resort-declared depths are not (no measurement time, no documented site).
// Forcing: the same as the live page, i.e. the models' own analyses from Open-Meteo's historical-forecast API at
//   Le Corbier (mean of icon_seamless, meteofrance_seamless, ecmwf_ifs025), available from autumn 2022.
// Method: the eight model constants (see DEFAULTS in snowpack.js) are fitted by a bounded coordinate search on the
//   distance-weighted squared error of all winters (each station-winter carries equal weight), with weak priors on
//   the hand-set values. Skill is judged out of sample: each winter is predicted with constants fitted on the other
//   winters, and compared with the hand-set constants. Two set-ups are scored: "free run" (k, dT fixed) and
//   "live" (k, dT refitted to that winter's own data, as the page does during a season).
// Output: data/snowcal.json. If the calibrated constants do not beat the defaults out of sample, the defaults are
//   written with that verdict (never an empty or silently stale file).
import fs from 'node:fs';
import zlib from 'node:zlib';
import * as D from '../assets/js/data.js';
import * as SP from '../assets/js/snowpack.js';
import { SITE } from '../assets/js/config.js';

const log = (...a) => console.log('[snowcal]', ...a);
const HOUR = 3600e3, DAY = 24 * HOUR;
const QUOT = 'https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/BASE/QUOT/';
const FILES = ['Q_73_previous-1950-2024_autres-parametres.csv.gz', 'Q_73_latest-2025-2026_autres-parametres.csv.gz'];
const FIRST_WINTER = 2022;
const FLAT = !!process.env.FLAT; // FLAT=1: treat every station as flat ground (for comparison) // forcing (ICON + Météo-France analyses) starts in autumn 2022

// ---------- stations ----------
const STATIONS = SITE.snowStations.map(s => ({ ...s, km: Math.hypot((s.lat - SITE.lat) * 111.2, (s.lon - SITE.lon) * 78.5) }));
STATIONS.forEach(s => { s.wd = Math.exp(-s.km / 12); });

// ---------- observations ----------
async function loadObs() {
  const ids = new Set(STATIONS.map(s => s.id)); const rows = [];
  for (const f of FILES) {
    const r = await fetch(QUOT + f); if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
    const text = zlib.gunzipSync(Buffer.from(await r.arrayBuffer())).toString('utf8');
    const lines = text.split('\n'); const head = lines[0].split(';');
    const c = n => head.indexOf(n); const iP = c('NUM_POSTE'), iD = c('AAAAMMJJ'), iH = c('NEIGETOT06'), iQ = c('QNEIGETOT06');
    if (iP < 0 || iD < 0 || iH < 0) throw new Error(`${f}: unexpected columns`);
    let n = 0;
    for (let i = 1; i < lines.length; i++) {
      const v = lines[i].split(';'); if (!ids.has(v[iP])) continue;
      const d = v[iD]; if (!d || d < `${FIRST_WINTER}1001`) continue;
      const hs = v[iH] === undefined || v[iH].trim() === '' ? null : +v[iH].replace(',', '.');
      if (hs === null || !Number.isFinite(hs) || hs < 0 || hs > 600) continue;
      if (iQ >= 0 && v[iQ] && v[iQ].trim() === '0') continue; // quality code 0 = rejected
      rows.push({ station: v[iP], time: Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), 6), hs }); n++;
    }
    log(f, n, 'rows');
  }
  return rows;
}

// ---------- forcing, one hourly series per winter (1 Oct → 15 Jun, or now) ----------
async function loadWinters(obs) {
  const now = Date.now(); const out = [];
  for (let y = FIRST_WINTER; Date.UTC(y, 9, 1) < now; y++) {
    const start = Date.UTC(y, 9, 1), end = Math.min(Date.UTC(y + 1, 5, 15), now - DAY);
    const o = obs.filter(r => r.time >= start && r.time <= end);
    if (o.length < 30) { log(`winter ${y}-${y + 1}: only ${o.length} observations, skipped`); continue; }
    let hist = null;
    for (let a = 0; a < 3 && !hist; a++) { try { hist = await D.fetchHistory(start, end); } catch (e) { log('history retry', e.message); await new Promise(r => setTimeout(r, 20e3)); } }
    if (!hist) throw new Error(`no forcing for ${y}-${y + 1}`);
    // forcing that starts late in the autumn (2022: 9 November) is usable if it starts before any snow is measured
    // (the model starts snow-free, so stations that already had snow at that date are left out for that winter)
    const first = hist.t.findIndex(v => v !== null); const skip = new Set();
    if (first > 0) {
      const t0 = hist.time[first];
      if (t0 < Date.UTC(y, 11, 1)) {
        for (const k of ['time', 't', 'rh', 'p']) hist[k] = hist[k].slice(first);
        for (const s of STATIONS) {
          const before = o.filter(r => r.station === s.id && r.time <= t0 + DAY).sort((a, b) => b.time - a.time)[0];
          if (before && before.hs > 1) skip.add(s.id);
        }
        log(`winter ${y}-${y + 1}: forcing starts ${new Date(t0).toISOString().slice(0, 10)}; left out (snow already on the ground): ${[...skip].join(', ') || 'none'}`);
      }
    }
    const missing = hist.t.filter(v => v === null).length / hist.t.length;
    if (missing > 0.05) { log(`winter ${y}-${y + 1}: ${Math.round(missing * 100)} % of forcing hours missing, skipped`); continue; }
    // observations grouped by station, as hour indices into the forcing
    const groups = STATIONS.filter(s => !skip.has(s.id)).map(s => {
      const m = new Map(); let n = 0;
      for (const r of o) if (r.station === s.id) { const i = Math.round((r.time - hist.time[0]) / HOUR); if (i >= 0 && i < hist.time.length) { m.set(i, r.hs); n++; } }
      // melt scale of the site's own slope, precomputed per forcing hour (stations are not on flat ground)
      const f = FLAT ? null : SP.siteMeltScale(s.slope || 0, s.aspect);
      const msArr = f ? Float32Array.from(hist.time, f) : null; const t0 = hist.time[0];
      return { s, m, n, last: n ? Math.max(...m.keys()) : -1, ms: msArr ? t => msArr[Math.round((t - t0) / HOUR)] : null };
    }).filter(g => g.n >= 10);
    out.push({ label: `${y}-${String(y + 1).slice(2)}`, y, hist, groups, nObs: groups.reduce((a, g) => a + g.n, 0) });
    log(`winter ${y}-${y + 1}: ${groups.length} stations, ${out[out.length - 1].nObs} observations, ${hist.time.length} forcing hours`);
  }
  return out;
}

// ---------- scoring ----------
const BOUNDS = { k: [0.5, 2.0], dT: [-3, 3], grad: [0, 0.8], ddfW: [0.1, 6], ddfS: [2, 10], twMid: [-0.75, 2.25], tauCold: [24, 480], rhoCold: [250, 450] };
const STEP0 = { k: 0.2, dT: 1, grad: 0.2, ddfW: 1, ddfS: 2, twMid: 0.5, tauCold: 60, rhoCold: 40 };
const PRIOR_SD = { k: 0.5, dT: 1.5, grad: 0.4, ddfW: 2, ddfS: 3, twMid: 1, tauCold: 150, rhoCold: 80 };
const KEYS = Object.keys(SP.DEFAULTS);

// Weighted squared error of one winter for constants `par`; per station: { se, w, n, bias }
function scoreWinter(W, par, detail = false) {
  SP.setParams(par);
  let se = 0, sw = 0; const st = detail ? [] : null;
  for (const g of W.groups) {
    const ph = SP.pastPhase(W.hist, g.s.elev, par.dT);
    const wObs = g.s.wd / g.n; let gse = 0, gb = 0;
    SP.runPast(W.hist, ph, par.k, W.hist.time[g.last], (i, s) => { const o = g.m.get(i); if (o !== undefined) { const e = s.h - o; gse += e * e; gb += e; } }, g.ms);
    se += wObs * gse; sw += wObs * g.n;
    if (st) st.push({ id: g.s.id, name: g.s.name, z: g.s.elev, n: g.n, rmse: Math.sqrt(gse / g.n), bias: gb / g.n });
  }
  return { mse: se / sw, sw, stations: st };
}
const prior = par => KEYS.reduce((a, k) => a + ((par[k] - SP.DEFAULTS[k]) / PRIOR_SD[k]) ** 2, 0);
function cost(winters, par) {
  let s = 0, w = 0; for (const W of winters) { const r = scoreWinter(W, par); s += r.mse * r.sw; w += r.sw; }
  return s / w + 4 * prior(par); // weak priors: one prior s.d. costs as much as 2 cm of RMS error²/…
}

// Bounded coordinate search with step halving
function calibrate(winters, keys = KEYS, start = SP.DEFAULTS) {
  let par = { ...start }; let best = cost(winters, par);
  const step = Object.fromEntries(keys.map(k => [k, STEP0[k]]));
  for (let halvings = 0; halvings < 5;) {
    let improved = false;
    for (const k of keys) for (const dir of [1, -1]) {
      const v = +Math.min(BOUNDS[k][1], Math.max(BOUNDS[k][0], par[k] + dir * step[k])).toFixed(4);
      if (v === par[k]) continue;
      const cand = { ...par, [k]: v }; const c = cost(winters, cand);
      if (c < best - 1e-6) { best = c; par = cand; improved = true; }
    }
    if (!improved) { keys.forEach(k => { step[k] /= 2; }); halvings++; }
  }
  return { par, cost: best };
}

// Live set-up: k, dT refitted to the winter itself (as the page does), other constants given
function liveScore(W, base) {
  const fit = calibrate([W], ['k', 'dT'], base).par;
  return { k: fit.k, dT: fit.dT, ...scoreWinter(W, fit) };
}
const rms = x => +Math.sqrt(x).toFixed(1);

// ---------- main ----------
const obs = await loadObs();
const winters = await loadWinters(obs);
if (winters.length < 3) { log(`only ${winters.length} usable winters: data/snowcal.json left unchanged`); process.exit(1); }

const defaults = { ...SP.DEFAULTS };
const lowo = [];
for (const W of winters) {
  const train = winters.filter(x => x !== W);
  const cal = calibrate(train).par;
  const r = {
    winter: W.label, n: W.nObs,
    free: { default: rms(scoreWinter(W, defaults).mse), calibrated: rms(scoreWinter(W, cal).mse) },
    live: { default: rms(liveScore(W, defaults).mse), calibrated: rms(liveScore(W, cal).mse) },
    params: Object.fromEntries(KEYS.map(k => [k, +cal[k].toFixed(3)])),
  };
  lowo.push(r); log('held out', JSON.stringify(r));
}
const total = (set, which) => rms(winters.reduce((a, W, i) => a + lowo[i][set][which] ** 2 * W.nObs, 0) / winters.reduce((a, W) => a + W.nObs, 0));
const verdict = {
  free: { default: total('free', 'default'), calibrated: total('free', 'calibrated') },
  live: { default: total('live', 'default'), calibrated: total('live', 'calibrated') },
};
const better = verdict.free.calibrated < verdict.free.default && verdict.live.calibrated <= verdict.live.default + 0.5;
const final = better ? calibrate(winters).par : defaults;
const perStation = winters.map(W => ({ winter: W.label, stations: scoreWinter(W, final, true).stations.map(s => ({ ...s, rmse: +s.rmse.toFixed(1), bias: +s.bias.toFixed(1) })) }));
SP.setParams(defaults);

const out = {
  generated: new Date().toISOString(),
  used: better,
  verdict: better ? 'calibrated constants beat the hand-set ones out of sample' : 'calibrated constants did not beat the hand-set ones out of sample: defaults kept',
  params: Object.fromEntries(KEYS.map(k => [k, +final[k].toFixed(3)])),
  defaults,
  stationSlopes: !FLAT,
  forcing: 'Open-Meteo historical forecasts at Le Corbier 1,550 m (mean of icon_seamless, meteofrance_seamless, ecmwf_ifs025)',
  observations: 'Météo-France daily snow depth at 06 UTC (NEIGETOT06), Savoie daily climatological files, data.gouv.fr',
  stations: STATIONS.map(s => ({ id: s.id, name: s.name, z: s.elev, slope: s.slope || 0, aspect: s.aspect ?? null, km: +s.km.toFixed(1), weight: +s.wd.toFixed(2) })),
  winters: winters.map(W => ({ winter: W.label, observations: W.nObs, stations: W.groups.length })),
  skill: { rmseCm: verdict, heldOut: lowo, note: 'RMSE (cm) of daily snow depth, each winter predicted with constants fitted on the other winters; "live" refits k and dT to the winter itself' },
  perStation,
};
if (!process.env.DRY) fs.writeFileSync('data/snowcal.json', JSON.stringify(out, null, 1));
log('verdict:', out.verdict, JSON.stringify(verdict));
log('params:', JSON.stringify(out.params));
