// Data access and processing. All network calls go to free, open, CORS-enabled services.
import { SITE, MODELS, API, MF_RESOURCES, LAPSE } from './config.js';

const HOUR = 3600e3;

async function getJSON(url, { retries = 2 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url);
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.reason || ('HTTP ' + r.status));
      return j;
    } catch (e) { lastErr = e; await new Promise(res => setTimeout(res, 800 * (i + 1))); }
  }
  throw lastErr;
}

const qs = o => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

// ---------- Physics helpers ----------

// Wet-bulb temperature (°C) from T (°C) and RH (%) — Stull (2011)
export function wetBulb(T, RH) {
  if (T === null || RH === null || T === undefined || RH === undefined) return T;
  const rh = Math.max(5, Math.min(99, RH));
  return T * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) + Math.atan(T + rh) - Math.atan(rh - 1.676331)
    + 0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) - 4.686035;
}

// Fraction of precipitation falling as snow at elevation z.
// Uses the model's own snowfall height when it has one, otherwise its freezing level, otherwise wet-bulb temperature.
export function snowFraction({ z, sfh, fzl, tw }) {
  if (sfh !== null && sfh !== undefined) return clamp((z - (sfh - 150)) / 300, 0, 1);
  if (fzl !== null && fzl !== undefined) { const s = fzl - 300; return clamp((z - (s - 150)) / 300, 0, 1); }
  if (tw !== null && tw !== undefined) return clamp((1.5 - tw) / 1.5, 0, 1);
  return 0;
}

// Fresh-snow density (kg m-3) from air temperature — Hedstrom & Pomeroy (1998), capped for wet snow
export function snowDensity(T) {
  if (T === null || T === undefined) return 100;
  if (T <= 0) return 67.92 + 51.25 * Math.exp(T / 2.59);
  return Math.min(200, 119.2 + 40 * T);
}

// cm of fresh snow from mm of water equivalent at temperature T
export const sweToCm = (mm, T) => (mm / snowDensity(T)) * 100;

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Rain–snow line (m) estimate for a model/hour
export function snowLine({ sfh, fzl, t, rh, z0 }) {
  if (sfh !== null && sfh !== undefined) return sfh;
  if (fzl !== null && fzl !== undefined) return fzl - 300;
  if (t === null || t === undefined) return null;
  // height where wet-bulb crosses ~0.75 °C, moving along the standard lapse rate
  const tw = wetBulb(t, rh ?? 90);
  return z0 + (0.75 - tw) / -LAPSE;
}

// ---------- Deterministic multi-model forecast ----------

const HOURLY_VARS = ['temperature_2m', 'relative_humidity_2m', 'precipitation', 'snowfall', 'freezing_level_height', 'snowfall_height',
  'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'weather_code'];

export async function fetchModels() {
  const url = `${API.forecast}?` + qs({
    latitude: SITE.lat, longitude: SITE.lon, elevation: SITE.elev,
    hourly: HOURLY_VARS.join(','), models: MODELS.map(m => m.id).join(','),
    past_days: 2, forecast_days: 16, timeformat: 'unixtime', timezone: 'GMT',
  });
  const j = await getJSON(url);
  const time = j.hourly.time.map(s => s * 1000);
  const series = {};
  for (const m of MODELS) {
    const get = v => j.hourly[`${v}_${m.id}`] || null;
    const s = {}; let any = false;
    for (const v of HOURLY_VARS) { s[v] = get(v); if (s[v] && s[v].some(x => x !== null)) any = true; }
    if (!any) continue;
    // last valid index for this model
    const T = s.temperature_2m || []; let last = -1; T.forEach((x, i) => { if (x !== null) last = i; });
    s.lastTime = last >= 0 ? time[last] : null;
    series[m.id] = s;
  }
  return { time, series, gridElevation: j.elevation };
}

// ---------- Local calibration from data/verification.json ----------
// Each model gets a temperature correction by lead day and UTC hour, and a weight by lead day.
export function makeCalibration(verif) {
  const ids = {};
  for (const m of MODELS) ids[m.id] = m.verifyAs || [m.id];
  const pickLead = (table, L) => {
    if (!table) return null;
    if (table[L]) return table[L];
    const keys = Object.keys(table).map(Number).filter(k => k <= L);
    return keys.length ? table[Math.max(...keys)] : null;
  };
  const verifId = (modelId, L) => {
    const list = ids[modelId] || [modelId];
    if (list.length === 1) return list[0];
    // ICON-CH seamless: CH1 for the first ~33 h, CH2 afterwards
    return L === 0 ? list[0] : list[1];
  };
  return {
    available: !!(verif && verif.bias),
    tBias(modelId, L, utcHour) {
      if (!verif || !verif.bias) return 0;
      const b = pickLead(verif.bias[verifId(modelId, L)], clamp(L, 0, 7));
      return b ? b[utcHour] : 0;
    },
    weight(modelId, L, kind) {
      if (!verif || !verif.weights) return 1;
      const w = verif.weights[String(clamp(L, 0, 7))];
      if (!w || !w[kind]) return 1;
      const v = w[kind][verifId(modelId, L)];
      if (v !== undefined) return v;
      const vals = Object.values(w[kind]);
      return vals.length ? Math.min(...vals) : 1; // unverified at this lead: smallest weight
    },
  };
}

// Adds a de-biased temperature series to every model (s.tCorr)
export function applyCalibration(fc, calib, now = Date.now()) {
  for (const id in fc.series) {
    const s = fc.series[id]; const T = s.temperature_2m || [];
    s.tCorr = T.map((v, i) => {
      if (v === null || v === undefined) return null;
      const lead = Math.max(0, Math.floor((fc.time[i] - now) / (24 * HOUR)));
      return v - calib.tBias(id, lead, new Date(fc.time[i]).getUTCHours());
    });
  }
  fc.calibrated = calib.available;
  return fc;
}

// Derived per-model hourly quantities at an elevation z
export function derivedAt(s, i, z) {
  const t0 = s.tCorr ? s.tCorr[i] : (s.temperature_2m ? s.temperature_2m[i] : null);
  if (t0 === null || t0 === undefined) return null;
  const t = t0 + LAPSE * (z - SITE.elev);
  const rh = s.relative_humidity_2m ? s.relative_humidity_2m[i] : null;
  const p = s.precipitation ? s.precipitation[i] : null;
  const sfh = s.snowfall_height ? s.snowfall_height[i] : null;
  const fzl = s.freezing_level_height ? s.freezing_level_height[i] : null;
  const tw = wetBulb(t, rh ?? 90);
  const f = snowFraction({ z, sfh, fzl, tw });
  const swe = p === null || p === undefined ? null : p * f;
  return { t, p, f, swe, cm: swe === null ? null : sweToCm(swe, t), line: snowLine({ sfh, fzl, t: t0, rh, z0: SITE.elev }) };
}

// Hourly consensus + spread at elevation z. weighter(modelId, leadDay, 't'|'p') -> weight
export function consensus(fc, z, weighter, now = Date.now(), { hiResOnly = false } = {}) {
  const out = [];
  const ids = Object.keys(fc.series).filter(id => !hiResOnly || (MODELS.find(m => m.id === id) || {}).hiRes);
  for (let i = 0; i < fc.time.length; i++) {
    const lead = Math.floor((fc.time[i] - now) / (24 * HOUR));
    let wt = 0, wp = 0, sT = 0, sP = 0, sF = 0, sL = 0, wl = 0, sWS = 0, sWG = 0, ww = 0;
    const vals = { t: [], p: [], cm: [], line: [] };
    let cl = 0, cm = 0, ch = 0, cn = 0, wdx = 0, wdy = 0;
    for (const id of ids) {
      const s = fc.series[id]; const d = derivedAt(s, i, z); if (!d) continue;
      const a = weighter(id, Math.max(0, lead), 't'); const b = weighter(id, Math.max(0, lead), 'p');
      sT += a * d.t; wt += a; vals.t.push(d.t);
      if (d.p !== null && d.p !== undefined) { sP += b * d.p; sF += b * d.p * d.f; wp += b; vals.p.push(d.p); vals.cm.push(d.cm); }
      if (d.line !== null && d.line !== undefined) { sL += a * d.line; wl += a; vals.line.push(d.line); }
      const ws = s.wind_speed_10m && s.wind_speed_10m[i]; const wg = s.wind_gusts_10m && s.wind_gusts_10m[i]; const wd = s.wind_direction_10m && s.wind_direction_10m[i];
      if (ws !== null && ws !== undefined) { sWS += ws; sWG += (wg ?? ws); ww++; if (wd !== null && wd !== undefined) { wdx += ws * Math.sin(wd * Math.PI / 180); wdy += ws * Math.cos(wd * Math.PI / 180); } }
      const l = s.cloud_cover_low && s.cloud_cover_low[i];
      if (l !== null && l !== undefined) { cl += l; cm += s.cloud_cover_mid[i] ?? 0; ch += s.cloud_cover_high[i] ?? 0; cn++; }
    }
    if (!wt) { out.push({ time: fc.time[i], n: 0 }); continue; }
    const T = sT / wt; const P = wp ? sP / wp : null; const F = wp && sP > 0 ? sF / sP : (T < 0 ? 1 : 0);
    const swe = P === null ? null : P * F;
    out.push({
      time: fc.time[i], n: vals.t.length, lead,
      t: T, tMin: Math.min(...vals.t), tMax: Math.max(...vals.t),
      p: P, pMin: vals.p.length ? Math.min(...vals.p) : null, pMax: vals.p.length ? Math.max(...vals.p) : null,
      snowFrac: F, swe, cm: swe === null ? null : sweToCm(swe, T), rain: P === null ? null : P - swe,
      line: wl ? sL / wl : null, lineMin: vals.line.length ? Math.min(...vals.line) : null, lineMax: vals.line.length ? Math.max(...vals.line) : null,
      wind: ww ? sWS / ww : null, gust: ww ? sWG / ww : null, dir: ww ? (Math.atan2(wdx, wdy) * 180 / Math.PI + 360) % 360 : null,
      cloudLow: cn ? cl / cn : null, cloudMid: cn ? cm / cn : null, cloudHigh: cn ? ch / cn : null,
    });
  }
  return out;
}

// Fresh snow (cm) per model between t0 and t1 at elevation z
export function snowTotals(fc, z, t0, t1) {
  const res = {};
  for (const id in fc.series) {
    const s = fc.series[id]; let cm = 0, n = 0; let covered = true;
    for (let i = 0; i < fc.time.length; i++) {
      const tt = fc.time[i]; if (tt <= t0 || tt > t1) continue;
      const d = derivedAt(s, i, z);
      if (!d || d.cm === null) { covered = false; continue; }
      cm += d.cm; n++;
    }
    if (n) res[id] = { cm, complete: covered && s.lastTime >= t1 };
  }
  return res;
}

// ---------- Ensembles ----------

export async function fetchEnsemble(model = 'ecmwf_ifs025_ensemble', days = 15) {
  const vars = ['temperature_2m', 'relative_humidity_2m', 'precipitation', 'freezing_level_height'];
  const url = `${API.ensemble}?` + qs({
    latitude: SITE.lat, longitude: SITE.lon, elevation: SITE.elev, hourly: vars.join(','), models: model,
    forecast_days: days, timeformat: 'unixtime', timezone: 'GMT',
  });
  const j = await getJSON(url);
  const time = j.hourly.time.map(s => s * 1000);
  const members = [];
  const keys = Object.keys(j.hourly).filter(k => k.startsWith('temperature_2m'));
  for (const k of keys) {
    const sfx = k.slice('temperature_2m'.length); // '' (control) or '_member01'
    const m = {};
    for (const v of vars) m[v] = j.hourly[v + sfx] || null;
    if (m.temperature_2m && m.temperature_2m.some(x => x !== null)) members.push(m);
  }
  return { model, time, members };
}

export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q; const lo = Math.floor(pos); const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// Per-member snow at elevation z, daily totals (local days), cumulative, and hourly temperature quantiles
export function ensembleStats(ens, z = SITE.elev, bias = () => 0) {
  const { time, members } = ens;
  const corr = time.map(tt => bias(tt));
  const tz = 'Europe/Paris';
  const dayKey = ms => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  const days = []; const dayIndex = {};
  time.forEach((tt, i) => { const k = dayKey(tt - HOUR); if (!(k in dayIndex)) { dayIndex[k] = days.length; days.push(k); } });
  const memberDaily = members.map(m => {
    const d = new Array(days.length).fill(0); const valid = new Array(days.length).fill(0);
    for (let i = 0; i < time.length; i++) {
      const T0 = m.temperature_2m[i]; const P = m.precipitation[i]; if (T0 === null || P === null || T0 === undefined || P === undefined) continue;
      const T = T0 - corr[i] + LAPSE * (z - SITE.elev);
      const tw = wetBulb(T, m.relative_humidity_2m ? m.relative_humidity_2m[i] : 90);
      const fzl = m.freezing_level_height ? m.freezing_level_height[i] : null;
      const f = snowFraction({ z, sfh: null, fzl, tw });
      const di = dayIndex[dayKey(time[i] - HOUR)];
      d[di] += sweToCm(P * f, T); valid[di]++;
    }
    return d.map((v, i) => (valid[i] ? v : null));
  });
  const tq = time.map((_, i) => {
    const v = members.map(m => m.temperature_2m[i]).filter(x => x !== null && x !== undefined).map(x => x - corr[i] + LAPSE * (z - SITE.elev)).sort((a, b) => a - b);
    return v.length ? { p10: quantile(v, 0.1), p25: quantile(v, 0.25), p50: quantile(v, 0.5), p75: quantile(v, 0.75), p90: quantile(v, 0.9) } : null;
  });
  const dq = days.map((_, di) => {
    const v = memberDaily.map(d => d[di]).filter(x => x !== null).sort((a, b) => a - b);
    return v.length ? { p10: quantile(v, 0.1), p25: quantile(v, 0.25), p50: quantile(v, 0.5), p75: quantile(v, 0.75), p90: quantile(v, 0.9), pAny: v.filter(x => x >= 1).length / v.length, n: v.length } : null;
  });
  const cum = memberDaily.map(d => { let s = 0; return d.map(v => (v === null ? null : (s += v))); });
  const cq = days.map((_, di) => {
    const v = cum.map(c => c[di]).filter(x => x !== null).sort((a, b) => a - b);
    return v.length ? { p10: quantile(v, 0.1), p25: quantile(v, 0.25), p50: quantile(v, 0.5), p75: quantile(v, 0.75), p90: quantile(v, 0.9) } : null;
  });
  const prob = (nDays, thr) => {
    const v = cum.map(c => c[Math.min(nDays, c.length) - 1]).filter(x => x !== null);
    return v.length ? v.filter(x => x >= thr).length / v.length : null;
  };
  return { days, memberDaily, tq, dq, cum, cq, prob, corr };
}

// ---------- Sub-seasonal and seasonal ----------

export async function fetchSubseasonal() {
  const url = `${API.seasonal}?` + qs({
    latitude: SITE.lat, longitude: SITE.lon,
    weekly: 'temperature_2m_anomaly,precipitation_anomaly,snowfall_anomaly',
    models: 'ecmwf_ec46_ensemble_mean', timeformat: 'unixtime', timezone: 'GMT',
  });
  return getJSON(url);
}

export async function fetchSeasonal() {
  const url = `${API.seasonal}?` + qs({
    latitude: SITE.lat, longitude: SITE.lon,
    monthly: 'temperature_2m_anomaly,precipitation_anomaly,snowfall_anomaly,snow_depth_anomaly',
    models: 'ecmwf_seas5_ensemble_mean', timeformat: 'unixtime', timezone: 'GMT',
  });
  return getJSON(url);
}

// ---------- Observations (Météo-France, via data.gouv.fr tabular API) ----------

export async function fetchObs(stationId, hours = 96) {
  const u = new URL(`${API.tabular}/${MF_RESOURCES.latest}/data/`);
  u.searchParams.set('NUM_POSTE__exact', stationId);
  u.searchParams.set('AAAAMMJJHH__sort', 'desc');
  u.searchParams.set('page_size', String(Math.min(200, hours)));
  const j = await getJSON(u.toString());
  return (j.data || []).map(r => ({ ...r, k: String(r.AAAAMMJJHH) })).map(r => ({
    time: Date.UTC(+r.k.slice(0, 4), +r.k.slice(4, 6) - 1, +r.k.slice(6, 8), +r.k.slice(8, 10)),
    t: r.T, rr: r.RR1, hs: r.NEIGETOT, hn: r.HNEIGEF, ff: r.FF !== null && r.FF !== undefined ? r.FF * 3.6 : null, fxi: r.FXI !== null && r.FXI !== undefined ? r.FXI * 3.6 : null, dd: r.DD,
  })).reverse();
}

// Snow depth measured every morning (06 UTC) at the stations around Le Corbier since `start`:
// daily for the last two weeks, every other day before (at most 95 days back)
export async function fetchSnowObs(start, now = Date.now()) {
  const days = [];
  for (let t = Math.max(start, now - 95 * 24 * HOUR); t <= now; t += 24 * HOUR) {
    const age = Math.round((now - t) / (24 * HOUR));
    if (age <= 14 || age % 2 === 0) days.push(new Date(t).toISOString().slice(0, 10).replace(/-/g, '') + '06');
  }
  const page = n => {
    const u = new URL(`${API.tabular}/${MF_RESOURCES.latest}/data/`);
    u.searchParams.set('NUM_POSTE__in', SITE.snowStations.map(s => s.id).join(','));
    u.searchParams.set('AAAAMMJJHH__in', days.join(','));
    u.searchParams.set('page_size', '200'); u.searchParams.set('page', String(n));
    return getJSON(u.toString());
  };
  const first = await page(1);
  const pages = Math.min(5, Math.ceil(((first.meta && first.meta.total) || 0) / 200));
  const rest = await Promise.all([...Array(Math.max(0, pages - 1))].map((_, i) => page(i + 2).catch(() => ({ data: [] }))));
  return [first, ...rest].flatMap(j => j.data || []).filter(r => r.NEIGETOT !== null && r.NEIGETOT !== undefined).map(r => {
    const k = String(r.AAAAMMJJHH);
    return { station: String(r.NUM_POSTE), time: Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8), +k.slice(8, 10)), hs: r.NEIGETOT };
  });
}

// The models' own analyses since `start` (first hours of successive runs), averaged: drives the snowpack model
const HIST_MODELS = ['icon_seamless', 'meteofrance_seamless', 'ecmwf_ifs025'];
export async function fetchHistory(start, now = Date.now()) {
  const url = `${API.historical}?` + qs({
    latitude: SITE.lat, longitude: SITE.lon, elevation: SITE.elev,
    start_date: new Date(start).toISOString().slice(0, 10), end_date: new Date(now).toISOString().slice(0, 10),
    hourly: 'temperature_2m,relative_humidity_2m,precipitation', models: HIST_MODELS.join(','), timeformat: 'unixtime', timezone: 'GMT',
  });
  const j = await getJSON(url);
  const time = j.hourly.time.map(s => s * 1000);
  const mean = v => time.map((_, i) => {
    let s = 0, n = 0; for (const m of HIST_MODELS) { const x = (j.hourly[`${v}_${m}`] || [])[i]; if (x !== null && x !== undefined) { s += x; n++; } }
    return n ? s / n : null;
  });
  const keep = time.findIndex(t => t > now); const end = keep < 0 ? time.length : keep;
  return { time: time.slice(0, end), t: mean('temperature_2m').slice(0, end), rh: mean('relative_humidity_2m').slice(0, end), p: mean('precipitation').slice(0, end), z0: SITE.elev };
}

// ---------- Baked files (written by the GitHub Action) ----------

export async function fetchBaked(name) {
  try { const r = await fetch(`data/${name}`, { cache: 'no-cache' }); if (!r.ok) return null; return await r.json(); } catch (e) { return null; }
}
