// Snow on the ground, elevation band by elevation band.
// A small snowpack model (snowfall, degree-day melt, settling) runs hourly from 1 October.
// Past hours are driven by the models' own analyses (Open-Meteo historical forecasts); future hours by the
// calibrated multi-model consensus. Two parameters (a precipitation factor and a temperature offset) are fitted
// so that the model reproduces the snow depth measured by Météo-France at Le Corbier and Saint-Jean-d'Arves,
// and the snowpack is then rescaled to the latest measurement.
import { wetBulb, snowDensity, clamp } from './data.js';
import { LAPSE, SITE } from './config.js';

const HOUR = 3600e3, DAY = 24 * HOUR;
export const BANDS = []; for (let z = 400; z <= 3600; z += 100) BANDS.push(z);

export function seasonStart(now = Date.now()) {
  const d = new Date(now); const y = d.getUTCMonth() >= 9 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return Math.max(Date.UTC(y, 9, 1), Math.floor((now - 240 * DAY) / DAY) * DAY);
}

// Degree-day melt factor (mm per °C per hour): 2 mm/°C/day at the winter solstice, 5 at the summer solstice
function ddf(ms) {
  const y = new Date(ms).getUTCFullYear(); const doy = (ms - Date.UTC(y, 0, 1)) / DAY;
  return (2 + 1.5 * (1 - Math.cos(2 * Math.PI * (doy - 355) / 365))) / 24;
}

// One hour of snowpack. st = { s: water equivalent (mm), h: depth (cm) }; dd = melt factor for that hour
const SETTLE_COLD = Math.exp(-1 / 120), SETTLE_WARM = Math.exp(-1 / 36);
function step(st, swe, rain, T, dd) {
  if (swe > 0) { st.s += swe; st.h += swe / snowDensity(T) * 100; }
  if (st.s <= 0) { st.s = 0; st.h = 0; return; }
  if (T > 0) {
    const m = dd * T + 0.0125 * (rain || 0) * T; // + sensible heat of rain (c·T/Lf)
    const f = Math.max(0, 1 - m / st.s); st.s *= f; st.h *= f;
  }
  if (st.s < 0.2) { st.s = 0; st.h = 0; return; }
  // settling towards 350 kg/m³ (cold snow) or 450 kg/m³ (wet snow)
  const warm = T > 0, rmax = warm ? 450 : 350;
  let rho = 100 * st.s / st.h;
  if (rho < rmax) { rho = rmax - (rmax - rho) * (warm ? SETTLE_WARM : SETTLE_COLD); st.h = 100 * st.s / rho; }
}

// Phase and temperature of the past forcing at elevation z, for a temperature offset dT
function pastPhase(hist, z, dT) {
  const n = hist.time.length, T = new Float32Array(n), f = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = hist.t[i] === null ? 0 : hist.t[i] + LAPSE * (z - hist.z0) + dT;
    T[i] = t; f[i] = clamp((1.5 - wetBulb(t, hist.rh[i] ?? 90)) / 1.5, 0, 1);
  }
  return { T, f };
}

function runPast(hist, ph, k, until, visit) {
  const st = { s: 0, h: 0 };
  if (!hist.dd) hist.dd = Float32Array.from(hist.time, ddf);
  for (let i = 0; i < hist.time.length && hist.time[i] <= until; i++) {
    const p = (hist.p[i] || 0) * k;
    step(st, p * ph.f[i], p * (1 - ph.f[i]), ph.T[i], hist.dd[i]);
    if (visit) visit(i, st);
  }
  return st;
}

// Measured snow depths → weighted observations. Weight falls with distance (12 km scale) and age (10 days);
// Le Corbier's manual reports count 1.5×; the hourly series of the last days counts ¼ per value.
export function snowObservations(daily, hourlyStJean, now) {
  const meta = Object.fromEntries(SITE.snowStations.map(s => [s.id, { ...s, wd: Math.exp(-Math.hypot((s.lat - SITE.lat) * 111.2, (s.lon - SITE.lon) * 78.5) / 12) }]));
  const mk = (id, time, hs, f) => {
    const m = meta[id]; if (!m || hs === null || hs === undefined) return null;
    return { station: id, name: m.name, time, z: m.elev, hs, wd: m.wd, w: m.wd * (m.manual ? 1.5 : 1) * f * (0.3 + Math.exp(-(now - time) / (10 * DAY))) };
  };
  const out = daily.map(o => mk(o.station, o.time, o.hs, 1));
  (hourlyStJean || []).forEach((o, i) => { if (i % 3 === 0) out.push(mk('73242003', o.time, o.hs, 0.25)); });
  return out.filter(Boolean);
}

// Fit the precipitation factor k and temperature offset dT to the measured snow depths.
// obs: [{ time, z, hs, w, wd, station }] — hourly timestamps (UTC); w = fitting weight, wd = distance weight
function fit(hist, obs, until) {
  const use = obs.filter(o => o.time >= hist.time[0] && o.time <= until);
  if (use.length < 3) return { k: 1, dT: 0, rmse: null, n: use.length };
  const groups = [...new Set(use.map(o => o.z))].map(z => {
    const m = new Map();
    use.filter(o => o.z === z).forEach(o => { const i = Math.round((o.time - hist.time[0]) / HOUR); if (!m.has(i)) m.set(i, []); m.get(i).push(o); });
    return { z, m, last: Math.max(...m.keys()) };
  });
  let best = null; const phaseCache = new Map();
  const tryOne = (k, dT) => {
    if (k < 0.6 - 1e-9 || k > 1.8 + 1e-9 || dT < -2 - 1e-9 || dT > 2 + 1e-9) return;
    const key = dT.toFixed(3);
    if (!phaseCache.has(key)) phaseCache.set(key, groups.map(g => pastPhase(hist, g.z, dT)));
    const phases = phaseCache.get(key);
    let se = 0, sw = 0;
    groups.forEach((g, j) => runPast(hist, phases[j], k, hist.time[g.last], (i, st) => {
      const a = g.m.get(i); if (a) for (const o of a) { se += o.w * (st.h - o.hs) ** 2; sw += o.w; }
    }));
    const mse = sw ? se / sw : 0;
    // weak priors: no precipitation factor, no temperature offset
    const cost = mse + 25 * ((k - 1) / 0.5) ** 2 + 25 * (dT / 1.5) ** 2;
    if (!best || cost < best.cost) best = { k: +k.toFixed(2), dT: +dT.toFixed(2), cost, rmse: Math.sqrt(mse) };
  };
  for (let dT = -2; dT <= 2.001; dT += 0.5) for (let k = 0.6; k <= 1.801; k += 0.2) tryOne(k, dT);
  const c = { ...best };
  for (let dT = c.dT - 0.5; dT <= c.dT + 0.501; dT += 0.25) for (let k = c.k - 0.2; k <= c.k + 0.201; k += 0.1) tryOne(+k.toFixed(2), +dT.toFixed(2));
  return { ...best, n: use.length };
}

// Correction factor by elevation from the latest measurement of each station: a log-ratio
// (measured / modelled) spread over ±350 m around each station and fading to 1 away from them.
function nudgeFactors(hist, obs, par, until) {
  const lastT = Math.max(...obs.map(o => o.time).filter(t => t <= until), -Infinity);
  const pts = [];
  for (const id of [...new Set(obs.map(o => o.station))]) {
    const o = obs.filter(x => x.station === id && x.time <= until && x.time >= lastT - 48 * HOUR).sort((a, b) => b.time - a.time)[0];
    if (!o) continue;
    const hm = runPast(hist, pastPhase(hist, o.z, par.dT), par.k, o.time).h;
    let rho = null;
    if (hm >= 2 && o.hs >= 2) rho = Math.log(o.hs / hm);
    else if (hm >= 3 && o.hs < 1) rho = Math.log(0.5);
    if (rho !== null) pts.push({ ...o, hm, rho: clamp(rho, Math.log(0.5), Math.log(2)) });
  }
  const factor = z => {
    let s = 0, w = 0;
    for (const p of pts) { const g = (p.wd ?? 1) * Math.exp(-(((z - p.z) / 350) ** 2)); s += g * p.rho; w += g; }
    return Math.exp(s / (w + 0.15));
  };
  return { pts, factor, at: pts.length ? Math.max(...pts.map(p => p.time)) : null };
}

// hist: { time[], t[], rh[], p[], z0 } hourly, up to now. bands: { z: consensus[] } aligned with fcTime.
// obs: measured snow depths. Returns depth (cm) per band for every forecast hour from now on.
export function runSnowpack({ hist, bands, fcTime, obs, now }) {
  const until = Math.min(now, hist.time[hist.time.length - 1]);
  const par = fit(hist, obs, until);
  const nudge = nudgeFactors(hist, obs, par, until);
  const iNow = fcTime.findIndex(t => t > until);
  const out = {}, nowDepth = {};
  for (const z of BANDS) {
    const ph = pastPhase(hist, z, par.dT);
    const r = nudge.factor(z); let nudged = nudge.at === null;
    const st = runPast(hist, ph, par.k, until, (i, s) => {
      if (!nudged && hist.time[i] >= nudge.at) { s.s *= r; s.h *= r; nudged = true; }
    });
    nowDepth[z] = st.h;
    const series = new Float32Array(fcTime.length).fill(NaN);
    const cons = bands[z] || [];
    for (let i = Math.max(0, iNow); i < fcTime.length; i++) {
      const d = cons[i];
      if (d && d.n && d.t !== undefined) step(st, d.swe || 0, d.rain || 0, d.t, ddf(fcTime[i]));
      series[i] = st.h;
    }
    out[z] = series;
  }
  return {
    fit: { ...par, stations: nudge.pts },
    now: nowDepth,
    // depth profile [[z, cm], ...] at a forecast time (or now)
    at(time) {
      if (time <= until || iNow < 0) return BANDS.map(z => [z, nowDepth[z]]);
      let i = fcTime.findIndex(t => t >= time); if (i < 0) i = fcTime.length - 1;
      return BANDS.map(z => [z, isNaN(out[z][i]) ? nowDepth[z] : out[z][i]]);
    },
  };
}
