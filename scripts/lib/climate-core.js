// Builds the archive summary shown at the bottom of the dashboard (runs in Node and in a browser).
// Input: Open-Meteo archive daily arrays (time, snowfall_sum, temperature_2m_mean), local dates.
(function (root) {
  const SEASON_DAYS = 181; // 1 Nov -> 30 Apr (non-leap)

  function seasonIndex(dateStr) { // 'YYYY-MM-DD' -> { winter, i } where winter = year of the January
    const y = +dateStr.slice(0, 4), m = +dateStr.slice(5, 7), d = +dateStr.slice(8, 10);
    const winter = m >= 11 ? y + 1 : y;
    if (m >= 5 && m <= 10) return null;
    const start = Date.UTC(winter - 1, 10, 1);
    const i = Math.round((Date.UTC(y, m - 1, d) - start) / 864e5);
    return i >= 0 && i < SEASON_DAYS ? { winter, i } : null;
  }

  function quantile(sorted, q) {
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  function buildClimate(daily, opts = {}) {
    const ref = opts.ref || [1991, 2020];
    const W = {};
    for (let k = 0; k < daily.time.length; k++) {
      const s = seasonIndex(daily.time[k]); if (!s) continue;
      const w = W[s.winter] || (W[s.winter] = { snow: new Array(SEASON_DAYS).fill(null), t: [] });
      const v = daily.snowfall_sum[k]; if (v !== null && v !== undefined) w.snow[s.i] = v;
      const m = +daily.time[k].slice(5, 7);
      const tm = daily.temperature_2m_mean[k];
      if ((m === 12 || m <= 2) && tm !== null && tm !== undefined) w.t.push(tm);
    }
    const cum = arr => { let c = 0; let seen = false; return arr.map(v => { if (v === null) return seen ? null : null; seen = true; c += v; return +c.toFixed(1); }); };
    const years = Object.keys(W).map(Number).sort((a, b) => a - b);
    const lastYear = years[years.length - 1];
    const winters = years.map(y => {
      const w = W[y]; const valid = w.snow.filter(v => v !== null).length;
      return { year: y, snow: valid > 20 ? +w.snow.reduce((a, v) => a + (v || 0), 0).toFixed(0) : null, tdjf: w.t.length >= 80 ? +(w.t.reduce((a, b) => a + b, 0) / w.t.length).toFixed(2) : null, partial: valid < SEASON_DAYS - 1 };
    }).filter(w => w.year > years[0] || !w.partial); // drop the incomplete first winter (Jan-Apr 1950 only)
    const refCum = years.filter(y => y >= ref[0] && y <= ref[1]).map(y => cum(W[y].snow));
    const pct = { p10: [], p25: [], p50: [], p75: [], p90: [] };
    for (let i = 0; i < SEASON_DAYS; i++) {
      const v = refCum.map(c => c[i]).filter(x => x !== null).sort((a, b) => a - b);
      for (const [k, q] of [['p10', .1], ['p25', .25], ['p50', .5], ['p75', .75], ['p90', .9]]) pct[k].push(v.length ? +quantile(v, q).toFixed(1) : null);
    }
    const lastFull = winters.filter(w => !w.partial).slice(-1)[0];
    return {
      source: opts.source || 'ERA5 / ERA5-Land (Open-Meteo era5_seamless)', elevation: opts.elevation || 1550, ref,
      generated: new Date().toISOString(), pct,
      current: cum(W[lastYear].snow), currentWinter: lastYear,
      last: lastFull ? cum(W[lastFull.year].snow) : null, lastLabel: lastFull ? `${lastFull.year - 1}-${String(lastFull.year).slice(2)}` : null,
      winters,
    };
  }

  // Météo-France hourly NEIGETOT -> daily max per season, for the last few winters
  function stationSeasons(hourly /* { 'YYYYMMDDHH': [T, RR1, NEIGETOT, HNEIGEF] } */, nSeasons = 4) {
    const S = {};
    for (const k in hourly) {
      const hs = hourly[k][2]; if (hs === null || hs === undefined) continue;
      const s = seasonIndex(`${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`); if (!s) continue;
      const a = S[s.winter] || (S[s.winter] = new Array(SEASON_DAYS).fill(null));
      a[s.i] = a[s.i] === null ? hs : Math.max(a[s.i], hs);
    }
    const ys = Object.keys(S).map(Number).sort((a, b) => a - b).slice(-nSeasons);
    const cur = ys[ys.length - 1];
    return ys.map(y => ({ label: `${y - 1}-${String(y).slice(2)}`, winter: y, current: y === cur, values: S[y] }));
  }

  const api = { buildClimate, stationSeasons, seasonIndex, SEASON_DAYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ClimateCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
