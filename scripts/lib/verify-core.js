// Shared verification core (runs in Node for the GitHub Action, and in a browser for the bootstrap).
// Pure functions only: no fetch, no fs. All times are UTC hour keys 'YYYYMMDDHH'.
// Observations: { hourKey: [T °C, RR1 mm, NEIGETOT cm, HNEIGEF cm] } from Météo-France hourly data.
// Forecasts:    { lead: { hourKey: {t, p} } } from Open-Meteo's Previous Runs API (lead = previous_dayN).

(function (root) {
  const VERIFY_MODELS = [
    { id: 'meteofrance_arome_france_hd', label: 'AROME HD', res: '1,3 km' },
    { id: 'meteofrance_arome_france', label: 'AROME', res: '2,5 km' },
    { id: 'meteofrance_arpege_europe', label: 'ARPEGE', res: '11 km' },
    { id: 'meteoswiss_icon_ch1', label: 'ICON-CH1', res: '1 km' },
    { id: 'meteoswiss_icon_ch2', label: 'ICON-CH2', res: '2 km' },
    { id: 'icon_d2', label: 'ICON-D2', res: '2 km' },
    { id: 'icon_eu', label: 'ICON-EU', res: '7 km' },
    { id: 'italia_meteo_arpae_icon_2i', label: 'ICON-2I', res: '2 km' },
    { id: 'ecmwf_ifs', label: 'IFS', res: '9 km' },
    { id: 'ecmwf_aifs025_single', label: 'AIFS', res: '25 km' },
    { id: 'ukmo_global_deterministic_10km', label: 'UKMO', res: '10 km' },
    { id: 'gfs_seamless', label: 'GFS', res: '13–25 km' },
  ];
  const LEADS = [0, 1, 2, 3, 4, 5, 6, 7];

  const hourKeyFromIso = iso => iso.slice(0, 4) + iso.slice(5, 7) + iso.slice(8, 10) + iso.slice(11, 13);
  const keyToDate = k => new Date(Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8), +k.slice(8, 10)));
  const p2 = n => String(n).padStart(2, '0');
  const dateToKey = d => d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) + p2(d.getUTCHours());
  const isColdSeason = k => { const m = +k.slice(4, 6); return m >= 11 || m <= 4; };
  const ok = v => v !== null && v !== undefined && !Number.isNaN(v);

  // --- physics shared with the dashboard (keep in sync with assets/js/data.js) ---
  function wetBulb(T, RH) {
    const rh = Math.max(5, Math.min(99, RH));
    return T * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) + Math.atan(T + rh) - Math.atan(rh - 1.676331)
      + 0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) - 4.686035;
  }
  const snowFracTw = tw => Math.max(0, Math.min(1, (1.5 - tw) / 1.5));
  const snowDensity = T => (T <= 0 ? 67.92 + 51.25 * Math.exp(T / 2.59) : Math.min(200, 119.2 + 40 * T));
  const snowCm = (p, T) => (p * snowFracTw(wetBulb(T, 90))) / snowDensity(T) * 100;

  function parsePreviousRuns(json) {
    const h = json.hourly; const out = {};
    for (const n of LEADS) out[n] = {};
    const sfx = n => (n === 0 ? '' : '_previous_day' + n);
    for (let i = 0; i < h.time.length; i++) {
      const k = hourKeyFromIso(h.time[i]);
      for (const n of LEADS) {
        const t = h['temperature_2m' + sfx(n)]; const p = h['precipitation' + sfx(n)];
        const tv = t ? t[i] : null; const pv = p ? p[i] : null;
        if (!ok(tv) && !ok(pv)) continue;
        out[n][k] = { t: ok(tv) ? tv : null, p: ok(pv) ? pv : null };
      }
    }
    return out;
  }

  // Mean temperature error by lead and UTC hour (cold season). Used to de-bias the live consensus.
  function temperatureBias(obs, fc) {
    const res = {};
    for (const n of LEADS) {
      const f = fc[n]; if (!f) continue;
      const s = new Array(24).fill(0), c = new Array(24).fill(0); let S = 0, C = 0;
      for (const k in f) {
        if (!isColdSeason(k) || !obs[k] || !ok(obs[k][0]) || !ok(f[k].t)) continue;
        const e = f[k].t - obs[k][0]; const hh = +k.slice(8, 10);
        s[hh] += e; c[hh]++; S += e; C++;
      }
      if (C < 200) continue;
      // light smoothing across neighbouring hours (circular 3-hour window) for robustness
      const hourly = s.map((_, h) => {
        let ss = 0, cc = 0; for (const d of [-1, 0, 1]) { const j = (h + d + 24) % 24; ss += s[j]; cc += c[j]; }
        return cc ? +(ss / cc).toFixed(2) : +(S / C).toFixed(2);
      });
      res[n] = { mean: +(S / C).toFixed(2), n: C, hourly };
    }
    return res;
  }

  function applyBias(fc, bias) {
    const out = {};
    for (const n of LEADS) {
      const f = fc[n]; if (!f) continue; out[n] = {};
      const b = bias[n] || bias[Math.max(...Object.keys(bias).map(Number).filter(x => x <= n))] || null;
      for (const k in f) {
        const v = f[k]; const hh = +k.slice(8, 10);
        out[n][k] = { t: ok(v.t) ? v.t - (b ? b.hourly[hh] : 0) : null, p: v.p };
      }
    }
    return out;
  }

  // Scores per lead. Temperature hourly; precipitation and snow on climatological days 06–06 UTC.
  function scoreModel(obs, fc, opts = {}) {
    const season = opts.season || 'cold';
    const inSeason = k => season === 'all' || isColdSeason(k);
    const res = {};
    const obsKeys = Object.keys(obs).sort(); if (!obsKeys.length) return res;
    const first = keyToDate(obsKeys[0]); const last = keyToDate(obsKeys[obsKeys.length - 1]);
    for (const n of LEADS) {
      const f = fc[n]; if (!f || !Object.keys(f).length) continue;
      let tn = 0, tAbs = 0, tSum = 0, tSq = 0;
      for (const k of obsKeys) {
        if (!inSeason(k)) continue; const o = obs[k][0]; const v = f[k] && f[k].t;
        if (!ok(o) || !ok(v)) continue; const e = v - o; tn++; tAbs += Math.abs(e); tSum += e; tSq += e * e;
      }
      const daily = [];
      for (let d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate(), 6)); d < last; d = new Date(d.getTime() + 864e5)) {
        const startKey = dateToKey(d); if (!inSeason(startKey)) continue;
        let po = 0, pf = 0, sf = 0, nO = 0, nF = 0, hnf = 0, hnfN = 0, endKey = startKey;
        for (let h = 1; h <= 24; h++) {
          const k = dateToKey(new Date(d.getTime() + h * 36e5)); endKey = k;
          const o = obs[k]; const v = f[k];
          if (o && ok(o[1])) { po += o[1]; nO++; }
          if (o && ok(o[3])) { hnf += o[3]; hnfN++; }
          if (v && ok(v.p) && ok(v.t)) { pf += v.p; sf += snowCm(v.p, v.t); nF++; }
        }
        let snowO;
        if (opts.snowObs) { // fresh snow observed at the next morning's report (e.g. Le Corbier, 06 UTC)
          const v = opts.snowObs[startKey.slice(0, 8)]; snowO = ok(v) ? v : null;
        } else {
          const hs0 = obs[startKey] && obs[startKey][2]; const hs1 = obs[endKey] && obs[endKey][2];
          const dHS = ok(hs0) && ok(hs1) ? hs1 - hs0 : null;
          const so = [dHS, hnfN ? hnf : null].filter(ok); snowO = so.length ? Math.max(...so) : null;
        }
        daily.push({ po: nO >= 22 ? po : null, pf: nF >= 22 ? pf : null, sf: nF >= 22 ? sf : null, so: snowO });
      }
      const cont = (thr, getO, getF) => {
        let a = 0, b = 0, c = 0, dd = 0;
        for (const x of daily) {
          const o = getO(x), v = getF(x); if (!ok(o) || !ok(v)) continue;
          const eo = o >= thr, ef = v >= thr;
          if (eo && ef) a++; else if (!eo && ef) b++; else if (eo && !ef) c++; else dd++;
        }
        const N = a + b + c + dd; const ar = N ? (a + b) * (a + c) / N : 0;
        const r3 = v => (v === null ? null : +v.toFixed(3));
        return { n: N, events: a + c, pod: r3((a + c) ? a / (a + c) : null), far: r3((a + b) ? b / (a + b) : null), ets: r3((a + b + c - ar) > 0 ? (a - ar) / (a + b + c - ar) : null), fbias: r3((a + c) ? (a + b) / (a + c) : null) };
      };
      let pn = 0, pAbs = 0, pO = 0, pF = 0;
      for (const x of daily) { if (!ok(x.po) || !ok(x.pf)) continue; pn++; pAbs += Math.abs(x.pf - x.po); pO += x.po; pF += x.pf; }
      res[n] = {
        t: tn ? { n: tn, mae: +(tAbs / tn).toFixed(3), bias: +(tSum / tn).toFixed(3), rmse: +Math.sqrt(tSq / tn).toFixed(3) } : null,
        p: pn ? { n: pn, mae: +(pAbs / pn).toFixed(3), ratio: pO ? +(pF / pO).toFixed(3) : null, ge1: cont(1, x => x.po, x => x.pf), ge10: cont(10, x => x.po, x => x.pf) } : null,
        s: cont(5, x => x.so, x => x.sf),
      };
    }
    return res;
  }

  function ensembleMean(fcs) {
    const out = {};
    for (const n of LEADS) {
      out[n] = {}; const acc = {};
      for (const fc of fcs) {
        const f = fc[n]; if (!f) continue;
        for (const k in f) {
          const v = f[k]; const a = acc[k] || (acc[k] = { t: 0, tn: 0, p: 0, pn: 0 });
          if (ok(v.t)) { a.t += v.t; a.tn++; } if (ok(v.p)) { a.p += v.p; a.pn++; }
        }
      }
      for (const k in acc) { const a = acc[k]; if (a.tn < 2) continue; out[n][k] = { t: a.t / a.tn, p: a.pn ? a.p / a.pn : null }; }
    }
    return out;
  }

  // Weights per lead: temperature from de-biased MAE (1/MAE²), precipitation from ETS ≥ 1 mm
  function deriveWeights(scores) {
    const w = {};
    for (const n of LEADS) {
      const tw = {}, pw = {}; let ts = 0, ps = 0;
      for (const id in scores) {
        const r = scores[id][n]; if (!r) continue;
        if (r.t && r.t.n > 500) { tw[id] = 1 / (r.t.mae * r.t.mae); ts += tw[id]; }
        if (r.p && r.p.n > 30 && r.p.ge1 && ok(r.p.ge1.ets)) { pw[id] = Math.max(r.p.ge1.ets, 0.05) ** 2; ps += pw[id]; }
      }
      for (const id in tw) tw[id] = +(tw[id] / ts).toFixed(3);
      for (const id in pw) pw[id] = +(pw[id] / ps).toFixed(3);
      w[n] = { t: tw, p: pw };
    }
    return w;
  }

  // Morning snow reports -> { 'YYYYMMDD' (start of the 06-06 UTC day): fresh snow cm }
  function snowObsFromReports(rows /* { 'YYYYMMDDHH': [T, RR1, NEIGETOT, HNEIGEF] } */) {
    const out = {};
    for (const k in rows) {
      if (k.slice(8, 10) !== '06') continue;
      const hn = rows[k][3]; if (!ok(hn)) continue;
      const d = keyToDate(k); const start = new Date(d.getTime() - 864e5);
      out[dateToKey(start).slice(0, 8)] = hn;
    }
    return out;
  }

  const api = { snowObsFromReports, VERIFY_MODELS, LEADS, hourKeyFromIso, keyToDate, dateToKey, isColdSeason, parsePreviousRuns, temperatureBias, applyBias, scoreModel, ensembleMean, deriveWeights, snowCm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.VerifyCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
