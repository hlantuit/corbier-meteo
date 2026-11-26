// Synthetic but realistic-shaped responses for offline rendering tests.
import zlib from 'node:zlib';
const HOUR = 3600e3;
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

export function forecast(url, now) {
  const u = new URL(url); const models = u.searchParams.get('models').split(','); const vars = u.searchParams.get('hourly').split(',');
  const start = Math.floor(now / 864e5) * 864e5 - 2 * 864e5; const n = 18 * 24;
  const time = Array.from({ length: n }, (_, i) => (start + i * HOUR) / 1000);
  const hours = { meteofrance_arome_france_hd: 51, ecmwf_ifs: 360, meteoswiss_icon_seamless: 120, ecmwf_aifs025_single: 360, icon_d2: 48, meteofrance_arpege_europe: 102, ukmo_global_deterministic_10km: 168, gfs_seamless: 384, italia_meteo_arpae_icon_2i: 72, icon_eu: 120 };
  const bias = { ecmwf_ifs: -3.4, ukmo_global_deterministic_10km: -4.8, meteofrance_arome_france_hd: -1.8, gfs_seamless: -2.4 };
  const hourly = { time };
  for (const m of models) {
    const lastIdx = Math.floor((now - start) / HOUR) + (hours[m] || 120);
    const off = (rnd() - 0.5) * 1.2; const pf = 0.7 + rnd() * 0.8; const shift = Math.round(gauss() * 3);
    for (const v of vars) hourly[`${v}_${m}`] = time.map((ts, i) => {
      if (i > lastIdx) return null;
      const t = ts * 1000; const h = (t - now) / HOUR; const hod = new Date(t).getUTCHours();
      const storm = Math.exp(-(((h - 40 - shift) / 14) ** 2)); const storm2 = Math.exp(-(((h - 160 - shift * 2) / 20) ** 2)) * 0.7;
      const T = -2 + 3.2 * Math.sin((hod - 8) / 24 * 2 * Math.PI) - 4 * storm + 2 * Math.sin(h / 90) + off + (bias[m] || 0) + gauss() * 0.3 * (1 + h / 100);
      const P = Math.max(0, (2.2 * storm + 1.4 * storm2) * pf + (rnd() < 0.05 ? rnd() * 0.4 : 0) + gauss() * 0.15 * storm);
      const FL = 1600 + 900 * Math.sin(h / 50) - 700 * storm + gauss() * 60;
      switch (v) {
        case 'temperature_2m': return +T.toFixed(1);
        case 'relative_humidity_2m': return Math.round(Math.min(100, 70 + 28 * storm + gauss() * 5));
        case 'precipitation': return +P.toFixed(2);
        case 'snowfall': return m === 'meteofrance_arome_france_hd' ? null : +(T < 0.5 ? P * 0.7 : 0).toFixed(2);
        case 'freezing_level_height': return /icon|gfs|ukmo/.test(m) ? Math.round(FL) : null;
        case 'snowfall_height': return /icon/.test(m) ? Math.round(FL - 280) : null;
        case 'wind_speed_10m': return +(12 + 18 * storm + gauss() * 3).toFixed(1);
        case 'wind_gusts_10m': return +(25 + 35 * storm + gauss() * 5).toFixed(1);
        case 'wind_direction_10m': return Math.round((250 + 40 * Math.sin(h / 30) + 360) % 360);
        case 'cloud_cover_low': return Math.round(Math.min(100, 20 + 80 * storm + gauss() * 10) * (storm > 0.1 ? 1 : rnd()));
        case 'cloud_cover_mid': return Math.round(Math.min(100, Math.max(0, 30 + 70 * storm + gauss() * 15)));
        case 'cloud_cover_high': return Math.round(Math.min(100, Math.max(0, 40 + 30 * Math.sin(h / 20) + gauss() * 10)));
        case 'weather_code': return P > 0.5 ? (T < 0.5 ? 73 : 63) : (storm > 0.2 ? 3 : 1);
        default: return null;
      }
    });
  }
  return { latitude: 45.24, longitude: 6.27, elevation: 1550, hourly };
}

export function ensemble(url, now) {
  const start = Math.floor(now / 864e5) * 864e5; const n = 15 * 24;
  const time = Array.from({ length: n }, (_, i) => (start + i * HOUR) / 1000);
  const hourly = { time };
  for (let k = 0; k <= 50; k++) {
    const sfx = k === 0 ? '' : `_member${String(k).padStart(2, '0')}`;
    const amp = 0.4 + rnd() * 1.2; const sh = gauss() * 6; const tOff = gauss() * 1.5;
    const T = [], P = [], RH = [];
    time.forEach((ts, i) => {
      const t = ts * 1000; const h = (t - now) / HOUR; const hod = new Date(t).getUTCHours();
      const spread = 1 + h / 80;
      const storm = Math.exp(-(((h - 40 - sh) / 14) ** 2)); const s2 = Math.exp(-(((h - 160 - sh * 3) / (18 + rnd())) ** 2)) * amp; const s3 = Math.exp(-(((h - 280 - sh * 4) / 20) ** 2)) * (rnd() < 0.4 ? amp : 0.1);
      T.push(+(-5.4 + 3 * Math.sin((hod - 8) / 24 * 2 * Math.PI) - 4 * storm + tOff * spread * 0.6 + 2 * Math.sin(h / 90)).toFixed(1));
      P.push(+Math.max(0, 2 * storm * amp + 1.2 * s2 + 1.1 * s3 + gauss() * 0.05).toFixed(2));
      RH.push(85);
    });
    hourly['temperature_2m' + sfx] = T; hourly['precipitation' + sfx] = P; hourly['relative_humidity_2m' + sfx] = RH; hourly['freezing_level_height' + sfx] = time.map(() => null);
  }
  return { hourly };
}

export function seasonal(url, now) {
  const u = new URL(url);
  if (u.searchParams.get('weekly')) {
    const t0 = Math.floor(now / (7 * 864e5)) * 7 * 864e5 - 3 * 864e5;
    return { weekly: { time: Array.from({ length: 7 }, (_, i) => (t0 + i * 7 * 864e5) / 1000), temperature_2m_anomaly: [-0.6, 0.9, 0.4, 1.5, 2.4, 1.9, null], precipitation_anomaly: [16.8, -26.5, -4.3, 6.5, 9, 16.6, null], snowfall_anomaly: [16.5, -15, -2.3, -0.8, 0.9, 8, null] } };
  }
  const d = new Date(now); const months = Array.from({ length: 6 }, (_, i) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1) / 1000);
  return { monthly: { time: months, temperature_2m_anomaly: [2, 1.8, 1.6, 2.3, 1.5, 1.4], precipitation_anomaly: [-13, 17.8, 15.1, 23.6, 16, 1.7], snowfall_anomaly: [-18.8, 0.1, 0.1, 1.8, -8, -7], snow_depth_anomaly: [-0.11, -0.17, -0.16, -0.1, -0.18, -0.31] } };
}

export function tabular(url, now) {
  const rows = []; const t0 = Math.floor(now / HOUR) * HOUR - 14 * HOUR;
  for (let i = 0; i < 96; i++) { const t = new Date(t0 - i * HOUR); const k = t.toISOString().slice(0, 13).replace(/[-T]/g, '');
    rows.push({ AAAAMMJJHH: k, T: +(-1 + Math.sin(i / 4)).toFixed(1), RR1: i < 30 ? 0.6 : 0, NEIGETOT: i < 20 ? 34 : (i < 40 ? 24 : 8), FF: 3.2, FXI: 8.5, DD: 250 }); }
  return { data: rows, links: {}, meta: { total: rows.length } };
}

// ---- synthetic DEM for the Le Corbier area -> float32 GeoTIFF (uncompressed strip) ----
const peaks = [[45.2343, 6.2434, 1050], [45.2395, 6.2150, 1150], [45.2743, 6.2564, 900], [45.2165, 6.1912, 1200], [45.2174, 6.2846, 700], [45.2558, 6.2350, 900]];
function demAt(lat, lon) {
  let z = 1250 - (lon - 6.24) * 6000 - Math.max(0, lon - 6.30) * 9000; // valley drops to the east
  for (const [la, lo, h] of peaks) { const d2 = ((lat - la) / 0.018) ** 2 + ((lon - lo) / 0.026) ** 2; z += h * Math.exp(-d2); }
  z += 40 * Math.sin(lat * 900) * Math.cos(lon * 700) + 25 * Math.sin(lat * 2300 + lon * 1700);
  return Math.max(400, z);
}
const merc2ll = (x, y) => [x / 20037508.342789244 * 180, Math.atan(Math.sinh(y / 6378137)) * 180 / Math.PI];
export function geotiff(url) {
  const u = new URL(url); const [x0, y0, x1, y1] = u.searchParams.get('BBOX').split(',').map(Number); const W = +u.searchParams.get('WIDTH'), H = +u.searchParams.get('HEIGHT');
  const headerLen = 8 + 2 + 12 * 9 + 4; const dataOff = 256; const buf = Buffer.alloc(dataOff + W * H * 4);
  buf.write('II', 0); buf.writeUInt16LE(42, 2); buf.writeUInt32LE(8, 4);
  const entries = [[256, 4, 1, W], [257, 4, 1, H], [258, 3, 1, 32], [259, 3, 1, 1], [262, 3, 1, 1], [273, 4, 1, dataOff], [277, 3, 1, 1], [278, 4, 1, H], [339, 3, 1, 3]];
  buf.writeUInt16LE(entries.length, 8);
  entries.forEach(([tag, type, cnt, val], i) => { const e = 10 + i * 12; buf.writeUInt16LE(tag, e); buf.writeUInt16LE(type, e + 2); buf.writeUInt32LE(cnt, e + 4); if (type === 3) buf.writeUInt16LE(val, e + 8); else buf.writeUInt32LE(val, e + 8); });
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) { const [lon, lat] = merc2ll(x0 + (c + 0.5) / W * (x1 - x0), y1 - (r + 0.5) / H * (y1 - y0)); buf.writeFloatLE(demAt(lat, lon), dataOff + (r * W + c) * 4); }
  void headerLen; return buf;
}

export function wfs(url) {
  const u = new URL(url); const type = u.searchParams.get('TYPENAMES');
  if (/batiment/.test(type)) {
    const feats = []; for (let i = 0; i < 160; i++) { const la = 45.2406 + gauss() * 0.0018, lo = 6.2688 + gauss() * 0.0025; const s = 0.00008 + rnd() * 0.00012; const h = rnd() < 0.15 ? 25 + rnd() * 25 : 6 + rnd() * 9;
      feats.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[lo - s, la - s / 1.4], [lo + s, la - s / 1.4], [lo + s, la + s / 1.4], [lo - s, la + s / 1.4], [lo - s, la - s / 1.4]]] }, properties: { hauteur: +h.toFixed(1), usage_1: 'Résidentiel' } }); }
    return { type: 'FeatureCollection', features: feats };
  }
  if (/transport_par_cable/.test(type)) return { type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[6.2688, 45.2406], [6.2434, 45.2343]] }, properties: { toponyme: 'TSD Mont Corbier', nature: 'Télésiège' } },
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[6.2700, 45.2390], [6.2560, 45.2550]] }, properties: { toponyme: 'TS Liaison', nature: 'Télésiège' } } ] };
  return { type: 'FeatureCollection', features: [] };
}
export function overpass() {
  const el = []; const diffs = ['easy', 'intermediate', 'advanced', 'expert'];
  for (let k = 0; k < 14; k++) { const a = rnd() * Math.PI; const g = []; let la = 45.2343 + gauss() * 0.004, lo = 6.2434 + gauss() * 0.006;
    for (let i = 0; i < 20; i++) { la += 0.0003 * Math.sin(a) + gauss() * 0.0001; lo += 0.0011 + gauss() * 0.0002; g.push({ lat: la, lon: lo }); }
    el.push({ type: 'way', geometry: g, tags: { 'piste:type': 'downhill', 'piste:difficulty': diffs[k % 4], name: 'Piste ' + k } }); }
  return { elements: el };
}
export const transparentPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
void zlib;
