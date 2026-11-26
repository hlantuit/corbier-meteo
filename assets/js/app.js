// Orchestration: fetch everything, compute, and render.
import { SITE, MODELS, COLORS } from './config.js';
import { t, fmt, getLang, setLang, applyStatic } from './i18n.js';
import * as D from './data.js';
import * as C from './charts.js';
import { createMap } from './map.js';

const HOUR = 3600e3;
const $ = id => document.getElementById(id);
const S = { now: Date.now(), verif: null, climate: null, fc: null, calib: null, cons: {}, ens: null, ensStats: null, sub: null, seas: null, c3s: null, obs: null, map: null, horizon: 48, lineHour: 0, snowMode: 'fresh' };
const fr = () => getLang() === 'fr';

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
  for (const z of [1300, 1550, 1900, 2265, 2426]) S.cons[z] = D.consensus(S.fc, z, w, S.now);
}
function totalsBetween(z, t0, t1) {
  const cons = S.cons[z] || D.consensus(S.fc, z, (id, L, k) => S.calib.weight(id, L, k), S.now);
  let cm = 0, mm = 0; cons.forEach(d => { if (d.time > t0 && d.time <= t1 && d.n) { cm += d.cm || 0; mm += d.rain || 0; } });
  return { cm, mm };
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
  const c = S.cons[1550]; const fut = c.filter(d => d.time > S.now && d.time < S.now + 7 * 24 * HOUR && d.n);
  let start = -1; for (let i = 0; i < fut.length; i++) { const w = fut.slice(i, i + 6).reduce((a, d) => a + (d.cm || 0), 0); if (w >= 2) { start = i; break; } }
  if (start < 0) return null;
  let end = start, dry = 0; for (let i = start; i < fut.length; i++) { if ((fut[i].cm || 0) > 0.2) { end = i; dry = 0; } else if (++dry > 12) break; }
  const ev = fut.slice(start, end + 1);
  const at2265 = S.cons[2265].filter(d => d.time >= ev[0].time && d.time <= ev[ev.length - 1].time).reduce((a, d) => a + (d.cm || 0), 0);
  return { t0: ev[0].time, t1: ev[ev.length - 1].time, cm: ev.reduce((a, d) => a + (d.cm || 0), 0), cmHigh: at2265 };
}

// ---------- renderers ----------
function renderNow() {
  const c = S.cons[1550]; if (!c) return;
  const i = c.findIndex(d => d.time >= S.now - HOUR / 2); const d = c[Math.max(0, i)];
  const sum = S.cons[2265][Math.max(0, i)];
  // condition from the best km-scale model available now
  const pick = ['meteofrance_arome_france_hd', 'meteoswiss_icon_seamless', 'icon_d2'].map(id => S.fc.series[id]).find(s => s && s.weather_code && s.weather_code[i] !== null);
  const code = pick ? pick.weather_code[i] : null;
  $('now-temp').innerHTML = `${fmt(d.t, 0)}<sup>°C</sup>`;
  $('now-cond').textContent = code !== null ? (WMO[getLang()][code] || '') : '';
  $('now-where').textContent = fr() ? 'Le Corbier, 1 550 m · prévision corrigée' : 'Le Corbier, 1,550 m · bias-corrected forecast';
  const lastObs = S.obs ? [...S.obs].reverse().find(o => o.hs !== null && o.hs !== undefined) : null;
  $('now-hs').innerHTML = lastObs ? `${fmt(lastObs.hs, 0)}<small>cm</small>` : '–';
  $('now-hs-hint').textContent = lastObs ? `St-Jean-d'Arves · ${ago(lastObs.time)}` : '';
  $('now-line').innerHTML = d.line !== null ? `${fmt(Math.round(d.line / 50) * 50)}<small>m</small>` : '–';
  $('now-line-hint').textContent = d.lineMin !== null ? `${fmt(Math.round(d.lineMin / 50) * 50)} – ${fmt(Math.round(d.lineMax / 50) * 50)} m` : '';
  $('now-wind').innerHTML = d.wind !== null ? `${fmt(d.wind, 0)}<small>km/h</small>` : '–';
  $('now-wind-hint').textContent = d.dir !== null ? `${dirName(d.dir)} · ${fr() ? 'rafales' : 'gusts'} ${fmt(d.gust, 0)} km/h` : '';
  $('now-summit').innerHTML = sum ? `${fmt(sum.t, 0)}<small>°C</small>` : '–';
  $('now-summit-hint').textContent = sum ? `${fr() ? 'neige' : 'snow'} 48 h : ${fmt(totalsBetween(2265, S.now, S.now + 48 * HOUR).cm, 0)} cm` : '';
  const lastT = S.obs ? [...S.obs].reverse().find(o => o.t !== null && o.t !== undefined) : null;
  $('now-foot').textContent = lastT ? `${t('now.observed')} : ${fmt(lastT.t, 1)} °C ${fr() ? 'à' : 'at'} St-Jean-d'Arves (${ago(lastT.time)}). ${fr() ? 'Modèles : ' : 'Models: '}${Object.keys(S.fc.series).length}.` : '';
  const ev = nextSnowEvent(); const box = $('next-snow');
  box.hidden = false;
  if (ev) {
    $('next-snow-t1').textContent = `${t('now.next')} : ${dayTime(ev.t0)}`;
    $('next-snow-t2').textContent = fr() ? `≈ ${fmt(ev.cm, 0)} cm à 1 550 m · ${fmt(ev.cmHigh, 0)} cm à 2 265 m` : `≈ ${fmt(ev.cm, 0)} cm at 1,550 m · ${fmt(ev.cmHigh, 0)} cm at 2,265 m`;
  } else { $('next-snow-t1').textContent = t('now.next'); $('next-snow-t2').textContent = t('now.none7d'); }
}

function renderKpis48() {
  const a = totalsBetween(1550, S.now, S.now + 24 * HOUR), b = totalsBetween(1550, S.now, S.now + 48 * HOUR), c = totalsBetween(2265, S.now, S.now + 48 * HOUR);
  const fut = S.cons[1550].filter(d => d.time > S.now && d.time <= S.now + 48 * HOUR && d.n);
  const lines = fut.map(d => d.line).filter(v => v !== null);
  const gust = Math.max(...fut.map(d => d.gust || 0));
  const k = (label, value, unit, hint) => `<div class="kpi"><div class="label">${label}</div><div class="value num">${value}<small>${unit}</small></div><div class="hint">${hint}</div></div>`;
  $('kpis-48').innerHTML =
    k(fr() ? 'Neige fraîche 24 h · 1 550 m' : 'Fresh snow 24 h · 1,550 m', fmt(a.cm, 0), 'cm', `${fmt(a.mm, 0)} mm ${fr() ? 'de pluie' : 'of rain'}`) +
    k(fr() ? 'Neige fraîche 48 h · 1 550 m' : 'Fresh snow 48 h · 1,550 m', fmt(b.cm, 0), 'cm', `${fmt(b.mm, 0)} mm ${fr() ? 'de pluie' : 'of rain'}`) +
    k(fr() ? 'Neige fraîche 48 h · 2 265 m' : 'Fresh snow 48 h · 2,265 m', fmt(c.cm, 0), 'cm', 'Pointe du Corbier') +
    k(fr() ? 'Limite pluie-neige 48 h' : 'Rain–snow line 48 h', lines.length ? `${fmt(Math.round(Math.min(...lines) / 50) * 50)}–${fmt(Math.round(Math.max(...lines) / 50) * 50)}` : '–', 'm', `${fr() ? 'Rafales max' : 'Max gusts'} ${fmt(gust, 0)} km/h`);
}

function render48() {
  $('h48-sub').textContent = fr() ? `Consensus pondéré et corrigé, ${Object.keys(S.fc.series).length} modèles. Zone grisée : écart entre modèles. Bandes sombres : nuit.` : `Weighted, bias-corrected consensus of ${Object.keys(S.fc.series).length} models. Shaded: model spread. Dark bands: night.`;
  C.legend('leg-48', [{ color: COLORS.consensus, label: '1 550 m' }, { color: '#9dc8f7', label: '2 265 m' }, { color: '#2370cd', label: '1 300 m' }, { color: COLORS.snow, label: t('leg.snow'), shape: 'sq' }, { color: COLORS.rain, label: t('leg.rain'), shape: 'sq' }]);
  C.meteogram('chart-48', { c1550: S.cons[1550], c2265: S.cons[2265], c1300: S.cons[1300], now: S.now });
  renderAltitude();
}

function renderAltitude() {
  const seg = $('alt-horizon');
  const hs = [24, 48, 72, 168];
  seg.innerHTML = hs.map(h => `<button type="button" data-h="${h}" aria-pressed="${h === S.horizon}">${h === 168 ? (fr() ? '7 j' : '7 d') : h + ' h'}</button>`).join('');
  seg.querySelectorAll('button').forEach(b => b.onclick = () => { S.horizon = +b.dataset.h; renderAltitude(); syncMapHorizon(); });
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
    S.ensStats = D.ensembleStats(S.ens, 1550, bias);
    const st = S.ensStats;
    const k = (label, value, unit, hint) => `<div class="kpi"><div class="label">${label}</div><div class="value num">${value}<small>${unit}</small></div><div class="hint">${hint}</div></div>`;
    const p10 = st.prob(7, 10), p30 = st.prob(15, 30); const last = st.cq[st.cq.length - 1];
    const q7 = st.cq[Math.min(6, st.cq.length - 1)];
    $('kpis-15').innerHTML =
      k(fr() ? '≥ 10 cm en 7 jours' : '≥ 10 cm within 7 days', fmt(p10 * 100, 0), '%', fr() ? 'part des 51 scénarios' : 'share of the 51 scenarios') +
      k(fr() ? '≥ 30 cm en 15 jours' : '≥ 30 cm within 15 days', fmt(p30 * 100, 0), '%', fr() ? 'part des 51 scénarios' : 'share of the 51 scenarios') +
      k(fr() ? 'Cumul médian 7 jours' : 'Median total, 7 days', fmt(q7 ? q7.p50 : null, 0), 'cm', q7 ? `${fmt(q7.p10, 0)} – ${fmt(q7.p90, 0)} cm (10–90 %)` : '') +
      k(fr() ? 'Cumul médian 15 jours' : 'Median total, 15 days', fmt(last ? last.p50 : null, 0), 'cm', last ? `${fmt(last.p10, 0)} – ${fmt(last.p90, 0)} cm (10–90 %)` : '');
    $('d15-daily-sub').textContent = fr() ? 'Boîte : 25–75 % des scénarios · trait : 10–90 % · ligne blanche : médiane · en haut : probabilité d’au moins 1 cm.' : 'Box: 25–75 % of scenarios · whisker: 10–90 % · white line: median · on top: chance of at least 1 cm.';
    $('d15-temp-sub').textContent = fr() ? 'Corrigée du biais local de l’IFS. Fines lignes : chaque scénario ; bande : 10–90 %.' : 'Corrected for IFS’s local bias. Thin lines: each scenario; band: 10–90 %.';
    $('d15-cum-sub').textContent = fr() ? 'Éventail des 51 scénarios.' : 'Fan of the 51 scenarios.';
    C.legend('leg-d15-temp', [{ color: COLORS.consensus, label: t('leg.median') }, { color: 'rgba(127,212,255,.45)', label: t('leg.p1090'), shape: 'sq' }]);
    C.legend('leg-d15-cum', [{ color: COLORS.snow, label: t('leg.median') }, { color: 'rgba(127,212,255,.5)', label: t('leg.p2575'), shape: 'sq' }, { color: 'rgba(127,212,255,.25)', label: t('leg.p1090'), shape: 'sq' }]);
    C.ensembleDaily('chart-d15-daily', st, S.now);
    C.ensembleTemp('chart-d15-temp', S.ens, st);
    C.ensembleCum('chart-d15-cum', st);
  } catch (e) { console.error(e); ['chart-d15-daily', 'chart-d15-temp', 'chart-d15-cum'].forEach(id => $(id).innerHTML = `<div class="error">${t('misc.error')}</div>`); }
}

// ---------- models section ----------
let verifMetric = 'snow', cmpVar = 'snow';
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
    snow: fr() ? 'Score ETS (0 = hasard, 1 = parfait) pour les jours avec ≥ 5 cm de neige fraîche, observés par la hausse de la hauteur de neige à la station.' : 'ETS (0 = chance, 1 = perfect) for days with ≥ 5 cm of fresh snow, observed as the rise in snow depth at the station.',
    precip: fr() ? 'Score ETS pour les jours avec ≥ 1 mm de précipitations (06–06 UTC).' : 'ETS for days with ≥ 1 mm of precipitation (06–06 UTC).',
    temp: fr() ? 'Erreur absolue moyenne horaire (°C) après correction du biais propre à chaque modèle, heure par heure.' : 'Mean absolute hourly error (°C) after removing each model’s own bias, hour by hour.',
    tempraw: fr() ? 'Erreur absolue moyenne horaire (°C) des sorties brutes, avant correction.' : 'Mean absolute hourly error (°C) of the raw output, before correction.',
  };
  $('verif-note').textContent = notes[verifMetric] + (fr() ? ` Station Météo-France de Saint-Jean-d'Arves (1 573 m). Mise à jour : ${new Date(v.generated).toLocaleDateString('fr-FR')}.` : ` Météo-France station at Saint-Jean-d'Arves (1,573 m). Updated ${new Date(v.generated).toLocaleDateString('en-GB')}.`);
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
  const z = 1550;
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
  const cons = idx.map(([tt, i]) => { const d = S.cons[1550][i]; if (!d || !d.n) return { time: tt, v: null };
    if (cmpVar === 'temp') return { time: tt, v: d.t }; if (cmpVar === 'snowline') return { time: tt, v: d.line };
    if (tt <= t0) return { time: tt, v: 0 }; acc += cmpVar === 'snow' ? (d.cm || 0) : (d.p || 0); return { time: tt, v: acc }; });
  const opts = { snow: { unit: 'cm', zeroBased: true, endLabels: true, digits: 0 }, precip: { unit: 'mm', zeroBased: true, endLabels: true, digits: 0 }, temp: { unit: '°C', zeroLine: true, digits: 1 }, snowline: { unit: 'm', digits: 0 } }[cmpVar];
  $('cmp-sub').textContent = fr() ? (cmpVar === 'snow' || cmpVar === 'precip' ? 'Cumul à 1 550 m sur 10 jours, modèle par modèle. Les températures sont corrigées du biais local avant le calcul de la neige.' : 'À 1 550 m, modèle par modèle, températures corrigées du biais local.') : (cmpVar === 'snow' || cmpVar === 'precip' ? 'Running total at 1,550 m over 10 days, model by model. Temperatures are bias-corrected before snow is computed.' : 'At 1,550 m, model by model, bias-corrected temperatures.');
  C.legend('leg-cmp', [{ color: COLORS.consensus, label: t('leg.consensus') }, ...MODELS.filter(m => S.fc.series[m.id] && m.color).map(m => ({ color: m.color, label: `${m.short} <span style="color:var(--ink-3)">${m.res}</span>` })), { color: '#6b7d97', label: fr() ? 'ICON-2I, ICON-EU' : 'ICON-2I, ICON-EU' }]);
  C.comparator('chart-cmp', series, cons, opts);
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
function renderCams() {
  const cams = [
    { t: fr() ? 'Le Corbier en direct' : 'Le Corbier live', s: '1 550 m', u: 'https://www.skaping.com/le-corbier/live/' },
    { t: fr() ? 'Front de neige' : 'Snow front', s: '1 550 m', u: 'https://www.skaping.com/le-corbier/front-de-neige' },
    { t: 'Pointe du Corbier', s: fr() ? '2 265 m · vue sur les Aiguilles d’Arves' : '2,265 m · view of the Aiguilles d’Arves', u: 'https://www.skaping.com/les-sybelles/pointe-du-corbier' },
    { t: "L'Ouillon", s: fr() ? 'Sommet des Sybelles' : 'Top of Les Sybelles', u: 'https://www.skaping.com/les-sybelles/ouillon' },
  ];
  const ridge = (k) => `<svg class="art" viewBox="0 0 400 250" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="cg${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2c4a"/><stop offset="1" stop-color="#0a1120"/></linearGradient></defs><rect width="400" height="250" fill="url(#cg${k})"/><path d="M0 ${190 - k * 6} L${60 + k * 10} ${120 - k * 8} L${120 + k * 6} ${160} L${200 - k * 4} ${80 + k * 6} L${270} ${150 - k * 4} L${330 + k * 6} ${100 + k * 5} L400 ${140} V250 H0Z" fill="#dff3ff" opacity=".14"/><path d="M0 ${220} L${90} ${170 - k * 3} L${170} ${205} L${260 + k * 8} ${150} L400 ${200} V250 H0Z" fill="#dff3ff" opacity=".22"/></svg>`;
  $('cam-grid').innerHTML = cams.map((c, k) => `<a class="cam" href="${c.u}" target="_blank" rel="noopener">${ridge(k)}<span class="go">LIVE ↗</span><div class="meta"><div class="t">${c.t}</div><div class="s">${c.s}</div></div></a>`).join('');
}

// ---------- archive ----------
function renderArchive() {
  const c = S.climate; if (!c) { ['chart-arch-cum', 'chart-arch-depth', 'chart-arch-totals'].forEach(id => $(id).innerHTML = `<div class="error">${t('misc.error')}</div>`); return; }
  const full = c.winters.filter(w => !w.partial);
  $('archive-over').textContent = `${full[0].year - 1} → ${new Date().getFullYear()}`;
  const ci = c.current.length - 1;
  const lastDay = new Intl.DateTimeFormat(fr() ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(c.currentWinter - 1, 10, 1) + ci * 864e5));
  $('arch-cum-sub').textContent = fr() ? `Réanalyse ERA5 à 1 550 m, jusqu’au ${lastDay}. Bandes : 10–90 % et 25–75 % des hivers 1991–2020.` : `ERA5 reanalysis at 1,550 m, up to ${lastDay}. Bands: 10–90 % and 25–75 % of the 1991–2020 winters.`;
  C.legend('leg-arch-cum', [{ color: COLORS.snow, label: t('leg.thisSeason') }, { color: '#9887ef', label: c.lastLabel }, { color: COLORS.ink2, label: t('leg.normal') }]);
  C.archiveCum('chart-arch-cum', c);
  if (c.station) {
    $('arch-depth-sub').textContent = fr() ? 'Maximum journalier de la hauteur de neige, station Météo-France, 1 573 m.' : 'Daily maximum snow depth, Météo-France station, 1,573 m.';
    C.legend('leg-arch-depth', c.station.seasons.slice().reverse().map((s, k) => ({ color: s.current ? COLORS.snow : ['#9887ef', '#00a888', '#e24d8b', '#d28e05'][c.station.seasons.length - 1 - k] || '#9887ef', label: s.label })));
    C.archiveDepth('chart-arch-depth', c.station.seasons);
  }
  const mean = full.reduce((a, w) => a + w.snow, 0) / full.length;
  $('arch-tot-sub').textContent = fr() ? `Neige tombée entre novembre et avril à 1 550 m selon ERA5 (moyenne ${fmt(mean, 0)} cm). La réanalyse à 25–30 km lisse le relief : à lire en tendance, pas en valeur absolue.` : `Snowfall between November and April at 1,550 m according to ERA5 (mean ${fmt(mean, 0)} cm). At 25–30 km the reanalysis smooths the terrain: read the trend, not the absolute value.`;
  C.legend('leg-arch-tot', [{ color: '#338ced', label: fr() ? 'Hiver complet' : 'Full winter', shape: 'sq' }, { color: COLORS.warm, label: fr() ? 'Tendance linéaire' : 'Linear trend' }]);
  C.archiveTotals('chart-arch-totals', c);
  const ref = full.filter(w => w.year >= 1971 && w.year <= 2000); const rec = full.slice(-10);
  const m = a => a.reduce((s, w) => s + w.tdjf, 0) / a.length;
  $('arch-stripes-sub').textContent = fr() ? `Température moyenne de décembre à février, écart à 1971–2000. Les dix derniers hivers sont ${fmt(m(rec) - m(ref), 1)} °C plus doux.` : `Mean December–February temperature, departure from 1971–2000. The last ten winters are ${fmt(m(rec) - m(ref), 1)} °C milder.`;
  C.winterStripes('chart-stripes', c);
}

// ---------- methods ----------
function renderMethods() {
  $('methods').innerHTML = fr() ? `
    <p><b>Prévision.</b> Douze modèles (AROME HD, ICON-CH1/CH2, ICON-D2, ICON-2I, ICON-EU, ARPEGE, IFS, AIFS, UKMO, GFS…) sont lus en direct via Open-Meteo pour le front de neige du Corbier. Chacun est d’abord corrigé de son biais de température propre, heure par heure et échéance par échéance, puis pondéré selon son score local : 1/erreur² pour la température, ETS² pour les précipitations.</p>
    <p><b>Neige.</b> La part de neige dans les précipitations se déduit de la limite pluie-neige du modèle quand il la fournit, sinon de son isotherme 0 °C, sinon de la température humide. La hauteur de neige fraîche utilise une densité qui dépend de la température (Hedstrom &amp; Pomeroy, 1998). On ne suppose pas de gradient de précipitations avec l’altitude.</p>
    <p><b>Vérification.</b> Les prévisions passées (archives Open-Meteo, échéances J0 à J+7) sont comparées chaque semaine aux mesures horaires Météo-France de Saint-Jean-d’Arves (1 573 m), de novembre à avril. Les jours de neige sont repérés par la hausse de la hauteur de neige. Une seule station et deux hivers : les classements restent indicatifs.</p>
    <p><b>Carte.</b> Le relief est le RGE ALTI de l’IGN, décodé dans le navigateur. Les couleurs de neige prévue suivent l’altitude, à partir du même calcul. Les bâtiments et remontées viennent de la BD TOPO, les pistes d’OpenStreetMap.</p>` : `
    <p><b>Forecast.</b> Twelve models (AROME HD, ICON-CH1/CH2, ICON-D2, ICON-2I, ICON-EU, ARPEGE, IFS, AIFS, UKMO, GFS…) are read live through Open-Meteo for the Le Corbier snow front. Each one first has its own temperature bias removed, hour by hour and lead time by lead time. Each is then weighted by its local score: 1/error² for temperature, ETS² for precipitation.</p>
    <p><b>Snow.</b> The snow share of precipitation comes from the model’s rain–snow line when it provides one, otherwise from its freezing level, otherwise from wet-bulb temperature. Fresh snow depth uses a temperature-dependent density (Hedstrom &amp; Pomeroy, 1998). No precipitation gradient with elevation is assumed.</p>
    <p><b>Verification.</b> Past forecasts (Open-Meteo archive, lead days 0 to 7) are compared every week with Météo-France hourly measurements at Saint-Jean-d’Arves (1,573 m), November to April. Snow days are detected from rises in snow depth. One station and two winters: rankings are indicative.</p>
    <p><b>Map.</b> The terrain is IGN’s RGE ALTI, decoded in the browser. Forecast snow colours follow elevation, using the same calculation. Buildings and lifts come from BD TOPO, pistes from OpenStreetMap.</p>`;
  $('build-info').textContent = fr() ? `Page générée dans votre navigateur le ${new Date(S.now).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}.` : `Page generated in your browser on ${new Date(S.now).toLocaleString('en-GB', { timeZone: 'Europe/Paris' })}.`;
}

// ---------- map wiring ----------
function initMap() {
  try {
    S.map = createMap('map', { onReady: () => { S.mapReady = true; syncMap(); } });
  } catch (e) { console.error(e); $('map-loading').textContent = t('misc.error'); return; }
  document.querySelectorAll('input[name="snowlayer"]').forEach(r => r.addEventListener('change', () => {
    S.snowMode = r.value; document.querySelectorAll('input[name="snowlayer"]').forEach(x => x.closest('.toggle').classList.toggle('on', x.checked)); syncMap();
  }));
  [['lyr-buildings', 'buildings'], ['lyr-lifts', 'lifts'], ['lyr-pistes', 'pistes'], ['lyr-lidar', 'lidar']].forEach(([id, l]) => $(id).addEventListener('change', e => { S.map && S.map.setVisible(l, e.target.checked); e.target.closest('.toggle').classList.toggle('on', e.target.checked); }));
  $('btn-3d').addEventListener('click', e => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); S.map.set3D(on); if (!on) { $('btn-orbit').setAttribute('aria-pressed', 'false'); S.map.orbit(false); } });
  $('btn-orbit').addEventListener('click', e => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on));
    if (on && $('btn-3d').getAttribute('aria-pressed') !== 'true') { $('btn-3d').setAttribute('aria-pressed', 'true'); S.map.set3D(true); setTimeout(() => S.map.orbit(true), 1800); } else S.map.orbit(on);
  });
}
function syncMapHorizon() { if (S.snowMode === 'fresh') syncMap(); }
function syncMap() {
  if (!S.map || !S.mapReady || !S.fc) return;
  const ctl = $('tl-control'), lab = $('tl-label'), val = $('tl-value'), leg = $('layer-legend');
  $('timeline').hidden = S.snowMode === 'now';
  if (S.snowMode === 'fresh') {
    lab.textContent = t('map.horizon');
    const hs = [24, 48, 72, 168];
    ctl.innerHTML = `<div class="chips">${hs.map(h => `<button class="chip" type="button" data-h="${h}" aria-pressed="${h === S.horizon}">${h === 168 ? (fr() ? '7 jours' : '7 days') : h + ' h'}</button>`).join('')}</div>`;
    ctl.querySelectorAll('.chip').forEach(b => b.onclick = () => { S.horizon = +b.dataset.h; syncMap(); renderAltitude(); });
    const prof = snowProfile(S.horizon); S.map.setFreshSnow(prof);
    const at = z => { const p = prof.find(x => x[0] >= z); return p ? p[1] : 0; };
    val.textContent = `${fmt(at(1550), 0)} cm · 1 550 m`;
    leg.innerHTML = `<div class="swatch-ramp" style="background:linear-gradient(90deg,#1d3a5f,#2370cd,#519ced,#84b9f3,#b6d5f8,#dff3ff,#fff)"></div><div class="ramp-labels"><span>1</span><span>10</span><span>20</span><span>35</span><span>60+ cm</span></div>`;
  } else if (S.snowMode === 'line') {
    lab.textContent = t('map.hour');
    const max = 72; ctl.innerHTML = `<input type="range" min="0" max="${max}" step="1" value="${S.lineHour}" aria-label="${t('map.hour')}">`;
    const input = ctl.querySelector('input');
    const apply = () => {
      S.lineHour = +input.value; input.style.setProperty('--p', `${(S.lineHour / max) * 100}%`);
      const target = S.now + S.lineHour * HOUR; const c = S.cons[1550]; const d = c.reduce((a, x) => (Math.abs(x.time - target) < Math.abs(a.time - target) ? x : a), c[0]);
      S.map.setSnowLine(d.line);
      val.textContent = `${new Intl.DateTimeFormat(fr() ? 'fr-FR' : 'en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(d.time))} · ${d.line !== null ? fmt(Math.round(d.line / 50) * 50) + ' m' : '–'}`;
    };
    input.addEventListener('input', apply); apply();
    leg.innerHTML = `<div class="legend" style="margin:4px 8px"><span class="k"><span class="sq" style="background:#dff3ff"></span>${t('leg.snow')}</span><span class="k"><span class="sq" style="background:#ffd27a"></span>${fr() ? 'Limite' : 'Line'}</span><span class="k"><span class="sq" style="background:#1b4f8f"></span>${t('leg.rain')}</span></div>`;
  } else {
    S.map.setSatelliteSnow();
    const s2 = S.map.s2;
    if (s2) {
      const d = new Intl.DateTimeFormat(fr() ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long' }).format(new Date(s2.date));
      leg.innerHTML = `<div class="legend" style="margin:4px 8px"><span class="k"><span class="sq" style="background:#ebf6ff"></span>${t('leg.snow')}</span><span class="k"><span class="sq" style="background:#78849a"></span>${fr() ? 'Nuages' : 'Clouds'}</span></div><div class="ramp-labels" style="margin:2px 8px 6px">Sentinel-2 · ${d} · ${fmt(s2.snow_fraction * 100, 0)} % ${fr() ? 'enneigé' : 'snow-covered'}</div>`;
    } else leg.innerHTML = `<div class="ramp-labels" style="margin:2px 8px 6px">${t('map.snowNowNote')}</div>`;
  }
}

// ---------- main ----------
async function renderAll() {
  if (S.fc) { renderNow(); renderKpis48(); render48(); renderModels(); syncMap(); }
  if (S.ensStats) render15();
  renderSeason(); renderCams(); renderArchive(); renderMethods();
}

async function main() {
  initLang();
  ['chart-48', 'chart-alt', 'chart-d15-daily', 'chart-d15-temp', 'chart-d15-cum', 'chart-cmp', 'chart-weekly', 'chart-monthly', 'chart-arch-cum', 'chart-arch-depth', 'chart-arch-totals', 'chart-stripes'].forEach(id => C.observe($(id)));
  initMap();
  renderCams(); renderMethods();
  const [verif, climate] = await Promise.all([D.fetchBaked('verification.json'), D.fetchBaked('climate.json')]);
  S.verif = verif; S.climate = climate; S.calib = D.makeCalibration(verif);
  renderArchive();
  D.fetchObs('73242003', 96).then(o => { S.obs = o; if (S.fc) renderNow(); }).catch(e => console.warn('obs', e));
  try {
    S.fc = D.applyCalibration(await D.fetchModels(), S.calib, S.now);
    computeConsensus();
    renderNow(); renderKpis48(); render48(); renderModels(); syncMap();
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
}

main();
