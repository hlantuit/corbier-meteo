// A short snow & weather bulletin for the coming days, always ending with the 14-day trend.
// buildDigest() condenses the computed forecast into a few numbers per day; writeBulletin() phrases them in
// French or English without any AI. The GitHub Action (scripts/update-bulletin.mjs) hands the same digest
// and this draft to a language model (GitHub Models) for a more natural wording, baked into data/bulletin.json.

const HOUR = 3600e3, DAY = 24 * HOUR;
const BASE = 1550, TOP = 2265;

// Offset of Paris local time from UTC at a given instant (ms)
export function parisOffset(ms) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms));
  const g = k => +p.find(x => x.type === k).value;
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - Math.floor(ms / 60000) * 60000;
}

// Paris calendar days from today: { d, start, end (UTC ms), from (max(start, now)), morning (09:00 local; now for today), label (local midnight as UTC ms), key 'YYYY-MM-DD' }
export function dayWindows(now, n = 15) {
  const local0 = Math.floor((now + parisOffset(now)) / DAY) * DAY;
  return [...Array(n)].map((_, d) => {
    const ls = local0 + d * DAY; const start = ls - parisOffset(ls - parisOffset(now)); const end = start + DAY;
    return { d, start, end, from: Math.max(start, now), morning: d === 0 ? now : start + 9 * HOUR, label: ls, key: new Date(ls).toISOString().slice(0, 10) };
  });
}

const r1 = v => (v === null || v === undefined || isNaN(v) ? null : Math.round(v * 10) / 10);
const r0 = v => (v === null || v === undefined || isNaN(v) ? null : Math.round(v));

// Condense the forecast: cons = { 1550: [...], 2265: [...] } hourly consensus; days = dayWindows();
// freshAt(z, d) = fresh snow (cm) on day d at elevation z; interp(pairs, z) reads an elevation profile;
// ens = ensemble statistics (optional); pack = snowpack model (optional); obsHs = { cm, where, time } (optional)
export function buildDigest({ now, cons, days, freshAt, interp, ens, pack, obsHs }) {
  const base = cons[BASE], top = cons[TOP];
  const cur = base.find(x => x.time >= now - HOUR / 2) || base[0];
  const ensByDay = {};
  if (ens) ens.days.forEach((k, i) => { if (ens.dq[i]) ensByDay[k] = ens.dq[i]; });
  const out = {
    issued: new Date(now).toISOString(),
    place: 'Le Corbier, Les Sybelles (Savoie)', base_m: BASE, top_m: TOP,
    now: { t: r1(cur && cur.t), snowline_m: cur && cur.line !== null ? Math.round(cur.line / 50) * 50 : null },
    measured_snow_depth: obsHs ? { cm: r0(obsHs.cm), station: obsHs.where, hours_ago: Math.round((now - obsHs.time) / HOUR) } : null,
    days: [],
  };
  for (const w of days) {
    const hrs = base.filter(x => x.n && x.time > w.from && x.time <= w.end);
    if (!hrs.length) continue;
    const local = x => new Date(x.time + parisOffset(x.time)).getUTCHours();
    const dayHrs = hrs.filter(x => local(x) >= 8 && local(x) <= 17);
    const wet = hrs.filter(x => (x.p || 0) > 0.2 && x.line !== null);
    const sp = wet.reduce((a, x) => a + x.p, 0);
    const cloud = x => 100 * (1 - (1 - (x.cloudLow || 0) / 100) * (1 - (x.cloudMid || 0) / 100) * (1 - (x.cloudHigh || 0) / 100));
    const e = ensByDay[w.key];
    out.days.push({
      date: w.key, d: w.d, partial: w.d === 0,
      fresh_cm: { base: r0(freshAt(BASE, w.d)), top: r0(freshAt(TOP, w.d)) },
      rain_mm_base: r0(hrs.reduce((a, x) => a + (x.rain || 0), 0)),
      t_min: r0(Math.min(...hrs.map(x => x.t))), t_max: r0(Math.max(...hrs.map(x => x.t))),
      t_top_min: r0(Math.min(...top.filter(x => x.n && x.time > w.from && x.time <= w.end).map(x => x.t))),
      snowline_m: sp ? Math.round(wet.reduce((a, x) => a + x.p * x.line, 0) / sp / 100) * 100 : null,
      gust_kmh: r0(Math.max(...hrs.map(x => x.gust || 0))),
      cloud_pct_daytime: dayHrs.length ? r0(dayHrs.reduce((a, x) => a + cloud(x), 0) / dayHrs.length) : null,
      ensemble_base_cm: e ? { p10: r0(e.p10), p50: r0(e.p50), p90: r0(e.p90), chance_1cm_pct: r0(e.pAny * 100) } : null,
      trend: w.d >= 7,
    });
  }
  if (ens && ens.cq) {
    const q = i => ens.cq[Math.min(i, ens.cq.length - 1)];
    const q7 = q(6), q14 = q(13);
    out.ensemble_totals_base_cm = {
      d7: q7 ? { p10: r0(q7.p10), p50: r0(q7.p50), p90: r0(q7.p90) } : null,
      d14: q14 ? { p10: r0(q14.p10), p50: r0(q14.p50), p90: r0(q14.p90) } : null,
      chance_10cm_in_7d_pct: r0(ens.prob(7, 10) * 100), chance_30cm_in_14d_pct: r0(ens.prob(14, 30) * 100),
    };
  }
  if (pack) {
    const at = t => { const p = pack.at(t); return { base: r0(interp(p, BASE)), top: r0(interp(p, TOP)) }; };
    out.snow_on_ground_cm = { now: at(now), day7: at(days[Math.min(7, days.length - 1)].morning), day14: at(days[days.length - 1].morning) };
  }
  return out;
}

// ---------- plain-language bulletin (no AI) ----------
const L = {
  fr: {
    today: "aujourd'hui", tomorrow: 'demain', and: 'et', to: 'à',
    sky: c => (c === null ? '' : c < 30 ? 'sous le soleil' : c < 65 ? 'avec des éclaircies' : 'sous un ciel gris'),
  },
  en: {
    today: 'today', tomorrow: 'tomorrow', and: 'and', to: 'to',
    sky: c => (c === null ? '' : c < 30 ? 'with sunshine' : c < 65 ? 'with sunny spells' : 'under grey skies'),
  },
};
const round5 = v => (v < 10 ? Math.round(v) : Math.round(v / 5) * 5);
const num = (v, lang) => new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-GB').format(v).replace('-', '−');

export function writeBulletin(g, lang = 'fr') {
  const fr = lang === 'fr', T = L[lang];
  const D = g.days; if (!D.length) return '';
  const name = day => day.d === 0 ? T.today : day.d === 1 ? T.tomorrow
    : new Intl.DateTimeFormat(fr ? 'fr-FR' : 'en-GB', { weekday: 'long', ...(day.d >= 7 ? { day: 'numeric' } : {}), timeZone: 'UTC' }).format(new Date(day.date + 'T12:00:00Z'));
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const list = ds => {
    if (ds.length === 1) return name(ds[0]);
    const consecutive = ds.every((x, i) => !i || x.d === ds[i - 1].d + 1);
    if (consecutive && ds.length > 2) return fr ? `de ${name(ds[0])} à ${name(ds[ds.length - 1])}` : `from ${name(ds[0])} to ${name(ds[ds.length - 1])}`;
    return ds.slice(0, -1).map(name).join(', ') + ` ${T.and} ` + name(ds[ds.length - 1]);
  };
  const out = [];
  // 1. next 48 hours
  const near = D.filter(x => x.d <= 1);
  const snowy = near.filter(x => x.fresh_cm.top >= 2);
  if (!snowy.length) {
    const ref = near[near.length - 1];
    const sky = T.sky(ref.cloud_pct_daytime);
    out.push(fr ? `${cap(near.length > 1 ? `${T.today} et ${T.tomorrow}` : T.today)}, temps sec ${sky}, de ${num(ref.t_min, lang)} à ${num(ref.t_max, lang)} °C au Corbier.`
      : `${cap(near.length > 1 ? `${T.today} and ${T.tomorrow}` : T.today)}: dry ${sky}, ${num(ref.t_min, lang)} to ${num(ref.t_max, lang)} °C at Le Corbier.`);
  } else {
    const b = snowy.reduce((a, x) => a + x.fresh_cm.base, 0), t = snowy.reduce((a, x) => a + x.fresh_cm.top, 0);
    const lines = snowy.map(x => x.snowline_m).filter(v => v !== null); const line = lines.length ? Math.round(lines.reduce((a, v) => a + v, 0) / lines.length / 100) * 100 : null;
    const rain = snowy.reduce((a, x) => a + x.rain_mm_base, 0);
    if (b >= 1) out.push(fr ? `Neige attendue ${list(snowy)} : ≈ ${round5(b)} cm au Corbier et ${round5(t)} cm en haut des pistes${line ? `, limite pluie-neige vers ${num(line, lang)} m` : ''}.`
      : `Snow ${list(snowy)}: about ${round5(b)} cm at Le Corbier and ${round5(t)} cm at the top of the slopes${line ? `, rain–snow line near ${num(line, lang)} m` : ''}.`);
    else out.push(fr ? `Neige en altitude ${list(snowy)} (≈ ${round5(t)} cm à 2 265 m), mais ${rain >= 1 ? `pluie au Corbier (${Math.round(rain)} mm)` : 'presque rien au Corbier'}${line ? ` : limite vers ${num(line, lang)} m` : ''}.`
      : `Snow up high ${list(snowy)} (about ${round5(t)} cm at 2,265 m), but ${rain >= 1 ? `rain at Le Corbier (${Math.round(rain)} mm)` : 'very little at Le Corbier'}${line ? `: snow line near ${num(line, lang)} m` : ''}.`);
  }
  // 2. days 3 to 7
  const mid = D.filter(x => x.d >= 2 && x.d <= 6);
  if (mid.length) {
    const sn = mid.filter(x => x.fresh_cm.top >= 3);
    const tNear = near.reduce((a, x) => a + x.t_max, 0) / near.length, tMid = mid.reduce((a, x) => a + x.t_max, 0) / mid.length;
    const trend = tMid - tNear > 2.5 ? (fr ? 'en se radoucissant' : 'turning milder') : tNear - tMid > 2.5 ? (fr ? 'en se refroidissant' : 'turning colder') : '';
    if (!sn.length) out.push(fr ? `Rien de notable ensuite jusqu'à ${name(mid[mid.length - 1])}${trend ? `, ${trend}` : ''}.` : `Nothing significant after that until ${name(mid[mid.length - 1])}${trend ? `, ${trend}` : ''}.`);
    else {
      const t = sn.reduce((a, x) => a + x.fresh_cm.top, 0), b = sn.reduce((a, x) => a + x.fresh_cm.base, 0);
      out.push(fr ? `${near.some(x => x.fresh_cm.top >= 2) ? 'Nouvelles chutes' : 'Retour de la neige'} ${list(sn)} : ≈ ${round5(t)} cm en haut${b >= 1 ? `, ${round5(b)} cm au village` : ', peu au village'}${trend ? `, ${trend}` : ''}.`
        : `${near.some(x => x.fresh_cm.top >= 2) ? 'More snow' : 'Snow returns'} ${list(sn)}: about ${round5(t)} cm up top${b >= 1 ? `, ${round5(b)} cm in the village` : ', little in the village'}${trend ? `, ${trend}` : ''}.`);
    }
  }
  // 3. snow on the ground
  if (g.snow_on_ground_cm) {
    const s = g.snow_on_ground_cm.now;
    out.push(fr ? `Au sol : ≈ ${round5(s.base)} cm au village, ${round5(s.top)} cm en haut des pistes.` : `On the ground: about ${round5(s.base)} cm in the village, ${round5(s.top)} cm at the top.`);
  } else if (g.measured_snow_depth) out.push(fr ? `Au sol : ${g.measured_snow_depth.cm} cm mesurés à ${g.measured_snow_depth.station}.` : `On the ground: ${g.measured_snow_depth.cm} cm measured at ${g.measured_snow_depth.station}.`);
  // 4. 14-day trend (always)
  const e = g.ensemble_totals_base_cm;
  if (e && e.d14) {
    const q = e.d14; const spread = (q.p90 - q.p10) / (q.p50 + 5);
    const conf = spread > 3 ? (fr ? 'signal très incertain' : 'a very uncertain signal') : spread > 1.5 ? (fr ? 'signal incertain' : 'an uncertain signal') : (fr ? 'signal assez net' : 'a fairly clear signal');
    const late = D.find(x => x.d >= 7 && x.ensemble_base_cm && x.ensemble_base_cm.chance_1cm_pct >= 50 && x.ensemble_base_cm.p50 >= 2);
    out.push(fr ? `Tendance à 14 jours : ${q.p50 < 1 ? 'pas de neige notable en médiane au Corbier' : `≈ ${round5(q.p50)} cm de neige fraîche au Corbier en médiane`} (${q.p10} à ${q.p90} cm selon les 51 scénarios), ${e.chance_30cm_in_14d_pct} % de chances de dépasser 30 cm${late ? ` ; neige probable vers ${name(late)}` : ''} — ${conf}.`
      : `14-day trend: ${q.p50 < 1 ? 'no significant snow at Le Corbier in the median' : `about ${round5(q.p50)} cm of fresh snow at Le Corbier in the median`} (${q.p10} to ${q.p90} cm across the 51 scenarios), ${e.chance_30cm_in_14d_pct} % chance of more than 30 cm${late ? `; snow likely around ${name(late)}` : ''} — ${conf}.`);
  } else {
    const far = D.filter(x => x.d >= 7); const t = far.reduce((a, x) => a + x.fresh_cm.base, 0);
    if (far.length) out.push(fr ? `Tendance à 14 jours (modèles déterministes, peu fiables à cette échéance) : ≈ ${round5(t)} cm au Corbier entre ${name(far[0])} et ${name(far[far.length - 1])}.`
      : `14-day trend (deterministic models, low skill at this range): about ${round5(t)} cm at Le Corbier between ${name(far[0])} and ${name(far[far.length - 1])}.`);
  }
  return out.join(' ');
}
