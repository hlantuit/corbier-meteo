// AI-written bulletin for the top of the page, refreshed every hour by the GitHub Action.
// It recomputes exactly what the page shows (calibrated multi-model consensus, ECMWF ensemble, snowpack model)
// with the page's own modules, condenses it into a digest, and asks a language model on GitHub Models
// (free with the workflow's GITHUB_TOKEN, permission `models: read`) to phrase it in French and English.
// The rule-based draft from assets/js/bulletin.js is passed along so the model only improves the wording.
import fs from 'node:fs';
import * as D from '../assets/js/data.js';
import * as SP from '../assets/js/snowpack.js';
import * as B from '../assets/js/bulletin.js';

const HOUR = 3600e3;
const MODELS = ['openai/gpt-4.1-mini', 'openai/gpt-4o-mini'];
const log = (...a) => console.log('[bulletin]', ...a);
const now = Date.now();

const verif = fs.existsSync('data/verification.json') ? JSON.parse(fs.readFileSync('data/verification.json', 'utf8')) : null;
const calib = D.makeCalibration(verif);
const fc = D.applyCalibration(await D.fetchModels(), calib, now);
const w = (id, L, k) => calib.weight(id, L, k);
const cons = {};
for (const z of [...SP.BANDS, 1550, 2265]) cons[z] = D.consensus(fc, z, w, now);
log('models', Object.keys(fc.series).length);

const days = B.dayWindows(now, 15);
const freshAt = (z, d) => { const win = days[d]; return cons[z].reduce((a, x) => a + (x.n && x.time > win.from && x.time <= win.end ? (x.cm || 0) : 0), 0); };
const interp = (pairs, z) => { for (let i = 1; i < pairs.length; i++) if (z <= pairs[i][0]) { const [z0, v0] = pairs[i - 1], [z1, v1] = pairs[i]; return v0 + (v1 - v0) * (z - z0) / (z1 - z0); } return pairs[pairs.length - 1][1]; };

let ens = null;
try {
  const e = await D.fetchEnsemble('ecmwf_ifs025_ensemble', 15);
  const bias = ms => calib.tBias('ecmwf_ifs', Math.max(0, Math.floor((ms - now) / (24 * HOUR))), new Date(ms).getUTCHours());
  ens = D.ensembleStats(e, 1550, bias);
} catch (e) { log('ensemble failed', e.message); }

let pack = null, obsHs = null;
try {
  const start = SP.seasonStart(now);
  const [hist, rows, obs] = await Promise.all([D.fetchHistory(start, now), D.fetchSnowObs(start, now).catch(() => []), D.fetchObs('73242003', 168).catch(() => [])]);
  pack = SP.runSnowpack({ hist, bands: cons, fcTime: fc.time, obs: SP.snowObservations(rows, obs, now), now });
  const last = [...obs].reverse().find(o => o.hs !== null && o.hs !== undefined);
  if (last) obsHs = { cm: last.hs, where: "Saint-Jean-d'Arves", time: last.time };
} catch (e) { log('snowpack failed', e.message); }

const digest = B.buildDigest({ now, cons, days, freshAt, interp, ens, pack, obsHs });
const draft = { fr: B.writeBulletin(digest, 'fr'), en: B.writeBulletin(digest, 'en') };
log('draft fr:', draft.fr);

const today = lang => new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(now));
const prompt = lang => lang === 'fr'
  ? `Rédige le bulletin neige et météo du Corbier (Les Sybelles, Savoie) affiché en haut du site. 3 à 5 phrases, 80 à 120 mots, en français, ton clair et vivant, sans emoji, sans titre, sans liste ni gras. Utilise uniquement les chiffres des données ci-dessous, arrondis comme dans le brouillon ; n'invente rien (ni vent, ni soleil, ni conditions de ski non indiqués). Ordre : les 48 prochaines heures, puis les jours 3 à 7, puis la neige au sol, et termine TOUJOURS par la tendance à 14 jours avec son incertitude. « base » = Le Corbier, 1 550 m ; « top » = Pointe du Corbier, 2 265 m, en haut des pistes. Les dates sont des jours de Paris ; nous sommes ${today('fr')}.\n\nBrouillon factuel à reformuler : « ${draft.fr} »\n\nDonnées : ${JSON.stringify(digest)}`
  : `Write the snow and weather bulletin for Le Corbier (Les Sybelles, Savoie) shown at the top of the website. 3 to 5 sentences, 80 to 120 words, in English, clear and lively, no emoji, no title, no lists or bold. Use only the numbers in the data below, rounded as in the draft; invent nothing (no wind, sunshine or skiing conditions that are not given). Order: the next 48 hours, then days 3 to 7, then the snow on the ground, and ALWAYS end with the 14-day trend and its uncertainty. "base" = Le Corbier, 1,550 m; "top" = Pointe du Corbier, 2,265 m, top of the slopes. Dates are Paris days; it is now ${today('en')}.\n\nFactual draft to rephrase: "${draft.en}"\n\nData: ${JSON.stringify(digest)}`;

async function ask(model, lang) {
  const r = await fetch('https://models.github.ai/inference/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GITHUB_TOKEN}` },
    body: JSON.stringify({ model, temperature: 0.4, max_tokens: 450, messages: [
      { role: 'system', content: lang === 'fr' ? 'Tu es prévisionniste neige en montagne. Tu es précis, sobre et tu ne t’écartes jamais des données fournies.' : 'You are a mountain snow forecaster. You are precise, plain-spoken and never stray from the data you are given.' },
      { role: 'user', content: prompt(lang) },
    ] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  let text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '').trim();
  text = text.replace(/^["«“\s]+|["»”\s]+$/g, '').replace(/\*\*/g, '').replace(/\s*\n+\s*/g, ' ');
  if (text.length < 150 || text.length > 1400) {
    const c = j.choices && j.choices[0];
    throw new Error(`unexpected length ${text.length}; finish_reason=${c && c.finish_reason}; raw=${JSON.stringify(j).slice(0, 600)}`);
  }
  return text;
}

if (!process.env.GITHUB_TOKEN) { log('no GITHUB_TOKEN: nothing written'); process.exit(0); }
for (const model of MODELS) {
  try {
    const fr = await ask(model, 'fr'); const en = await ask(model, 'en');
    fs.writeFileSync('data/bulletin.json', JSON.stringify({ generated: new Date().toISOString(), model: model.split('/')[1], fr, en, draft, digest }));
    log('written with', model); log(fr);
    process.exit(0);
  } catch (e) { log(model, 'failed:', e.message); }
}
log('no model answered: data/bulletin.json left unchanged');
