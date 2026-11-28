// Orchestration: fetch everything, compute, and render.
import { SITE, MODELS, COLORS, CAMS, SKAPING_S3 } from './config.js';
import { t, fmt, zm, getLang, setLang, applyStatic } from './i18n.js';
import * as D from './data.js';
import * as C from './charts.js';
import { createMap, SNOW_RAMP, SNOW_CLASSES, DEPTH_RAMP, BARE_COLOR } from './map.js';
import * as SP from './snowpack.js';
import * as B from './bulletin.js';

const HOUR = 3600e3;
const $ = id => document.getElementById(id);
const S = { now: Date.now(), verif: null, climate: null, fc: null, calib: null, cons: {}, ens: null, ensStats: null, sub: null, seas: null, c3s: null, obs: null, map: null, horizon: 48, lineHour: 0, snowMode: 'fresh', day: 0, cumul: false, pack: null };
const DAYS = 15, TREND_FROM = 7; // today + 14 days; beyond D+6 the strip shows a trend
const fr = () => getLang() === 'fr';
// Reference elevations of the selected resort: base (village), top (highest named point), low (lower hamlet)
const BZ = SITE.base.z, TZ = SITE.top.z, LZ = SITE.low.z;
const AT = () => SITE.at[getLang()];

// ---------- language ----------
function initLang() {
  document.querySelectorAll('.lang button').forEach(b => b.addEventListener('click', () => {
    setLang(b.dataset.lang);
    document.querySelectorAll('.lang button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.lang === b.dataset.lang)));
  }));
  document.documentElement.lang = getLang();
  document.querySelectorAll('.lang button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.lang === getLang())));
  applyStatic();
  window.addEventListener('langchange', () => renderAll());
}

// ---------- weather code text ----------
const WMO = {
  fr: { 0: 'Ciel clair', 1: 'Plutôt dégagé', 2: 'Partiellement nuageux', 3: 'Couvert', 45: 'Brouillard', 48: 'Brouillard givrant', 51: 'Bruine faible', 53: 'Bruine', 55: 'Bruine forte', 56: 'Bruine verglaçante', 57: 'Bruine verglaçante', 61: 'Pluie faible', 63: 'Pluie', 65: 'Forte pluie', 66: 'Pluie verglaçante', 67: 'Pluie verglaçante', 71: 'Neige faible', 73: 'Neige', 75: 'Forte neige', 77: 'Grains de neige', 80: 'Averses', 81: 'Averses', 82: 'Fortes averses', 85: 'Averses de neige', 86: 'Fortes averses de neige', 95: 'Orage', 96: 'Orage et grêle', 99: 'Orage et grêle' },
  en: { 0: 'Clear sky', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail' },
};
const dirName = d => { const fr8 = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'], en8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']; const i = Math.round(((d % 360) + 360) % 360 / 45) % 8; return (fr() ? fr8 : en8)[i]; };
const ago = ms => { const h = Math.round((Date.now() - ms) / HOUR); return fr() ? `il y a ${h} h` : `${h} h ago`; };
const dayTime = ms => new Intl.DateTimeFormat(fr() ? 'fr-FR' : 'en-GB', { weekday: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(ms));

// ---------- computations ----------
function computeConsensus() {
  const w = (id, L, k) => S.calib.weight(id, L, k);
  for (const z of new Set([LZ, BZ, TZ, ...SITE.levels.map(L => L.z)])) S.cons[z] = D.consensus(S.fc, z, w, S.now);
}
// Consensus for every elevation band of the map and the snowpack model
function computeBands() {
  const w = (id, L, k) => S.calib.weight(id, L, k);
  S.bands = {}; for (const z of SP.BANDS) S.bands[z] = D.consensus(S.fc, z, w, S.now);
  S.days = B.dayWindows(S.now, DAYS); // Paris calendar days: today (from now) + 14
  S.fresh = {}; S.freshCum = {};
  for (const z of SP.BANDS) {
    const per = S.days.map(w => S.bands[z].reduce((a, x) => a + (x.n && x.time > w.from && x.time <= w.end ? (x.cm || 0) : 0), 0));
    let acc = 0; S.fresh[z] = per; S.freshCum[z] = per.map(v => (acc += v));
  }
}
const atZ = (pairs, z) => { for (let i = 1; i < pairs.length; i++) if (z <= pairs[i][0]) { const [z0, v0] = pairs[i - 1], [z1, v1] = pairs[i]; return v0 + (v1 - v0) * (z - z0) / (z1 - z0); } return pairs[pairs.length - 1][1]; };
const freshProfile = (d, cumul) => SP.BANDS.map(z => [z, (cumul ? S.freshCum : S.fresh)[z][d]]);
const depthProfile = d => S.pack.at(S.days[d].morning);
// Snow on the ground: the model calibrated on the stations
function runPack(hist, rows) {
  try {
    const obs = SP.snowObservations(rows || [], S.obs, S.now);
    S.pack = SP.runSnowpack({ hist, bands: S.bands, fcTime: S.fc.time, obs, now: S.now, times: S.days.map(w => w.morning) });
  } catch (e) { console.error('snowpack', e); S.pack = null; }
}

function totalsBetween(z, t0, t1) {
  const cons = S.cons[z] || D.consensus(S.fc, z, (id, L, k) => S.calib.weight(id, L, k), S.now);
  let cm = 0, mm = 0, swe = 0; cons.forEach(d => { if (d.time > t0 && d.time <= t1 && d.n) { cm += d.cm || 0; mm += d.rain || 0; swe += d.swe || 0; } });
  return { cm, mm, swe };
}
function snowProfile(hours) {
  const t1 = S.now + hours * HOUR; const out = [];
  for (let z = 600; z <= 3400; z += 100) {
    const cons = D.consensus(S.fc, z, (id, L, k) => S.calib.weight(id, L, k), S.now);
    let cm = 0; cons.forEach(d => { if (d.time > S.now && d.time <= t1 && d.n) cm += d.cm || 0; });
    out.push([z, cm]);
  }
  return out;
}
function nextSnowEvent() {
  const c = S.cons[BZ]; const fut = c.filter(d => d.time > S.now && d.time < S.now + 7 * 24 * HOUR && d.n);
  let start = -1; for (let i = 0; i < fut.length; i++) { const w = fut.slice(i, i + 6).reduce((a, d) => a + (d.cm || 0), 0); if (w >= 2) { start = i; break; } }
  if (start < 0) return null;
  let end = start, dry = 0; for (let i = start; i < fut.length; i++) { if ((fut[i].cm || 0) > 0.2) { end = i; dry = 0; } else if (++dry > 12) break; }
  const ev = fut.slice(start, end + 1);
  const atTop = S.cons[TZ].filter(d => d.time >= ev[0].time && d.time <= ev[ev.length - 1].time).reduce((a, d) => a + (d.cm || 0), 0);
  return { t0: ev[0].time, t1: ev[ev.length - 1].time, cm: ev.reduce((a, d) => a + (d.cm || 0), 0), cmHigh: atTop };
}

// Fresh snow measured on each of the last days (Paris calendar days): Le Corbier's manual report when there is one,
// otherwise the rises of the hourly snow depth at Saint-Jean-d'Arves (lightly smoothed; settling makes it a lower bound)
const parisDay = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
function observedDaily(nDays = 7) {
  const today = parisDay(S.now); const out = new Map();
  const rows = (S.obs || []).filter(o => o.hs !== null && o.hs !== undefined).sort((a, b) => a.time - b.time);
  const sm = rows.map((o, i) => ({ ...o, h: [rows[i - 1], o, rows[i + 1]].filter(Boolean).map(r => r.hs).sort((a, b) => a - b)[1] ?? o.hs }));
  const groups = new Map(); sm.forEach(o => { const k = parisDay(o.time - HOUR); if (k >= today) return; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); });
  for (const [k, g] of groups) {
    if (g.length < 18) continue; // incomplete day
    let lo = g[0].h, rise = 0; for (const r of g) { lo = Math.min(lo, r.h); rise = Math.max(rise, r.h - lo); }
    out.set(k, { d: k, cm: rise >= 2 ? rise : 0, mm: g.reduce((a, r) => a + (r.rr || 0), 0), src: 'stjean' });
  }
  for (const o of S.obsC || []) {
    if (o.hn === null || o.hn === undefined) continue;
    const k = parisDay(o.time - 12 * HOUR); if (k >= today) continue;
    out.set(k, { ...(out.get(k) || { d: k, mm: null }), cm: o.hn, src: 'corbier' });
  }
  return [...out.values()].sort((a, b) => (a.d < b.d ? -1 : 1)).slice(-nDays);
}

// Latest measured snow depth: Le Corbier's report when recent (ski season), otherwise Saint-Jean-d'Arves
function latestDepth() {
  const recent = o => o && Date.now() - o.time < 4 * 24 * HOUR;
  const lastC = S.obsC ? [...S.obsC].reverse().find(o => o.hs !== null && o.hs !== undefined) : null;
  const lastJ = S.obs ? [...S.obs].reverse().find(o => o.hs !== null && o.hs !== undefined) : null;
  if (recent(lastC)) return { cm: lastC.hs, where: 'Le Corbier', time: lastC.time, hn: lastC.hn, corbier: true };
  return lastJ ? { cm: lastJ.hs, where: "Saint-Jean-d'Arves", time: lastJ.time } : null;
}

// Bulletin at the top of the page: the AI-written text baked by the GitHub Action when it is recent,
// otherwise the same digest phrased in the browser
function renderBulletin() {
  if (!S.fc || !S.days) return;
  try {
    S.digest = B.buildDigest({ now: S.now, cons: S.cons, days: S.days, freshAt: (z, d) => atZ(freshProfile(d, false), z), interp: atZ, ens: S.ensStats, pack: S.pack, obsHs: latestDepth() });
  } catch (e) { console.error('bulletin', e); return; }
  const ai = S.ai && S.ai[getLang()] && Date.now() - Date.parse(S.ai.generated) < 3 * HOUR ? S.ai : null;
  const text = ai ? ai[getLang()] : B.writeBulletin(S.digest, getLang());
  if (!text) return;
  $('bulletin').hidden = false;
  $('b-text').textContent = text; fitHero();
  const at = new Intl.DateTimeFormat(fr() ? 'fr-FR' : 'en-GB', { weekday: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(ai ? Date.parse(ai.generated) : S.now));
  $('b-label').textContent = fr() ? 'Bulletin' : 'Bulletin';
  $('b-meta').innerHTML = ai
    ? (fr() ? `Rédigé par IA (${ai.model}, via ${ai.provider || 'GitHub Models'}) à partir des données de cette page · ${at}` : `Written by AI (${ai.model}, via ${ai.provider || 'GitHub Models'}) from this page's data · ${at}`)
    : (fr() ? `Rédigé automatiquement à partir des prévisions ci-dessous · ${at}` : `Written automatically from the forecasts below · ${at}`);
}

// ---------- renderers ----------
function renderNow() {
  const c = S.cons[BZ]; if (!c) return;
  const i = c.findIndex(d => d.time >= S.now - HOUR / 2); const d = c[Math.max(0, i)];
  const sum = S.cons[TZ][Math.max(0, i)];
  // condition from the best km-scale model available now
  const pick = ['meteofrance_arome_france_hd', 'meteoswiss_icon_seamless', 'icon_d2'].map(id => S.fc.series[id]).find(s => s && s.weather_code && s.weather_code[i] !== null);
  const code = pick ? pick.weather_code[i] : null;
  $('now-temp').innerHTML = `${fmt(d.t, 0)}<sup>°C</sup>`;
  $('now-cond').textContent = code !== null ? (WMO[getLang()][code] || '') : '';
  $('now-where').textContent = `${SITE.base.name}, ${zm(BZ)} · ${fr() ? 'prévision corrigée' : 'bias-corrected forecast'}`;
  $('now-summit-label').textContent = `${SITE.top.name} ${zm(TZ)}`;
  // Snow on the ground: Le Corbier's own observation when there is a recent one (ski season),
  // otherwise the automatic station at Saint-Jean-d'Arves (4 km, same elevation)
  const recent = o => o && Date.now() - o.time < 4 * 24 * HOUR;
  const lastObs = latestDepth();
  $('now-hs').innerHTML = lastObs ? `${fmt(lastObs.cm, 0)}<small>cm</small>` : '–';
  $('now-hs-hint').textContent = !lastObs ? '' : lastObs.corbier
    ? `Le Corbier · ${ago(lastObs.time)}${lastObs.hn ? (fr() ? ` · +${fmt(lastObs.hn, 0)} cm en 24 h` : ` · +${fmt(lastObs.hn, 0)} cm in 24 h`) : ''}`
    : (fr() ? `St-Jean-d'Arves · ${ago(lastObs.time)} (Le Corbier : relevés en saison)` : `St-Jean-d'Arves · ${ago(lastObs.time)} (Le Corbier: in season only)`);
  $('now-line').innerHTML = d.line !== null ? `${fmt(Math.round(d.line / 50) * 50)}<small>m</small>` : '–';
  $('now-line-hint').textContent = d.lineMin !== null ? `${fmt(Math.round(d.lineMin / 50) * 50)} – ${fmt(Math.round(d.lineMax / 50) * 50)} m` : '';
  $('now-wind').innerHTML = d.wind !== null ? `${fmt(d.wind, 0)}<small>km/h</small>` : '–';
  $('now-wind-hint').textContent = d.dir !== null ? `${dirName(d.dir)} · ${fr() ? 'rafales' : 'gusts'} ${fmt(d.gust, 0)} km/h` : '';
  $('now-summit').innerHTML = sum ? `${fmt(sum.t, 0)}<small>°C</small>` : '–';
  const f48 = fmt(totalsBetween(TZ, S.now, S.now + 48 * HOUR).cm, 0);
  $('now-summit-hint').textContent = !sum ? '' : S.pack
    ? (fr() ? `≈ ${fmt(atZ(S.pack.at(S.now), TZ), 0)} cm au sol · +${f48} cm en 48 h` : `≈ ${fmt(atZ(S.pack.at(S.now), TZ), 0)} cm on the ground · +${f48} cm in 48 h`)
    : `${fr() ? 'neige' : 'snow'} 48 h : ${f48} cm`;
  const lastTC = S.obsC ? [...S.obsC].reverse().find(o => o.t !== null && o.t !== undefined) : null;
  const lastTJ = S.obs ? [...S.obs].reverse().find(o => o.t !== null && o.t !== undefined) : null;
  const lastT = recent(lastTC) && (!lastTJ || lastTC.time >= lastTJ.time - 6 * HOUR) ? { ...lastTC, where: fr() ? 'au Corbier' : 'at Le Corbier' } : (lastTJ ? { ...lastTJ, where: fr() ? "à St-Jean-d'Arves" : "at St-Jean-d'Arves" } : null);
  $('now-foot').textContent = lastT ? `${t('now.observed')} : ${fmt(lastT.t, 1)} °C ${lastT.where} (${ago(lastT.time)}). ${fr() ? 'Modèles : ' : 'Models: '}${Object.keys(S.fc.series).length}.` : '';
  const ev = nextSnowEvent(); const box = $('next-snow');
  box.hidden = false;
  if (ev) {
    $('next-snow-t1').textContent = `${t('now.next')} : ${dayTime(ev.t0)}`;
    $('next-snow-t2').textContent = fr() ? `≈ ${fmt(ev.cm, 0)} cm à ${zm(BZ)} · ${fmt(ev.cmHigh, 0)} cm à ${zm(TZ)}` : `≈ ${fmt(ev.cm, 0)} cm at ${zm(BZ)} · ${fmt(ev.cmHigh, 0)} cm at ${zm(TZ)}`;
  } else { $('next-snow-t1').textContent = t('now.next'); $('next-snow-t2').textContent = t('now.none7d'); }
}

// Resort report (baked hourly from le-corbier.com): avalanche danger and the resort's own snow depths
const RISK_NAME = { fr: ['', 'faible', 'limité', 'marqué', 'fort', 'très fort'], en: ['', 'low', 'moderate', 'considerable', 'high', 'very high'] };
function renderResort() {
  const R = S.resort, box = $('resort'); if (!box) return;
  if (!SITE.avaMassif || !R || !R.stations || !R.stations.length || Date.now() - Date.parse(R.fetched) > 2 * 24 * HOUR) { box.hidden = true; return; }
  const st = R.stations; const lvl = st.map(s => s.avalancheLevel).find(v => v);
  $('ava').className = 'ava' + (lvl ? ` l${lvl}` : ''); $('ava-n').textContent = lvl || '–';
  $('resort-t1').textContent = lvl
    ? (fr() ? `Risque d’avalanche ${lvl}/5 · ${RISK_NAME.fr[lvl]}` : `Avalanche danger ${lvl}/5 · ${RISK_NAME.en[lvl]}`)
    : (fr() ? 'Bulletin de la station' : 'Resort report');
  // The resort's snow depths are not shown: they carry no measurement date and no documented site (Lumiplan feed),
  // so they would contradict the dated Météo-France measurement above. Only the danger level and open runs are kept.
  // the run count of the le-corbier.com feed is Le Corbier's own: shown on Le Corbier's page only
  const P = SITE.id === 'corbier' ? Object.values(R.pistes || {}) : []; const open = P.reduce((a, p) => a + p.open, 0), tot = P.reduce((a, p) => a + p.total, 0);
  $('resort-t2').textContent = [SITE.id === 'corbier' ? (fr() ? 'Bulletin Météo-France (Maurienne), relayé par la station' : 'Météo-France bulletin (Maurienne), via the resort') : (fr() ? 'Bulletin avalanche Météo-France, massif de la Maurienne' : 'Météo-France avalanche bulletin, Maurienne massif'), tot ? (fr() ? `${open}/${tot} pistes ouvertes` : `${open}/${tot} runs open`) : ''].filter(Boolean).join(' · ');
  box.href = SITE.resortPage[getLang()];
  box.title = fr() ? 'Relevé déclaré par la station (le-corbier.com) ; risque issu du bulletin avalanche Météo-France (BERA)' : 'Report declared by the resort (le-corbier.com); danger from the Météo-France avalanche bulletin (BERA)';
  box.hidden = false; fitHero();
}

function renderKpis48() {
  const a = totalsBetween(BZ, S.now, S.now + 24 * HOUR), b = totalsBetween(BZ, S.now, S.now + 48 * HOUR), c = totalsBetween(TZ, S.now, S.now + 48 * HOUR);
  const fut = S.cons[BZ].filter(d => d.time > S.now && d.time <= S.now + 48 * HOUR && d.n);
  const lines = fut.map(d => d.line).filter(v => v !== null);
  const gust = Math.max(...fut.map(d => d.gust || 0));
  const k = (label, value, unit, hint) => `<div class="kpi"><div class="label">${label}</div><div class="value num">${value}<small>${unit}</small></div><div class="hint">${hint}</div></div>`;
  // precipitation split by phase, in mm of water: what falls as snow and what falls as rain
  const split = v => `<span class="ph"><i style="background:${COLORS.snow}"></i>${fr() ? 'neige' : 'snow'} ${fmt(v.swe, 0)} mm</span><span class="ph"><i style="background:${COLORS.rain}"></i>${fr() ? 'pluie' : 'rain'} ${fmt(v.mm, 0)} mm</span>`;
  const fs = (h, z) => `${fr() ? 'Neige fraîche' : 'Fresh snow'} ${h} h · ${zm(z)}`;
  $('kpis-48').innerHTML =
    k(fs(24, BZ), fmt(a.cm, 0), 'cm', split(a)) +
    k(fs(48, BZ), fmt(b.cm, 0), 'cm', split(b)) +
    k(fs(48, TZ), fmt(c.cm, 0), 'cm', split(c)) +
    k(fr() ? 'Limite pluie-neige 48 h' : 'Rain–snow line 48 h', lines.length ? `${fmt(Math.round(Math.min(...lines) / 50) * 50)}–${fmt(Math.round(Math.max(...lines) / 50) * 50)}` : '–', 'm', `${fr() ? 'Rafales max' : 'Max gusts'} ${fmt(gust, 0)} km/h`);
}

function render48() {
  $('h48-sub').textContent = fr() ? `Consensus pondéré et corrigé, ${Object.keys(S.fc.series).length} modèles. Zone grisée : écart entre modèles. Bandes sombres : nuit.` : `Weighted, bias-corrected consensus of ${Object.keys(S.fc.series).length} models. Shaded: model spread. Dark bands: night.`;
  C.legend('leg-48', [{ color: COLORS.consensus, label: zm(BZ) }, { color: '#9dc8f7', label: zm(TZ) }, { color: '#2370cd', label: zm(LZ) }, { color: COLORS.snow, label: t('leg.snow'), shape: 'sq' }, { color: COLORS.rain, label: t('leg.rain'), shape: 'sq' }, { color: COLORS.obs, label: fr() ? 'Mesuré (St-Jean-d’Arves, 1 573 m)' : 'Measured (St-Jean-d’Arves, 1,573 m)', shape: 'dot' }]);
  C.meteogram('chart-48', { base: S.cons[BZ], top: S.cons[TZ], low: S.cons[LZ], z: { base: BZ, top: TZ, low: LZ }, names: { base: SITE.base.name, top: SITE.top.short }, now: S.now, obs: S.obs });
  renderAltitude();
}

function renderAltitude() {
  const seg = $('alt-horizon');
  const hs = [24, 48, 72, 168];
  seg.innerHTML = hs.map(h => `<button type="button" data-h="${h}" aria-pressed="${h === S.horizon}">${h === 168 ? (fr() ? '7 j' : '7 d') : h + ' h'}</button>`).join('');
  seg.querySelectorAll('button').forEach(b => b.onclick = () => { S.horizon = +b.dataset.h; renderAltitude(); });
  const t1 = S.now + S.horizon * HOUR;
  const rows = SITE.levels.map(L => {
    const z = L.z; const per = D.snowTotals(S.fc, z, S.now, t1);
    const complete = Object.entries(per).filter(([, v]) => v.complete);
    const vals = complete.map(([, v]) => v.cm);
    return { z, short: L[getLang()], cons: totalsBetween(z, S.now, t1).cm, min: vals.length ? Math.min(...vals) : null, max: vals.length ? Math.max(...vals) : null, models: Object.fromEntries(complete.map(([id, v]) => [id, v.cm])) };
  });
  C.altitudeChart('chart-alt', rows);
}

async function render15() {
  try {
    if (!S.ens) {
      S.ens = await D.fetchEnsemble('ecmwf_ifs025_ensemble', 15);
    }
    const bias = ms => { const L = Math.max(0, Math.floor((ms - S.now) / (24 * HOUR))); return S.calib.tBias('ecmwf_ifs', L, new Date(ms).getUTCHours()); };
    S.ensStats = D.ensembleStats(S.ens, BZ, bias);
    const st = S.ensStats;
    const k = (label, value, unit, hint) => `<div class="kpi"><div class="label">${label}</div><div class="value num">${value}<small>${unit}</small></div><div class="hint">${hint}</div></div>`;
    const p10 = st.prob(7, 10), p30 = st.prob(15, 30); const last = st.cq[st.cq.length - 1];
    const q7 = st.cq[Math.min(6, st.cq.length - 1)];
    $('kpis-15').innerHTML =
      k(fr() ? '≥ 10 cm en 7 jours' : '≥ 10 cm within 7 days', fmt(p10 * 100, 0), '%', fr() ? 'part des 51 scénarios' : 'share of the 51 scenarios') +
      k(fr() ? '≥ 30 cm en 15 jours' : '≥ 30 cm within 15 days', fmt(p30 * 100, 0), '%', fr() ? 'part des 51 scénarios' : 'share of the 51 scenarios') +
      k(fr() ? 'Cumul médian 7 jours' : 'Median total, 7 days', fmt(q7 ? q7.p50 : null, 0), 'cm', q7 ? `${fmt(q7.p10, 0)} – ${fmt(q7.p90, 0)} cm (10–90 %)` : '') +
      k(fr() ? 'Cumul médian 15 jours' : 'Median total, 15 days', fmt(last ? last.p50 : null, 0), 'cm', last ? `${fmt(last.p10, 0)} – ${fmt(last.p90, 0)} cm (10–90 %)` : '');
    const past = observedDaily(7);
    $('d15-daily-sub').textContent = (fr() ? 'Boîte : 25–75 % des scénarios · trait : 10–90 % · ligne blanche : médiane · en haut : probabilité d’au moins 1 cm.' : 'Box: 25–75 % of scenarios · whisker: 10–90 % · white line: median · on top: chance of at least 1 cm.')
      + (past.length ? (fr() ? ' À gauche, en ambre : neige fraîche mesurée les jours passés (Le Corbier en saison, sinon Saint-Jean-d’Arves).' : ' Left, in amber: fresh snow measured on past days (Le Corbier in season, otherwise Saint-Jean-d’Arves).') : '');
    $('d15-temp-sub').textContent = fr() ? 'Corrigée du biais local de l’IFS. Fines lignes : chaque scénario ; bande : 10–90 %.' : 'Corrected for IFS’s local bias. Thin lines: each scenario; band: 10–90 %.';
    $('d15-cum-sub').textContent = fr() ? 'Éventail des 51 scénarios.' : 'Fan of the 51 scenarios.';
    C.legend('leg-d15-temp', [{ color: COLORS.consensus, label: t('leg.median') }, { color: 'rgba(127,212,255,.45)', label: t('leg.p1090'), shape: 'sq' }]);
    C.legend('leg-d15-cum', [{ color: COLORS.snow, label: t('leg.median') }, { color: 'rgba(127,212,255,.5)', label: t('leg.p2575'), shape: 'sq' }, { color: 'rgba(127,212,255,.25)', label: t('leg.p1090'), shape: 'sq' }]);
    C.ensembleDaily('chart-d15-daily', st, S.now, past);
    C.ensembleTemp('chart-d15-temp', S.ens, st);
    C.ensembleCum('chart-d15-cum', st);
    renderBulletin();
  } catch (e) { console.error(e); ['chart-d15-daily', 'chart-d15-temp', 'chart-d15-cum'].forEach(id => $(id).innerHTML = `<div class="error">${t('misc.error')}</div>`); }
}

// ---------- models section ----------
let verifMetric = 'snow', cmpVar = 'snow', cmpPinned = null;
function renderModels() {
  const v = S.verif;
  $('models-over').textContent = fr() ? 'Vérification locale' : 'Local verification';
  if (!v) { $('verif-table').innerHTML = `<div class="error">${t('misc.error')}</div>`; return; }
  const p0 = v.period[0], p1 = v.period[1];
  const dd = k => new Intl.DateTimeFormat(fr() ? 'fr-FR' : 'en-GB', { month: 'short', year: 'numeric' }).format(new Date(Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, 15)));
  const startCold = +p0.slice(4, 6) >= 5 && +p0.slice(4, 6) <= 10 ? `${p0.slice(0, 4)}11` : p0.slice(0, 6);
  $('verif-sub').textContent = fr() ? `Saisons froides (nov.–avr.), ${dd(startCold)} → ${dd(p1)}. Cadre blanc : meilleur modèle à cette échéance.` : `Cold seasons (Nov–Apr), ${dd(startCold)} → ${dd(p1)}. White frame: best model at that lead time.`;
  const metrics = [['snow', fr() ? 'Jours de neige' : 'Snow days'], ['precip', fr() ? 'Jours de pluie/neige' : 'Wet days'], ['temp', fr() ? 'Température' : 'Temperature'], ['tempraw', fr() ? 'Temp. brute' : 'Raw temp.']];
  const seg = $('verif-metric');
  seg.innerHTML = metrics.map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${k === verifMetric}">${l}</button>`).join('');
  seg.querySelectorAll('button').forEach(b => b.onclick = () => { verifMetric = b.dataset.k; renderModels(); });
  C.verificationTable('verif-table', v, verifMetric);
  const notes = {
    snow: (v.snowSource === 'corbier')
      ? (fr() ? 'Score ETS (0 = hasard, 1 = parfait) pour les jours avec ≥ 5 cm de neige fraîche relevés au Corbier (1 585 m), saisons de ski.' : 'ETS (0 = chance, 1 = perfect) for days with ≥ 5 cm of fresh snow observed at Le Corbier (1,585 m), ski seasons.')
      : (fr() ? 'Score ETS (0 = hasard, 1 = parfait) pour les jours avec ≥ 5 cm de neige fraîche, d’après la hausse de la hauteur de neige à Saint-Jean-d’Arves.' : 'ETS (0 = chance, 1 = perfect) for days with ≥ 5 cm of fresh snow, from rises in snow depth at Saint-Jean-d’Arves.'),
    precip: fr() ? 'Score ETS pour les jours avec ≥ 1 mm de précipitations (06–06 UTC).' : 'ETS for days with ≥ 1 mm of precipitation (06–06 UTC).',
    temp: fr() ? 'Erreur absolue moyenne horaire (°C) après correction du biais propre à chaque modèle, heure par heure.' : 'Mean absolute hourly error (°C) after removing each model’s own bias, hour by hour.',
    tempraw: fr() ? 'Erreur absolue moyenne horaire (°C) des sorties brutes, avant correction.' : 'Mean absolute hourly error (°C) of the raw output, before correction.',
  };
  const src = verifMetric === 'snow' && v.snowSource === 'corbier' ? '' : (fr() ? " Station automatique de Saint-Jean-d'Arves (1 573 m, 4 km du Corbier)." : " Automatic station at Saint-Jean-d'Arves (1,573 m, 4 km from Le Corbier).");
  $('verif-note').textContent = notes[verifMetric] + src + (fr() ? ` Mise à jour : ${new Date(v.generated).toLocaleDateString('fr-FR')}.` : ` Updated ${new Date(v.generated).toLocaleDateString('en-GB')}.`);
  renderFindings();
  renderComparator();
}

function bestAt(v, leads, getter, better) {
  let best = null;
  for (const id in v.scores) {
    if (id.startsWith('mean')) continue;
    const vals = leads.map(L => v.scores[id][L] ? getter(v.scores[id][L]) : null).filter(x => x !== null && x !== undefined);
    if (vals.length < leads.length) continue;
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (!best || (better === 'high' ? m > best.v : m < best.v)) best = { id, v: m };
  }
  return best;
}
function renderFindings() {
  const v = S.verif; const name = id => (v.models[id] || [id])[0];
  const sn = s => s.s && s.s[0], pr = s => s.p && s.p[0], te = s => s.t && s.t[0];
  const b01s = bestAt(v, [0, 1], sn, 'high'), b01t = bestAt(v, [0, 1], te, 'low'), b01p = bestAt(v, [0, 1], pr, 'high');
  const b24s = bestAt(v, [2, 3, 4], sn, 'high'), b24t = bestAt(v, [2, 3, 4], te, 'low');
  const b57t = bestAt(v, [5, 6, 7], te, 'low'), b57p = bestAt(v, [5, 6, 7], pr, 'high');
  const mh = v.scores.mean_hires; const mhs = mh ? (mh[0].s[0] + mh[1].s[0]) / 2 : null;
  const biases = Object.entries(v.scores).filter(([id]) => !id.startsWith('mean')).map(([id, s]) => [id, s[0] && s[0].t ? s[0].t[2] : 0]).sort((a, b) => a[1] - b[1]);
  const f2 = x => fmt(x, 2), f1 = x => fmt(x, 1);
  const items = fr() ? [
    ['0 – 48 h', `<b>${name(b01p.id)}</b> repère le mieux les jours de précipitations (ETS ${f2(b01p.v)}) et <b>${name(b01t.id)}</b> la température (${f1(b01t.v)} °C d’erreur). Pour la neige, <b>la moyenne des modèles kilométriques</b> (ETS ${f2(mhs)}) bat chaque modèle pris seul (meilleur : ${name(b01s.id)}, ${f2(b01s.v)}).`],
    ['J+2 – J+4', `<b>${name(b24s.id)}</b> reste le plus fiable pour la neige (ETS ${f2(b24s.v)}), <b>${name(b24t.id)}</b> pour la température (${f1(b24t.v)} °C).`],
    ['J+5 – J+7', `La qualité chute pour tous (ETS précipitations ≈ ${f2(b57p.v)} au mieux). <b>${name(b57t.id)}</b> garde la meilleure température. Au-delà, seules les probabilités des ensembles ont un sens.`],
    [fr() ? 'Biais' : 'Bias', `Sans correction, <b>${name(biases[0][0])}</b> est ${f1(-biases[0][1])} °C trop froid ici et <b>${name(biases[1][0])}</b> ${f1(-biases[1][1])} °C : les modèles globaux placent de l’air froid dans la cuvette de l’Arvan que la station ne voit pas. Le site corrige chaque modèle heure par heure.`],
  ] : [
    ['0 – 48 h', `<b>${name(b01p.id)}</b> best catches wet days (ETS ${f2(b01p.v)}) and <b>${name(b01t.id)}</b> temperature (${f1(b01t.v)} °C error). For snow, <b>the average of the km-scale models</b> (ETS ${f2(mhs)}) beats every single model (best: ${name(b01s.id)}, ${f2(b01s.v)}).`],
    ['D+2 – D+4', `<b>${name(b24s.id)}</b> stays the most reliable for snow (ETS ${f2(b24s.v)}), <b>${name(b24t.id)}</b> for temperature (${f1(b24t.v)} °C).`],
    ['D+5 – D+7', `Skill drops for every model (precipitation ETS ≈ ${f2(b57p.v)} at best). <b>${name(b57t.id)}</b> keeps the best temperature. Beyond that, only ensemble probabilities make sense.`],
    ['Bias', `Uncorrected, <b>${name(biases[0][0])}</b> is ${f1(-biases[0][1])} °C too cold here and <b>${name(biases[1][0])}</b> ${f1(-biases[1][1])} °C: global models put cold air in the Arvan bowl that the station doesn’t see. The site corrects each model hour by hour.`],
  ];
  $('findings-title').textContent = fr() ? 'Ce qu’il faut retenir' : 'Key takeaways';
  $('findings-sub').textContent = fr() ? 'Calculé à partir du tableau, mis à jour chaque semaine.' : 'Derived from the table, refreshed weekly.';
  $('findings').innerHTML = items.map(([h, txt]) => `<li><span class="h">${h}</span>${txt}</li>`).join('');
}

function renderComparator() {
  const vars = [['snow', t('models.var.snow')], ['precip', t('models.var.precip')], ['temp', t('models.var.temp')], ['snowline', t('models.var.snowline')]];
  const seg = $('cmp-var');
  seg.innerHTML = vars.map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${k === cmpVar}">${l}</button>`).join('');
  seg.querySelectorAll('button').forEach(b => b.onclick = () => { cmpVar = b.dataset.k; renderComparator(); });
  const t0 = S.now, t1 = S.now + 10 * 24 * HOUR;
  const idx = S.fc.time.map((tt, i) => [tt, i]).filter(([tt]) => tt >= t0 - 6 * HOUR && tt <= t1);
  const z = BZ;
  const series = MODELS.filter(m => S.fc.series[m.id]).map(m => {
    const s = S.fc.series[m.id]; let acc = 0;
    const values = idx.map(([tt, i]) => {
      const d = D.derivedAt(s, i, z); if (!d) return { time: tt, v: null };
      if (cmpVar === 'temp') return { time: tt, v: d.t };
      if (cmpVar === 'snowline') return { time: tt, v: d.line };
      if (tt <= t0) return { time: tt, v: 0 };
      acc += cmpVar === 'snow' ? (d.cm || 0) : (d.p || 0);
      return { time: tt, v: acc };
    });
    return { id: m.id, short: m.short, color: m.color, values };
  });
  let acc = 0;
  const cons = idx.map(([tt, i]) => { const d = S.cons[BZ][i]; if (!d || !d.n) return { time: tt, v: null };
    if (cmpVar === 'temp') return { time: tt, v: d.t }; if (cmpVar === 'snowline') return { time: tt, v: d.line };
    if (tt <= t0) return { time: tt, v: 0 }; acc += cmpVar === 'snow' ? (d.cm || 0) : (d.p || 0); return { time: tt, v: acc }; });
  const opts = { snow: { unit: 'cm', zeroBased: true, endLabels: true, digits: 0 }, precip: { unit: 'mm', zeroBased: true, endLabels: true, digits: 0 }, temp: { unit: '°C', zeroLine: true, digits: 1 }, snowline: { unit: 'm', digits: 0 } }[cmpVar];
  $('cmp-sub').textContent = fr() ? (cmpVar === 'snow' || cmpVar === 'precip' ? `Cumul à ${zm(BZ)} sur 10 jours, modèle par modèle. Les températures sont corrigées du biais local avant le calcul de la neige.` : `À ${zm(BZ)}, modèle par modèle, températures corrigées du biais local.`) : (cmpVar === 'snow' || cmpVar === 'precip' ? `Running total at ${zm(BZ)} over 10 days, model by model. Temperatures are bias-corrected before snow is computed.` : `At ${zm(BZ)}, model by model, bias-corrected temperatures.`);
  C.legend('leg-cmp', [{ id: 'consensus', color: COLORS.consensus, label: t('leg.consensus') }, ...MODELS.filter(m => S.fc.series[m.id] && m.color).map(m => ({ id: m.id, color: m.color, label: `${m.short} <span style="color:var(--ink-3)">${m.res}</span>` })), { id: 'extra', color: '#6b7d97', label: 'ICON-2I, ICON-EU' }]);
  // hover a model in the legend to isolate its curve, click to keep it
  const legEl = $('leg-cmp'); legEl.classList.add('interactive');
  legEl.querySelectorAll('.k[data-id]').forEach(k => {
    k.classList.toggle('pinned', k.dataset.id === cmpPinned);
    k.onmouseenter = () => C.highlight('chart-cmp', k.dataset.id);
    k.onmouseleave = () => C.highlight('chart-cmp', cmpPinned);
    k.onclick = () => { cmpPinned = cmpPinned === k.dataset.id ? null : k.dataset.id; legEl.querySelectorAll('.k').forEach(x => x.classList.toggle('pinned', x.dataset.id === cmpPinned)); C.highlight('chart-cmp', cmpPinned); };
  });
  C.comparator('chart-cmp', series, cons, { ...opts, focus: cmpPinned });
}

// ---------- season ----------
let wkVar = 'temp', moVar = 'temp';
async function renderSeason() {
  $('season-over').textContent = fr() ? 'Semaines 1 – 6 · Mois 1 – 6' : 'Weeks 1 – 6 · Months 1 – 6';
  try {
    if (!S.sub) S.sub = await D.fetchSubseasonal();
    if (!S.seas) S.seas = await D.fetchSeasonal();
  } catch (e) { console.error(e); }
  if (S.c3s === null) S.c3s = await D.fetchBaked('seasonal-c3s.json');
  const vdef = {
    temp: { key: 'temperature_2m_anomaly', unit: '°C', pos: '#dc3c3d', neg: '#338ced', name: fr() ? 'Écart de température' : 'Temperature anomaly', digits: 1, minExt: 1 },
    snow: { key: 'snowfall_anomaly', unit: 'cm', pos: '#dff3ff', neg: '#e76624', name: fr() ? 'Écart de chutes de neige' : 'Snowfall anomaly', digits: 0, minExt: 5 },
    precip: { key: 'precipitation_anomaly', unit: 'mm', pos: '#338ced', neg: '#e76624', name: fr() ? 'Écart de précipitations' : 'Precipitation anomaly', digits: 0, minExt: 5 },
  };
  const segs = (el, cur, cb) => { el.innerHTML = [['temp', t('models.var.temp')], ['snow', t('models.var.snow')], ['precip', t('models.var.precip')]].map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${k === cur}">${l}</button>`).join(''); el.querySelectorAll('button').forEach(b => b.onclick = () => cb(b.dataset.k)); };
  segs($('weekly-var'), wkVar, k => { wkVar = k; renderSeason(); });
  segs($('monthly-var'), moVar, k => { moVar = k; renderSeason(); });
  if (S.sub && S.sub.weekly) {
    const W = S.sub.weekly; const V = vdef[wkVar];
    const items = W.time.map((tt, i) => ({ tt: tt * 1000, v: W[V.key] ? W[V.key][i] : null })).filter(o => o.v !== null && o.v !== undefined).slice(0, 6).map((o, k) => {
      const d0 = new Date(o.tt), d1 = new Date(o.tt + 6 * 864e5);
      const f = d => new Intl.DateTimeFormat(fr() ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d);
      return { label: (fr() ? 'S' : 'W') + (k + 1), sub: f(d0), title: `${f(d0)} – ${f(d1)}`, v: o.v };
    });
    $('weekly-sub').textContent = fr() ? 'Moyenne des 101 membres EC46, par rapport aux 20 dernières années du modèle. Grille de 36 km : à lire comme une tendance régionale.' : 'Mean of the 101 EC46 members versus the model’s last 20 years. 36 km grid: read as a regional tendency.';
    C.anomalyBars('chart-weekly', items, { ...V });
  }
  const mo = S.seas && S.seas.monthly;
  if (mo) {
    const V = vdef[moVar];
    const c3sKey = { temp: 't2m', snow: 'sf', precip: 'tp' }[moVar];
    const items = mo.time.map((tt, i) => {
      const d = new Date(tt * 1000);
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const systems = S.c3s && S.c3s.months && S.c3s.months[ym] && S.c3s.months[ym][c3sKey] ? Object.entries(S.c3s.months[ym][c3sKey]).map(([name, v]) => ({ name, v })) : [];
      return { label: new Intl.DateTimeFormat(fr() ? 'fr-FR' : 'en-GB', { month: 'short', timeZone: 'UTC' }).format(d), sub: String(d.getUTCFullYear()).slice(2), title: new Intl.DateTimeFormat(fr() ? 'fr-FR' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d), v: mo[V.key] ? mo[V.key][i] : null, systems };
    });
    $('monthly-sub').textContent = S.c3s ? (fr() ? 'Barres : ECMWF SEAS5 · points : autres systèmes Copernicus C3S.' : 'Bars: ECMWF SEAS5 · dots: other Copernicus C3S systems.') : (fr() ? 'ECMWF SEAS5, moyenne des 51 membres, grille de 36 km.' : 'ECMWF SEAS5, mean of 51 members, 36 km grid.');
    $('monthly-note').textContent = fr() ? 'Dans les Alpes, la prévision saisonnière a peu de savoir-faire en hiver, surtout pour la neige : la température porte un peu d’information, les précipitations très peu. À lire comme une indication, pas une prévision.' : 'In the Alps, seasonal forecasts have little skill in winter, especially for snow: temperature carries some information, precipitation very little. Read as a hint, not a forecast.';
    C.anomalyBars('chart-monthly', items, { ...V });
  }
}

// ---------- webcams ----------
// Skaping's own viewer is embedded (their pages allow framing), so the panoramas stay live and interactive.
// Webcams: the latest still of each camera (found from Skaping's capture schedule), refreshed every
// 10 minutes; the live view opens in the card itself.
const loadImg = src => new Promise((res, rej) => { const im = new Image(); im.referrerPolicy = 'no-referrer'; im.onload = () => res(im); im.onerror = rej; im.src = src; });
const parisParts = ms => { const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms)); const g = k => p.find(x => x.type === k).value; return { y: g('year'), m: g('month'), d: g('day'), H: g('hour'), M: g('minute') }; };
async function latestStill(cam, size) {
  if (cam.thumb) { const im = await loadImg(`${cam.thumb}?t=${Math.floor(Date.now() / 60e3)}`); return { src: im.src, time: Date.now() }; }
  // newest capture slots first, over the last 4 hours
  const t0 = Math.floor(Date.now() / 60e3) * 60e3; const slots = [];
  for (let k = 0; k <= 240 && slots.length < 12; k++) {
    const t = t0 - k * 60e3; const q = parisParts(t);
    if ((+q.M - cam.offset) % cam.step === 0) slots.push({ t, url: `${SKAPING_S3}${cam.path}/${q.y}/${q.m}/${q.d}/${size}/${q.H}-${q.M}.jpg` });
  }
  for (const s of slots) { try { await loadImg(s.url); return { src: s.url, time: s.t }; } catch (e) { /* not uploaded yet: try the previous slot */ } }
  throw new Error('no recent image');
}
const camLabel = c => ({ t: fr() ? c.fr : c.en, s: fr() ? c.subFr : c.subEn });
const hhmm = ms => new Intl.DateTimeFormat(fr() ? 'fr-FR' : 'en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(ms));
function camButtons(c, live) {
  if (!c.page) return `<a class="go" href="${c.link}" target="_blank" rel="noopener">${new URL(c.link).hostname} ↗</a>`;
  return `<button type="button" class="go live-btn" data-live="${live ? 1 : 0}">${live ? (fr() ? 'Image fixe' : 'Still') : (fr() ? '● Direct' : '● Live')}</button><a class="go" href="${c.page}" target="_blank" rel="noopener">Skaping ↗</a>`;
}
function renderCams() {
  const grid = $('cam-grid');
  if (!grid.dataset.built) {
    grid.innerHTML = CAMS.map(c => `<figure class="cam" data-id="${c.id}">
      <div class="still${c.thumb ? '' : ' pano'}"><div class="ph">${fr() ? 'Chargement…' : 'Loading…'}</div></div>
      <figcaption><span><span class="t"></span><span class="s"></span><span class="when"></span></span><span class="acts"></span></figcaption></figure>`).join('');
    grid.dataset.built = '1';
    // the live camera starts in live mode (its iframe is lazy, so the stream loads only near the viewport)
    CAMS.filter(c => c.thumb).forEach(c => toggleLive(c, grid.querySelector(`.cam[data-id="${c.id}"]`)));
    refreshStills();
    setInterval(() => { if (!document.hidden) refreshStills(); }, 10 * 60e3);
  }
  CAMS.forEach(c => {
    const el = grid.querySelector(`.cam[data-id="${c.id}"]`); const L = camLabel(c);
    el.querySelector('.t').textContent = L.t; el.querySelector('.s').textContent = L.s;
    const live = !!el.querySelector('iframe');
    el.querySelector('.acts').innerHTML = camButtons(c, live);
    const lb = el.querySelector('.live-btn'); if (lb) lb.onclick = () => toggleLive(c, el);
    if (el.dataset.time) el.querySelector('.when').textContent = live ? (fr() ? 'en direct' : 'live') : `${fr() ? 'image de' : 'image at'} ${hhmm(+el.dataset.time)}`;
  });
}
function toggleLive(c, el) {
  const fr0 = el.querySelector('iframe');
  if (fr0) { fr0.remove(); el.querySelector('.still').hidden = false; }
  else {
    el.querySelector('.still').hidden = true;
    el.insertAdjacentHTML('afterbegin', `<iframe src="${c.page}" title="${camLabel(c).t}" allow="fullscreen; autoplay" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`);
  }
  renderCams();
}
async function refreshStills() {
  await Promise.all(CAMS.map(async c => {
    const el = $('cam-grid').querySelector(`.cam[data-id="${c.id}"]`); const box = el.querySelector('.still');
    try {
      const r = await latestStill(c, window.innerWidth < 700 ? 'mini' : 'small');
      el.dataset.time = r.time;
      if (c.thumb) box.innerHTML = `<img src="${r.src}" alt="${camLabel(c).t}" referrerpolicy="no-referrer"><span class="play" aria-hidden="true"><svg width="18" height="20" viewBox="0 0 10 12"><path d="M0 0l10 6-10 6z" fill="currentColor"/></svg></span>`;
      else {
        const keep = box.querySelector('.scroller'); const left = keep ? keep.scrollLeft : null;
        box.innerHTML = `<div class="scroller"><img src="${r.src}" alt="${camLabel(c).t}" referrerpolicy="no-referrer" draggable="false"></div><span class="hint">${fr() ? '⟷ faites glisser' : '⟷ drag'}</span>`;
        const sc = box.querySelector('.scroller'); const img = sc.querySelector('img');
        const center = () => { sc.scrollLeft = left !== null ? left : (sc.scrollWidth - sc.clientWidth) / 2; };
        if (img.complete) center(); else img.onload = center;
        // drag to pan the panorama
        let x0 = null, s0 = 0;
        sc.onpointerdown = e => { x0 = e.clientX; s0 = sc.scrollLeft; sc.setPointerCapture(e.pointerId); sc.classList.add('drag'); };
        sc.onpointermove = e => { if (x0 !== null) sc.scrollLeft = s0 - (e.clientX - x0); };
        sc.onpointerup = sc.onpointercancel = () => { x0 = null; sc.classList.remove('drag'); };
        sc.ondblclick = () => window.open(r.src.replace(/\/(mini|small)\//, '/large/'), '_blank', 'noopener');
      }
      if (c.thumb) box.querySelector('.play').onclick = () => toggleLive(c, el);
    } catch (e) {
      box.innerHTML = `<div class="ph">${fr() ? 'Pas d’image récente — ouvrez le direct' : 'No recent image — open the live view'}</div>`;
    }
  }));
  renderCams();
}

// ---------- archive ----------
// Cumulative snowfall since 1 November, at the village or (toggle) at the top of the resort (climate.json `top`)
function renderArchiveCum() {
  const c0 = S.climate; if (!c0) return;
  const seg = $('arch-cum-z'), hasTop = !!(c0.top && c0.top.pct);
  seg.hidden = !hasTop;
  const atTop = hasTop && S.archTop, c = atTop ? c0.top : c0, z = atTop ? TZ : BZ;
  seg.querySelectorAll('button').forEach(b => {
    const top = b.dataset.z === 'top';
    b.textContent = top ? `${SITE.top.short || SITE.top.name} · ${zm(TZ)}` : `Village · ${zm(BZ)}`;
    b.setAttribute('aria-pressed', String(top === !!atTop));
    b.onclick = () => { S.archTop = top; renderArchiveCum(); };
  });
  $('arch-cum-title').textContent = fr() ? `Cumul de neige depuis le 1ᵉʳ novembre à ${zm(z)}` : `Snowfall since 1 November at ${zm(z)}`;
  const ci = c.current.length - 1;
  const lastDay = new Intl.DateTimeFormat(fr() ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(c.currentWinter - 1, 10, 1) + ci * 864e5));
  const where = atTop ? ` (${SITE.top.name})` : '';
  // ERA5 re-split at the summit: above ~1,700 m nearly all winter precipitation is already snow, so the curve saturates
  const note = !atTop ? '' : fr() ? ' Au-dessus de 1 700 m environ, presque toutes les précipitations d’hiver tombent déjà en neige dans ERA5 : le cumul y plafonne (pas de gradient de précipitations avec l’altitude).' : ' Above about 1,700 m nearly all winter precipitation already falls as snow in ERA5, so the total levels off (no precipitation gradient with elevation).';
  $('arch-cum-sub').textContent = (fr() ? `Réanalyse ERA5 à ${zm(z)}${where}, jusqu’au ${lastDay}. Bandes : 10–90 % et 25–75 % des hivers 1991–2020.` : `ERA5 reanalysis at ${zm(z)}${where}, up to ${lastDay}. Bands: 10–90 % and 25–75 % of the 1991–2020 winters.`) + note;
  C.legend('leg-arch-cum', [{ color: COLORS.snow, label: t('leg.thisSeason') }, { color: '#9887ef', label: c.lastLabel }, { color: COLORS.ink2, label: t('leg.normal') }]);
  C.archiveCum('chart-arch-cum', c);
}

function renderArchive() {
  const c = S.climate; if (!c) { ['chart-arch-cum', 'chart-arch-depth', 'chart-arch-totals'].forEach(id => $(id).innerHTML = `<div class="error">${t('misc.error')}</div>`); return; }
  const full = c.winters.filter(w => !w.partial);
  $('archive-over').textContent = `${full[0].year - 1} → ${new Date().getFullYear()}`;
  renderArchiveCum();
  if (c.station) {
    const st = c.station; const isC = st.id === '73318400';
    $('arch-depth-sub').textContent = isC
      ? (fr() ? 'Relevés nivologiques Météo-France au Corbier, pendant la saison de ski.' : 'Météo-France snow observations at Le Corbier, during the ski season.') + (st.seasons.some(s => s.source === 'auto') ? (fr() ? " Saison en cours : station de Saint-Jean-d'Arves (1 573 m) en attendant les premiers relevés." : " This season: Saint-Jean-d'Arves station (1,573 m) until the first observations.") : '')
      : (fr() ? "Maximum journalier de la hauteur de neige, station de Saint-Jean-d'Arves (1 573 m)." : "Daily maximum snow depth, Saint-Jean-d'Arves station (1,573 m).");
    C.legend('leg-arch-depth', c.station.seasons.slice().reverse().map((s, k) => ({ color: s.current ? COLORS.snow : ['#9887ef', '#00a888', '#e24d8b', '#d28e05'][c.station.seasons.length - 1 - k] || '#9887ef', label: s.label })));
    C.archiveDepth('chart-arch-depth', c.station.seasons);
  }
  const mean = full.reduce((a, w) => a + w.snow, 0) / full.length;
  $('arch-tot-sub').textContent = fr() ? `Neige tombée entre novembre et avril à ${zm(BZ)} selon ERA5 (moyenne ${fmt(mean, 0)} cm). La réanalyse à 25–30 km lisse le relief : à lire en tendance, pas en valeur absolue.` : `Snowfall between November and April at ${zm(BZ)} according to ERA5 (mean ${fmt(mean, 0)} cm). At 25–30 km the reanalysis smooths the terrain: read the trend, not the absolute value.`;
  C.legend('leg-arch-tot', [{ color: '#338ced', label: fr() ? 'Hiver complet' : 'Full winter', shape: 'sq' }, { color: COLORS.warm, label: fr() ? 'Tendance linéaire' : 'Linear trend' }]);
  C.archiveTotals('chart-arch-totals', c);
  const ref = full.filter(w => w.year >= 1971 && w.year <= 2000); const rec = full.slice(-10);
  const m = a => a.reduce((s, w) => s + w.tdjf, 0) / a.length;
  $('arch-stripes-sub').textContent = fr() ? `Température moyenne de décembre à février, écart à 1971–2000. Les dix derniers hivers sont ${fmt(m(rec) - m(ref), 1)} °C plus doux.` : `Mean December–February temperature, departure from 1971–2000. The last ten winters are ${fmt(m(rec) - m(ref), 1)} °C milder.`;
  C.winterStripes('chart-stripes', c);
}

// ---------- methods ----------
// One sentence on the multi-winter calibration of the snowpack constants (data/snowcal.json)
function calText(lang) {
  const c = S.cal; if (!c || !c.skill) return '';
  const w = c.winters.map(x => x.winter); const r = c.skill.rmseCm;
  if (lang === 'fr') return c.used
    ? ` Chaque station est simulée sur sa propre pente (Saint-Jean-d’Arves est sur un versant sud-ouest de 21°), d’après le relief IGN. Les constantes du modèle (fonte, seuil pluie-neige, tassement…) ont été calées sur ${w.length} hivers (${w[0]} à ${w[w.length - 1]}) de mesures Météo-France ; testé sur chaque hiver avec des constantes calées sur les autres, l’écart moyen passe de ${fmt(r.live.default, 1)} à ${fmt(r.live.calibrated, 1)} cm.`
    : ` Un calage des constantes sur ${w.length} hivers de mesures Météo-France n’a pas fait mieux que les valeurs par défaut, qui sont conservées.`;
  return c.used
    ? ` Each station is simulated on its own slope (Saint-Jean-d’Arves sits on a 21° south-west slope), from the IGN terrain. The model constants (melt, rain–snow threshold, settling…) were calibrated on ${w.length} winters (${w[0]} to ${w[w.length - 1]}) of Météo-France measurements; tested on each winter with constants fitted on the others, the mean error goes from ${fmt(r.live.default, 1)} to ${fmt(r.live.calibrated, 1)} cm.`
    : ` Calibrating the constants on ${w.length} winters of Météo-France measurements did not beat the default values, which are kept.`;
}
function renderMethods() {
  $('methods').innerHTML = fr() ? `
    <p><b>Prévision.</b> Douze modèles (AROME HD, ICON-CH1/CH2, ICON-D2, ICON-2I, ICON-EU, ARPEGE, IFS, AIFS, UKMO, GFS…) sont lus en direct via Open-Meteo pour le front de neige ${SITE.of.fr}. Chacun est d’abord corrigé de son biais de température propre, heure par heure et échéance par échéance, puis pondéré selon son score local : 1/erreur² pour la température, ETS² pour les précipitations.</p>
    <p><b>Neige.</b> La part de neige dans les précipitations se déduit de la limite pluie-neige du modèle quand il la fournit, sinon de son isotherme 0 °C, sinon de la température humide. La hauteur de neige fraîche utilise une densité qui dépend de la température (Hedstrom &amp; Pomeroy, 1998). On ne suppose pas de gradient de précipitations avec l’altitude.</p>
    <p><b>Vérification.</b> Les prévisions passées (archives Open-Meteo, échéances J0 à J+7) sont comparées chaque semaine aux mesures Météo-France, de novembre à avril : neige fraîche relevée chaque matin au Corbier (1 585 m) pendant la saison de ski, température et précipitations horaires de la station automatique de Saint-Jean-d’Arves (1 573 m, 4 km). Deux hivers seulement : les classements restent indicatifs.</p>
    <p><b>Neige au sol.</b> Un petit modèle de manteau neigeux tourne heure par heure depuis le 1<sup>er</sup> octobre, par tranches de 100 m d’altitude : chutes de neige, fonte par degrés-jours, tassement. Il est forcé par les analyses des modèles (ICON, AROME, IFS) pour le passé, puis par le consensus ci-dessus pour les 15 prochains jours. Un facteur de précipitations et un décalage de température sont ajustés pour reproduire les hauteurs de neige mesurées chaque matin par Météo-France autour du Corbier (Saint-Jean-d’Arves, Saint-Sorlin-d’Arves, Albiez, Valmeinier, Val Thorens, Saint-Martin-de-Belleville, Saint-Sorlin 2 090 m et Le Corbier en saison), puis le manteau est recalé sur les dernières mesures.${calText('fr')} Chaque tranche est aussi calculée pour des pentes de 15°, 30° et 45° orientées dans les huit directions : la fonte y est modulée par l’ensoleillement théorique de la pente ce jour-là (un adret à 30° reçoit près de deux fois l’énergie d’un terrain plat en décembre, un ubac cinq fois moins). La carte attribue à chaque pixel la hauteur correspondant à son altitude, sa pente et son orientation, tirées du relief IGN. Les ombres portées par les crêtes voisines ne sont pas prises en compte ; les chiffres affichés par altitude sont ceux d’un terrain plat, comme aux stations.</p>
    <p><b>Carte.</b> Le relief est le RGE ALTI de l’IGN, décodé dans le navigateur. Les couleurs de neige suivent l’altitude, à partir des mêmes calculs. Les bâtiments et remontées viennent de la BD TOPO, les pistes d’OpenStreetMap ; l’image satellite est la dernière scène Sentinel-2 assez dégagée.</p>
    <p><b>Bulletin.</b> Le texte en haut de page est généré à partir des seules prévisions de cette page ; quand un modèle de langage est configuré, il le reformule toutes les heures sans en changer les chiffres (texte de moins de trois heures, sinon la version automatique).</p>` : `
    <p><b>Forecast.</b> Twelve models (AROME HD, ICON-CH1/CH2, ICON-D2, ICON-2I, ICON-EU, ARPEGE, IFS, AIFS, UKMO, GFS…) are read live through Open-Meteo for the snow front ${SITE.of.en}. Each one first has its own temperature bias removed, hour by hour and lead time by lead time. Each is then weighted by its local score: 1/error² for temperature, ETS² for precipitation.</p>
    <p><b>Snow.</b> The snow share of precipitation comes from the model’s rain–snow line when it provides one, otherwise from its freezing level, otherwise from wet-bulb temperature. Fresh snow depth uses a temperature-dependent density (Hedstrom &amp; Pomeroy, 1998). No precipitation gradient with elevation is assumed.</p>
    <p><b>Verification.</b> Past forecasts (Open-Meteo archive, lead days 0 to 7) are compared every week with Météo-France measurements, November to April: fresh snow observed every morning at Le Corbier (1,585 m) during the ski season, and hourly temperature and precipitation from the automatic station at Saint-Jean-d’Arves (1,573 m, 4 km away). Only two winters so far: rankings are indicative.</p>
    <p><b>Snow on the ground.</b> A small snowpack model runs hourly from 1 October in 100 m elevation bands: snowfall, degree-day melt, settling. It is driven by the models’ analyses (ICON, AROME, IFS) for the past and by the consensus above for the next 15 days. A precipitation factor and a temperature offset are fitted to reproduce the snow depths measured every morning by Météo-France around Le Corbier (Saint-Jean-d’Arves, Saint-Sorlin-d’Arves, Albiez, Valmeinier, Val Thorens, Saint-Martin-de-Belleville, Saint-Sorlin 2,090 m, and Le Corbier in season); the snowpack is then re-anchored on the latest measurements.${calText('en')} Each band is also computed for slopes of 15°, 30° and 45° facing the eight directions: melt is scaled by the slope’s clear-sky sunshine that day (a 30° south-facing slope gets almost twice the energy of flat ground in December, a north-facing one five times less). The map gives each pixel the depth for its elevation, slope and aspect, taken from the IGN terrain. Shadows cast by neighbouring ridges are not included; the figures quoted by elevation are for flat ground, like the stations.</p>
    <p><b>Map.</b> The terrain is IGN’s RGE ALTI, decoded in the browser. Snow colours follow elevation, from the same calculations. Buildings and lifts come from BD TOPO, pistes from OpenStreetMap; the satellite image is the latest reasonably clear Sentinel-2 scene.</p>
    <p><b>Bulletin.</b> The text at the top of the page is generated from this page’s forecasts only; when a language model is configured it rephrases it every hour without changing the numbers (text less than three hours old, otherwise the automatic version).</p>`;
  $('build-info').textContent = fr() ? `Page générée dans votre navigateur le ${new Date(S.now).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}.` : `Page generated in your browser on ${new Date(S.now).toLocaleString('en-GB', { timeZone: 'Europe/Paris' })}.`;
}

// ---------- map wiring ----------
function initMap() {
  try {
    S.map = createMap('map', { onReady: () => { S.mapReady = true; initSatToggle(); syncMap(); } });
  } catch (e) { console.error(e); $('map-loading').textContent = t('misc.error'); return; }
  document.querySelectorAll('input[name="snowlayer"]').forEach(r => r.addEventListener('change', () => {
    S.snowMode = r.value; S.modeChosen = true; stopPlay(); markMode(); syncMap();
  }));
  [['lyr-buildings', 'buildings'], ['lyr-lifts', 'lifts'], ['lyr-pistes', 'pistes'], ['lyr-lidar', 'lidar']].forEach(([id, l]) => $(id).addEventListener('change', e => { S.map && S.map.setVisible(l, e.target.checked); e.target.closest('.toggle').classList.toggle('on', e.target.checked); }));
  $('lyr-sat').addEventListener('change', e => { S.map.setSatellite(e.target.checked); e.target.closest('.toggle').classList.toggle('on', e.target.checked); });
  $('btn-3d').addEventListener('click', e => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); S.map.set3D(on); if (!on) { $('btn-orbit').setAttribute('aria-pressed', 'false'); S.map.orbit(false); } });
  $('btn-orbit').addEventListener('click', e => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on));
    if (on && $('btn-3d').getAttribute('aria-pressed') !== 'true') { $('btn-3d').setAttribute('aria-pressed', 'true'); S.map.set3D(true); setTimeout(() => S.map.orbit(true), 1800); } else S.map.orbit(on);
  });
}
function markMode() {
  document.querySelectorAll('input[name="snowlayer"]').forEach(x => { x.checked = x.value === S.snowMode; x.closest('.toggle').classList.toggle('on', x.checked); });
}
function initSatToggle() {
  const s2 = S.map && S.map.s2; $('lyr-sat-row').hidden = !s2; if (!s2) return;
  const d = new Intl.DateTimeFormat(fr() ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short' }).format(new Date(s2.date));
  $('lyr-sat-label').textContent = fr() ? `Image satellite · ${d}` : `Satellite image · ${d}`;
}
// Opening layer: fresh snow when some is on the way, otherwise snow on the ground; first snowy day preselected
function chooseInitialView() {
  if (S.modeChosen || !S.fresh || !S.packTried) return;
  S.modeChosen = true;
  const summit = d => atZ(freshProfile(d, false), TZ);
  const first = S.days.findIndex(w => w.d < TREND_FROM && summit(w.d) >= 3);
  if (first < 0 && S.pack) { S.snowMode = 'depth'; S.day = 0; } else { S.snowMode = 'fresh'; S.day = Math.max(0, first); }
  markMode();
}
let playTimer = null;
function stopPlay() { if (playTimer) { clearInterval(playTimer); playTimer = null; } const b = document.querySelector('#tl-tools .play'); if (b) b.innerHTML = PLAY_ICON; }
const PLAY_ICON = '<svg width="10" height="12" viewBox="0 0 10 12"><path d="M0 0l10 6-10 6z" fill="currentColor"/></svg>';
const PAUSE_ICON = '<svg width="10" height="12" viewBox="0 0 10 12"><path d="M0 0h3.5v12H0zM6.5 0H10v12H6.5z" fill="currentColor"/></svg>';
const dayName = (w, long) => new Intl.DateTimeFormat(fr() ? 'fr-FR' : 'en-GB', { weekday: long ? 'long' : 'short', day: 'numeric', ...(long ? { month: 'long' } : {}), timeZone: 'UTC' }).format(new Date(w.label));
const wd = w => w.d === 0 ? (fr() ? 'auj.' : 'today') : new Intl.DateTimeFormat(fr() ? 'fr-FR' : 'en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(w.label)).replace('.', '');
const dn = w => new Intl.DateTimeFormat(fr() ? 'fr-FR' : 'en-GB', { day: 'numeric', timeZone: 'UTC' }).format(new Date(w.label));
const cm0 = v => (v < 0.5 ? '0' : fmt(v, 0));

function syncMap() {
  if (!S.map || !S.mapReady || !S.fc || !S.fresh) return;
  chooseInitialView();
  const ctl = $('tl-control'), lab = $('tl-label'), val = $('tl-value'), tools = $('tl-tools'), leg = $('layer-legend');
  if (S.snowMode === 'depth' && !S.pack) { S.snowMode = 'fresh'; markMode(); }
  if (S.snowMode === 'line') {
    stopPlay(); tools.innerHTML = '';
    lab.innerHTML = fr() ? 'Limite pluie-neige' : 'Rain–snow line';
    const max = 120; ctl.innerHTML = `<input type="range" min="0" max="${max}" step="1" value="${S.lineHour}" aria-label="${t('map.hour')}" style="margin:8px 0 4px">`;
    const input = ctl.querySelector('input');
    const apply = () => {
      S.lineHour = +input.value; input.style.setProperty('--p', `${(S.lineHour / max) * 100}%`);
      const target = S.now + S.lineHour * HOUR; const c = S.cons[BZ]; const d = c.reduce((a, x) => (Math.abs(x.time - target) < Math.abs(a.time - target) ? x : a), c[0]);
      S.map.setSnowLine(d.line);
      val.innerHTML = `${new Intl.DateTimeFormat(fr() ? 'fr-FR' : 'en-GB', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(d.time))} · <b>${d.line !== null ? fmt(Math.round(d.line / 50) * 50) + ' m' : '–'}</b>`;
    };
    input.addEventListener('input', apply); apply(); fitHero();
    leg.innerHTML = `<div class="legend" style="margin:4px 8px"><span class="k"><span class="sq" style="background:#dff3ff"></span>${t('leg.snow')}</span><span class="k"><span class="sq" style="background:#ffd27a"></span>${fr() ? 'Limite' : 'Line'}</span><span class="k"><span class="sq" style="background:#1b4f8f"></span>${t('leg.rain')}</span></div>`;
    return;
  }
  const depth = S.snowMode === 'depth';
  S.day = Math.min(S.day, DAYS - 1);
  // header: title, day/total switch, play
  const hb = fr() ? `haut ${zm(TZ)} · bas ${zm(BZ)}` : `top ${zm(TZ)} · base ${zm(BZ)}`;
  lab.innerHTML = depth ? `${fr() ? 'Neige au sol' : 'Snow on the ground'}<small>${hb}</small>`
    : `${fr() ? 'Neige fraîche' : 'Fresh snow'}<small>cm · ${hb}</small>`;
  tools.innerHTML = (depth ? '' : `<div class="seg-mini" role="group"><button type="button" data-c="0" aria-pressed="${!S.cumul}">${fr() ? 'Par jour' : 'Daily'}</button><button type="button" data-c="1" aria-pressed="${S.cumul}">${fr() ? 'Cumul' : 'Total'}</button></div>`)
    + `<button class="play" type="button" aria-label="${fr() ? 'Faire défiler les jours' : 'Play through the days'}">${playTimer ? PAUSE_ICON : PLAY_ICON}</button>`;
  tools.querySelectorAll('.seg-mini button').forEach(b => b.onclick = () => { S.cumul = b.dataset.c === '1'; syncMap(); });
  tools.querySelector('.play').onclick = () => {
    if (playTimer) { stopPlay(); return; }
    if (S.day >= DAYS - 1) S.day = 0;
    playTimer = setInterval(() => { if (S.day >= DAYS - 1) { stopPlay(); return; } S.day++; paintDay(); }, 1000);
    tools.querySelector('.play').innerHTML = PAUSE_ICON; paintDay();
  };
  // values for the strip
  const vals = S.days.map(w => {
    const prof = depth ? depthProfile(w.d) : freshProfile(w.d, S.cumul);
    return { hi: atZ(prof, TZ), lo: atZ(prof, BZ) };
  });
  const scale = Math.max(depth ? 100 : S.cumul ? 30 : 20, ...vals.map(v => v.hi));
  ctl.innerHTML = `<div class="days" role="group" aria-label="${fr() ? 'Jours' : 'Days'}">${S.days.map((w, i) => {
    const v = vals[i]; const tr = w.d >= TREND_FROM;
    return `<button type="button" class="day${tr ? ' trend' : ''}${w.d === TREND_FROM ? ' first-trend' : ''}" data-d="${w.d}" data-trend="${fr() ? 'tendance' : 'trend'}" aria-pressed="${w.d === S.day}" title="${dayName(w, true)}">
      <span class="dw">${wd(w)}</span><span class="dn">${dn(w)}</span>
      <span class="bar"><i style="--h:${Math.min(100, (v.hi / scale) * 100).toFixed(0)}%"></i></span>
      <span class="hi${v.hi < 0.5 ? ' zero' : ''}">${cm0(v.hi)}</span><span class="lo">${cm0(v.lo)}</span></button>`;
  }).join('')}</div>`;
  ctl.querySelectorAll('.day').forEach(b => b.onclick = () => { stopPlay(); S.day = +b.dataset.d; paintDay(); });
  paintDay(); fitHero();
  // legend in the layer panel
  const ramp = depth ? DEPTH_RAMP : SNOW_RAMP;
  const grad = ramp.filter(r => r[1]).map(r => r[1]).join(',');
  const ticks = depth ? ['1', '10', '25', '50', '100', '200+ cm'] : ['1', '10', '20', '35', '60+ cm'];
  let note = '';
  if (depth && S.pack) {
    const f = S.pack.fit; const n = new Set(f.stations.map(s => s.station)).size;
    note = fr() ? `Modèle calé sur ${n} station${n > 1 ? 's' : ''} Météo-France${f.rmse !== null ? ` · écart ±${fmt(f.rmse, 0)} cm` : ''}`
      : `Model anchored on ${n} Météo-France station${n > 1 ? 's' : ''}${f.rmse !== null ? ` · error ±${fmt(f.rmse, 0)} cm` : ''}`;
  }
  leg.innerHTML = (depth ? `<div class="legend" style="margin:6px 8px 0"><span class="k"><span class="sq" style="background:${BARE_COLOR}"></span>${fr() ? 'Sans neige' : 'No snow'}</span><span class="k"><span class="sw" style="background:#bfefff"></span>${fr() ? 'Limite de l’enneigement' : 'Edge of the snow'}</span></div>` : '')
    + (depth ? `<div class="swatch-ramp" style="background:linear-gradient(90deg,${grad})"></div><div class="ramp-labels">${ticks.map(x => `<span>${x}</span>`).join('')}</div>`
      : `<div class="snow-classes">${SNOW_CLASSES.map(([lo, c], i) => `<span><i style="background:${c}"></i>${i < SNOW_CLASSES.length - 1 ? lo : `${lo}+`}</span>`).join('')}<em>cm</em></div>`)
    + `${note ? `<div class="ramp-labels" style="margin:6px 8px 4px;display:block;line-height:1.35">${note}</div>` : ''}`;
}
// Paint the selected day on the map and in the read-out
// Keep the map above the docked day strip, and the hero within the first screen under the bulletin
function fitHero() {
  const hero = $('now'), tl = $('timeline'), b = $('bulletin');
  if (tl) hero.style.setProperty('--tlh', `${tl.offsetHeight}px`);
  document.documentElement.style.setProperty('--bh', `${b && !b.hidden ? b.offsetHeight : 0}px`);
}
window.addEventListener('resize', () => requestAnimationFrame(fitHero));
function paintDay() {
  const depth = S.snowMode === 'depth'; const w = S.days[S.day];
  document.querySelectorAll('#tl-control .day').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.d === S.day)));
  const sel = document.querySelector(`#tl-control .day[data-d="${S.day}"]`); if (sel) sel.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const prof = depth ? depthProfile(S.day) : freshProfile(S.day, S.cumul);
  if (depth) S.map.setSnowDepth(prof, S.pack.grid(S.day)); else S.map.setFreshSnow(prof);
  const hi = fmt(atZ(prof, TZ), 0), lo = fmt(atZ(prof, BZ), 0);
  const aT = `${fr() ? 'à' : 'at'} ${zm(TZ)}`, aB = `${fr() ? 'à' : 'at'} ${zm(BZ)}`;
  const when = w.d === 0 ? (depth ? (fr() ? 'Maintenant' : 'Now') : (fr() ? 'Reste de la journée' : 'Rest of today')) : dayName(w, false);
  let txt;
  if (depth) {
    const south = S.pack.depthAt(S.day, TZ, 30, 180), north = S.pack.depthAt(S.day, TZ, 30, 0);
    txt = `${when}${w.d ? (fr() ? ', 9 h' : ', 9 am') : ''} · <b>${hi} cm</b> ${aT} <span style="color:var(--ink-2)">(${fr() ? 'adret' : 'south-facing'} ${fmt(south, 0)}, ${fr() ? 'ubac' : 'north-facing'} ${fmt(north, 0)})</span> · ${lo} cm ${aB}`;
  }
  else if (S.cumul) txt = `${fr() ? "D'ici" : 'Until'} ${w.d === 0 ? (fr() ? 'ce soir' : 'tonight') : dayName(w, false)} · <b>${hi} cm</b> ${aT} · ${lo} cm ${aB}`;
  else {
    const wet = S.cons[BZ].filter(x => x.n && x.time > w.from && x.time <= w.end && (x.p || 0) > 0.2 && x.line !== null);
    const sp = wet.reduce((a, x) => a + x.p, 0); const line = sp ? wet.reduce((a, x) => a + x.p * x.line, 0) / sp : null;
    txt = `${when} · <b>${hi} cm</b> ${aT} · ${lo} cm ${aB}${line !== null ? ` · ${fr() ? 'limite' : 'line'} ≈ ${fmt(Math.round(line / 100) * 100)} m` : ''}`;
  }
  if (w.d >= TREND_FROM) txt += fr() ? ' · <span style="color:var(--ink-3)">tendance</span>' : ' · <span style="color:var(--ink-3)">trend</span>';
  $('tl-value').innerHTML = txt;
}

// ---------- main ----------
async function renderAll() {
  if (S.fc) { renderNow(); renderKpis48(); render48(); renderModels(); initSatToggle(); syncMap(); renderBulletin(); }
  if (S.ensStats) render15();
  renderSeason(); renderCams(); renderArchive(); renderMethods(); renderResort();
}

// Resort identity in the header; the switch keeps the section the reader is looking at
function initSite() {
  $('brand-name').textContent = SITE.name; $('brand').setAttribute('aria-label', SITE.name);
  const sel = $('site-switch'); if (!sel) return;
  sel.value = SITE.id;
  sel.addEventListener('change', () => { location.href = './' + (sel.value === 'corbier' ? '' : `?site=${sel.value}`) + location.hash; });
}

async function main() {
  initSite();
  initLang();
  ['chart-48', 'chart-alt', 'chart-d15-daily', 'chart-d15-temp', 'chart-d15-cum', 'chart-cmp', 'chart-weekly', 'chart-monthly', 'chart-arch-cum', 'chart-arch-depth', 'chart-arch-totals', 'chart-stripes'].forEach(id => C.observe($(id)));
  initMap();
  renderCams(); renderMethods();
  D.fetchBaked('bulletin.json').then(b => { S.ai = b; renderBulletin(); });
  D.fetchBaked('resort.json').then(r => { S.resort = r; renderResort(); });
  const [verif, climate, cal] = await Promise.all([D.fetchBaked('verification.json'), D.fetchBaked('climate.json'), D.fetchBaked('snowcal.json')]);
  // snowpack constants fitted over past winters (scripts/calibrate-snowpack.mjs), used only if they beat the defaults
  S.cal = cal; if (cal && cal.used && cal.params) SP.setParams(cal.params); renderMethods();
  S.verif = verif; S.climate = climate; S.calib = D.makeCalibration(verif);
  renderArchive();
  const obsP = D.fetchObs('73242003', 168).then(o => { S.obs = o; if (S.fc) { renderNow(); render48(); } if (S.ensStats) render15(); }).catch(e => console.warn('obs', e));
  D.fetchObs('73318400', 8).then(o => { S.obsC = o; if (S.fc) renderNow(); }).catch(e => console.warn('obs Le Corbier', e));
  // history for the snowpack model, fetched in parallel with the forecast
  const start = SP.seasonStart(S.now);
  const histP = D.fetchHistory(start, S.now), snowP = D.fetchSnowObs(start, S.now);
  try {
    S.fc = D.applyCalibration(await D.fetchModels(), S.calib, S.now);
    computeConsensus(); computeBands();
    renderNow(); renderKpis48(); render48(); renderModels(); renderBulletin();
    Promise.allSettled([histP, snowP, obsP]).then(([h, s]) => {
      if (h.status === 'fulfilled') runPack(h.value, s.status === 'fulfilled' ? s.value : []);
      else console.warn('history', h.reason);
      S.packTried = true; syncMap(); renderNow(); renderBulletin();
    });
    syncMap();
  } catch (e) {
    console.error(e);
    ['chart-48', 'chart-alt', 'chart-cmp'].forEach(id => $(id).innerHTML = `<div class="error">${t('misc.error')}</div>`);
  }
  render15();
  renderSeason();
  // nav highlight
  const links = [...document.querySelectorAll('.nav a')];
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) links.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id)); }), { rootMargin: '-40% 0px -55% 0px' });
  ['now', 'h48', 'd15', 'models', 'season', 'cams', 'archive'].forEach(id => io.observe($(id)));
  // keep a page left open current: everything live is fetched again every 30 minutes while it is visible
  setInterval(() => { if (!document.hidden && Date.now() - S.now > REFRESH) refresh(); }, 60e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - S.now > REFRESH) refresh(); });
}

const REFRESH = 30 * 60e3;
let refreshing = false;
async function refresh() {
  if (refreshing) return; refreshing = true;
  try {
    const now = Date.now(); const start = SP.seasonStart(now);
    const histP = D.fetchHistory(start, now), snowP = D.fetchSnowObs(start, now);
    const [fc, obs, obsC, ai] = await Promise.all([D.fetchModels(), D.fetchObs('73242003', 168).catch(() => S.obs), D.fetchObs('73318400', 8).catch(() => S.obsC), D.fetchBaked('bulletin.json')]);
    S.now = now; S.obs = obs; S.obsC = obsC; if (ai) S.ai = ai;
    D.fetchBaked('resort.json').then(r => { if (r) { S.resort = r; renderResort(); } });
    S.fc = D.applyCalibration(fc, S.calib, S.now);
    computeConsensus(); computeBands();
    const [h, s] = await Promise.allSettled([histP, snowP]);
    if (h.status === 'fulfilled') runPack(h.value, s.status === 'fulfilled' ? s.value : []);
    S.ens = null;
    renderAll(); render15();
  } catch (e) { console.warn('refresh', e); S.now = Date.now() - REFRESH + 5 * 60e3; } // retry in 5 minutes
  finally { refreshing = false; }
}

main();
