// Weekly: score every model against Météo-France observations and write data/verification.json
// (temperature bias by lead/hour, scores, consensus weights). Same method as the first bootstrap.
import { createRequire } from 'node:module';
import { getJSON, sleep, log, writeJSON, fetchStationHourly } from './common.mjs';
const require = createRequire(import.meta.url);
const V = require('./lib/verify-core.js');

const STATION = { id: '73242003', name: "Saint-Jean-d'Arves", elev: 1573, lat: 45.2068, lon: 6.2788 };
const START = '2024-10-01';
const today = new Date(); const end = new Date(today.getTime() - 864e5).toISOString().slice(0, 10);

const obs = await fetchStationHourly(STATION.id, '2024093023');
log('observations:', Object.keys(obs).length, 'hours');

const vars = []; for (const n of V.LEADS) for (const b of ['temperature_2m', 'precipitation']) vars.push(n === 0 ? b : `${b}_previous_day${n}`);
const fc = {};
for (const m of V.VERIFY_MODELS) {
  const url = `https://previous-runs-api.open-meteo.com/v1/forecast?latitude=${STATION.lat}&longitude=${STATION.lon}&elevation=${STATION.elev}&hourly=${vars.join(',')}&models=${m.id}&start_date=${START}&end_date=${end}&timezone=GMT`;
  try { fc[m.id] = V.parsePreviousRuns(await getJSON(url)); log('ok', m.id); }
  catch (e) { log('FAILED', m.id, String(e).slice(0, 120)); }
  await sleep(20000); // stay well below Open-Meteo's per-minute quota
}

const ids = Object.keys(fc); const bias = {}, raw = {}, cor = {}; const corFc = {};
for (const id of ids) { bias[id] = V.temperatureBias(obs, fc[id]); corFc[id] = V.applyBias(fc[id], bias[id]); raw[id] = V.scoreModel(obs, fc[id]); cor[id] = V.scoreModel(obs, corFc[id]); }
const hires = ids.filter(id => /arome|icon_ch|icon_d2|icon_2i/.test(id));
cor.mean_hires = V.scoreModel(obs, V.ensembleMean(hires.map(i => corFc[i])));
cor.mean_all = V.scoreModel(obs, V.ensembleMean(ids.map(i => corFc[i])));
const weights = V.deriveWeights(Object.fromEntries(ids.map(i => [i, cor[i]])));

const r = (x, d = 2) => (x === null || x === undefined ? null : +x.toFixed(d));
const scores = {};
for (const id in cor) {
  scores[id] = {};
  for (const n in cor[id]) {
    const c = cor[id][n]; const w = raw[id] && raw[id][n];
    scores[id][n] = {
      t: c.t ? [r(c.t.mae), w && w.t ? r(w.t.mae) : null, w && w.t ? r(w.t.bias) : null, c.t.n] : null,
      p: c.p ? [r(c.p.ge1.ets), r(c.p.ge10.ets), r(c.p.ratio), r(c.p.mae), c.p.n, c.p.ge10.events] : null,
      s: c.s ? [r(c.s.ets), r(c.s.pod), r(c.s.far), r(c.s.fbias), c.s.events, c.s.n] : null,
    };
  }
}
const models = Object.fromEntries(V.VERIFY_MODELS.map(m => [m.id, [m.label, m.res]]));
models.mean_hires = ['Moyenne km', '—']; models.mean_all = ['Moyenne tous', '—'];
const biasOut = {}; for (const id in bias) { biasOut[id] = {}; for (const n in bias[id]) biasOut[id][n] = bias[id][n].hourly.map(v => r(v, 1)); }
const keys = Object.keys(obs).sort();
if (ids.length < 6) { log('too few models, keeping the previous file'); process.exit(0); }
writeJSON('data/verification.json', {
  generated: new Date().toISOString(), period: [keys[0], keys[keys.length - 1]], station: { id: STATION.id, name: STATION.name, elev: STATION.elev }, season: 'nov-apr',
  legend: { t: ['mae_debiased', 'mae_raw', 'bias_raw', 'n_hours'], p: ['ets_1mm', 'ets_10mm', 'ratio_fc_obs', 'mae_mm', 'n_days', 'events_10mm'], s: ['ets_5cm', 'pod', 'far', 'freq_bias', 'events', 'n_days'] },
  models, scores, bias: biasOut, weights,
});
