// Relief map (2D and 3D) built only from free IGN services, OpenStreetMap and Copernicus Sentinel-2.
import { SITE, API, COLORS } from './config.js';
import { t, fmt, getLang } from './i18n.js';

const maplibregl = window.maplibregl;

// ---------- IGN float32 DEM -> Terrain-RGB, on the fly ----------
// IGN's WMS-R serves the RGE ALTI as float32 GeoTIFF. We decode it in the browser and
// re-encode it as Mapbox Terrain-RGB so MapLibre can use it for hillshading and 3D.
const DEM_SIZE = 256;

function tileBBox3857(z, x, y) {
  const R = 20037508.342789244; const size = (2 * R) / 2 ** z;
  return [-R + x * size, R - (y + 1) * size, -R + (x + 1) * size, R - y * size];
}

function readTiffFloat32(buf) {
  const dv = new DataView(buf);
  const le = dv.getUint16(0) === 0x4949;
  const u16 = o => dv.getUint16(o, le), u32 = o => dv.getUint32(o, le);
  const ifd = u32(4); const n = u16(ifd);
  const tags = {};
  const WANT = new Set([256, 257, 258, 259, 273, 277, 278, 279, 322, 323, 324, 325, 339]);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12; const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
    if (!WANT.has(tag) || (type !== 3 && type !== 4)) continue;
    const sz = type === 3 ? 2 : 4;
    const off = count * sz > 4 ? u32(e + 8) : e + 8;
    const vals = [];
    for (let k = 0; k < Math.min(count, 4096); k++) vals.push(type === 3 ? u16(off + k * 2) : u32(off + k * 4));
    tags[tag] = vals;
  }
  const W = tags[256][0], H = tags[257][0];
  if ((tags[259] || [1])[0] !== 1) throw new Error('compressed TIFF');
  const out = new Float32Array(W * H);
  const rd = o => dv.getFloat32(o, le);
  if (tags[324]) { // tiled
    const tw = tags[322][0], th = tags[323][0]; const offs = tags[324];
    const across = Math.ceil(W / tw);
    offs.forEach((o, ti) => {
      const tx = (ti % across) * tw, ty = Math.floor(ti / across) * th;
      for (let r = 0; r < th; r++) for (let c = 0; c < tw; c++) {
        const X = tx + c, Y = ty + r; if (X < W && Y < H) out[Y * W + X] = rd(o + (r * tw + c) * 4);
      }
    });
  } else {
    const offs = tags[273]; const rps = (tags[278] || [H])[0];
    offs.forEach((o, si) => { const r0 = si * rps; for (let r = 0; r < rps && r0 + r < H; r++) for (let c = 0; c < W; c++) out[(r0 + r) * W + c] = rd(o + (r * W + c) * 4); });
  }
  return { W, H, data: out };
}

// The WMS resamples with nearest neighbour, so about one row in three is a copy of the row above
// (Mercator stretches y). Copied rows make stripes in the hillshade; we interpolate across them.
function dedupe(a, W, H) {
  const same = (r1, r2) => { for (let x = 0; x < W; x += 7) if (a[r1 * W + x] !== a[r2 * W + x]) return false; return true; };
  const anchors = [0];
  for (let y = 1; y < H; y++) if (!same(y, y - 1)) anchors.push(y);
  // place each distinct row at the centre of its run, then interpolate every row between centres
  const runs = anchors.map((y0, i) => { const y1 = (i + 1 < anchors.length ? anchors[i + 1] : H) - 1; return { src: y0, c: (y0 + y1) / 2 }; });
  if (runs.length === H) return;
  const copy = new Float32Array(a);
  let k = 0;
  for (let y = 0; y < H; y++) {
    while (k + 1 < runs.length && runs[k + 1].c <= y) k++;
    const A = runs[k], B = runs[Math.min(k + 1, runs.length - 1)];
    const t = B.c === A.c ? 0 : Math.max(0, Math.min(1, (y - A.c) / (B.c - A.c)));
    for (let x = 0; x < W; x++) a[y * W + x] = copy[A.src * W + x] * (1 - t) + copy[B.src * W + x] * t;
  }
}

// Light [1 2 1] smoothing removes the remaining banding left by the server's nearest-neighbour resampling
function blur(a, W, H, passesY, passesX) {
  const t = new Float32Array(a.length);
  for (let p = 0; p < passesY; p++) { t.set(a); for (let y = 1; y < H - 1; y++) for (let x = 0; x < W; x++) a[y * W + x] = (t[(y - 1) * W + x] + 2 * t[y * W + x] + t[(y + 1) * W + x]) / 4; }
  for (let p = 0; p < passesX; p++) { t.set(a); for (let y = 0; y < H; y++) for (let x = 1; x < W - 1; x++) a[y * W + x] = (t[y * W + x - 1] + 2 * t[y * W + x] + t[y * W + x + 1]) / 4; }
}

// Decoded elevation tiles, shared by the terrain and the snow-depth layer (most recent ~150 kept)
const demCache = new Map();
function getDem(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (demCache.has(key)) { const v = demCache.get(key); demCache.delete(key); demCache.set(key, v); return v; }
  const b = tileBBox3857(z, x, y);
  const url = `${API.ignWms}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES&STYLES=&FORMAT=image/geotiff&CRS=EPSG:3857&BBOX=${b.join(',')}&WIDTH=${DEM_SIZE}&HEIGHT=${DEM_SIZE}`;
  const p = fetch(url).then(async r => {
    if (!r.ok) throw new Error('DEM ' + r.status);
    const { W, H, data } = readTiffFloat32(await r.arrayBuffer());
    dedupe(data, W, H); blur(data, W, H, 2, 1);
    return { W, H, data };
  });
  p.catch(() => demCache.delete(key));
  demCache.set(key, p);
  if (demCache.size > 150) demCache.delete(demCache.keys().next().value);
  return p;
}

async function demTile(params) {
  const [z, x, y] = params.url.replace('igndem://', '').split('/').map(Number);
  const { W, H, data } = await getDem(z, x, y);
  const img = new ImageData(W, H); const px = img.data;
  for (let i = 0; i < data.length; i++) {
    let h = data[i]; if (!(h > -500 && h < 9000)) h = 0;
    const v = Math.round((h + 10000) * 10);
    px[i * 4] = (v >> 16) & 255; px[i * 4 + 1] = (v >> 8) & 255; px[i * 4 + 2] = v & 255; px[i * 4 + 3] = 255;
  }
  const canvas = new OffscreenCanvas(W, H); canvas.getContext('2d').putImageData(img, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return { data: await blob.arrayBuffer() };
}

// ---------- snow depth by elevation, slope and aspect, drawn pixel by pixel ----------
// The snowpack model gives a depth for each 100 m band × slope (0/15/30/45°) × aspect (8 directions); each pixel
// takes its elevation, slope and aspect from the IGN terrain and is coloured with the interpolated depth.
const snowState = { grid: null, stamp: 0 };
async function snowTile(params) {
  const [z, x, y] = params.url.replace('snowgrid://', '').split('/').map(Number);
  const g = snowState.grid; const { W, H, data } = await getDem(z, x, y);
  const out = new ImageData(W, H); const px = out.data;
  if (!g) return { data: await toPng(out) };
  const b = tileBBox3857(z, x, y);
  const lat = Math.atan(Math.sinh(((b[1] + b[3]) / 2) / 6378137)); // tile centre latitude
  const pix = ((b[2] - b[0]) / W) * Math.cos(lat); // ground metres per pixel
  const { bands, slopes, aspects, data: G } = g; const nc = 1 + (slopes.length - 1) * aspects.length; const nb = bands.length;
  const hs = new Float32Array(W * H);
  const at = (i, j) => data[Math.min(H - 1, Math.max(0, j)) * W + Math.min(W - 1, Math.max(0, i))];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const h = data[j * W + i]; if (!(h > -100 && h < 6000)) { hs[j * W + i] = -1; continue; }
    const dzdx = (at(i + 1, j) - at(i - 1, j)) / (2 * pix), dzdn = (at(i, j - 1) - at(i, j + 1)) / (2 * pix);
    const slope = Math.atan(Math.hypot(dzdx, dzdn)) * 180 / Math.PI;
    let aspect = Math.atan2(-dzdx, -dzdn) * 180 / Math.PI; if (aspect < 0) aspect += 360;
    // elevation
    const fb = Math.max(0, Math.min(nb - 1.001, (h - bands[0]) / 100)); const b0 = Math.floor(fb), wb = fb - b0;
    // slope
    const fs = Math.min(slopes.length - 1.001, slope / 15); const s0 = Math.floor(fs), ws = fs - s0;
    // aspect (circular)
    const fa = aspect / 45; const a0 = Math.floor(fa) % 8, a1 = (a0 + 1) % 8, wa = fa - Math.floor(fa);
    const cls = (si, ai) => (si === 0 ? 0 : 1 + (si - 1) * 8 + ai);
    const val = bi => {
      const v = (si, ai) => G[bi * nc + cls(si, ai)];
      const lo = s0 === 0 ? v(0, 0) : v(s0, a0) * (1 - wa) + v(s0, a1) * wa;
      const hi = v(s0 + 1, a0) * (1 - wa) + v(s0 + 1, a1) * wa;
      return lo * (1 - ws) + hi * ws;
    };
    hs[j * W + i] = val(b0) * (1 - wb) + val(b0 + 1) * wb;
  }
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i, v = hs[k]; if (v < 0) continue;
    let c;
    if (v >= 1) {
      const edge = (i > 0 && hs[k - 1] >= 0 && hs[k - 1] < 1) || (i < W - 1 && hs[k + 1] >= 0 && hs[k + 1] < 1) || (j > 0 && hs[k - W] >= 0 && hs[k - W] < 1) || (j < H - 1 && hs[k + W] >= 0 && hs[k + W] < 1);
      c = edge ? EDGE_RGB : DEPTH_LUT[Math.min(DEPTH_LUT.length - 1, Math.round(v))];
    } else c = BARE_LUT[Math.max(0, Math.min(BARE_LUT.length - 1, Math.round((data[k] - 400) / 10)))];
    px[k * 4] = c[0]; px[k * 4 + 1] = c[1]; px[k * 4 + 2] = c[2]; px[k * 4 + 3] = 255;
  }
  return { data: await toPng(out) };
}
async function toPng(img) {
  const canvas = new OffscreenCanvas(img.width, img.height); canvas.getContext('2d').putImageData(img, 0, 0);
  return (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
}
const rgbOf = c => { const o = window.d3.rgb(c); return [o.r, o.g, o.b]; };
let DEPTH_LUT, BARE_LUT; const EDGE_RGB = [191, 239, 255];
function buildLuts() {
  DEPTH_LUT = Array.from({ length: 401 }, (_, cm) => rgbOf(depthColor(Math.max(1, cm), 1500)));
  BARE_LUT = Array.from({ length: 321 }, (_, k) => rgbOf(bareAt(400 + k * 10)));
}

// ---------- palettes ----------
// Base terrain tint by elevation (night-alpine), used when no snow information is drawn
const BASE_STOPS = [[700, '#0c1424'], [1100, '#111c31'], [1500, '#16233b'], [1900, '#1c2c47'], [2300, '#253855'], [2800, '#2f4565'], [3400, '#3a5275']];
// Fresh snow ramp (cm): from the terrain tint to glacier blue to white
export const SNOW_RAMP = [[0, null], [1, '#1d3a5f'], [5, '#2370cd'], [10, '#519ced'], [20, '#84b9f3'], [35, '#b6d5f8'], [60, '#dff3ff'], [100, '#ffffff']];
// Fresh snow classes (cm, lower bound → colour): sharp steps so amounts read at a glance; big dumps turn lavender
export const SNOW_CLASSES = [[1, '#1f4a80'], [5, '#2c6fc2'], [10, '#4a98ec'], [20, '#82bff6'], [30, '#bfe0fb'], [50, '#f4f9ff'], [80, '#c7b5ff']];
const snowClass = cm => { let k = -1; SNOW_CLASSES.forEach(([lo], i) => { if (cm >= lo) k = i; }); return k; };

// Snow depth ramp (cm): any snow is already a clear cold blue, deepening to white; bare ground is a warm earth
// tone, so the snow line reads at a glance
export const DEPTH_RAMP = [[0, null], [1, '#4f7fbf'], [10, '#6f9bd6'], [25, '#98bce9'], [50, '#c4dbf5'], [100, '#e9f3fd'], [200, '#ffffff']];
const BARE_STOPS = [[400, '#2a2a20'], [1000, '#323026'], [1600, '#3b372b'], [2200, '#454033'], [3000, '#4f4a3e'], [3600, '#58534a']];
export const BARE_COLOR = '#3b372b';

function baseAt(z) {
  for (let i = 1; i < BASE_STOPS.length; i++) if (z <= BASE_STOPS[i][0]) {
    const [z0, c0] = BASE_STOPS[i - 1], [z1, c1] = BASE_STOPS[i];
    return window.d3.interpolateRgb(c0, c1)((z - z0) / (z1 - z0));
  }
  return BASE_STOPS[BASE_STOPS.length - 1][1];
}
function bareAt(z) {
  for (let i = 1; i < BARE_STOPS.length; i++) if (z <= BARE_STOPS[i][0]) {
    const [z0, c0] = BARE_STOPS[i - 1], [z1, c1] = BARE_STOPS[i];
    return window.d3.interpolateRgb(c0, c1)(Math.max(0, (z - z0) / (z1 - z0)));
  }
  return BARE_STOPS[BARE_STOPS.length - 1][1];
}
function snowColor(cm, z) {
  if (!(cm > 0.5)) return baseAt(z);
  if (cm <= SNOW_RAMP[1][0]) return window.d3.interpolateRgb(baseAt(z), SNOW_RAMP[1][1])(cm / SNOW_RAMP[1][0]);
  return rampColor(cm, SNOW_RAMP.slice(1));
}
function rampColor(v, ramp) { // ramp: [[value, colour], ...] ascending
  if (v <= ramp[0][0]) return ramp[0][1];
  for (let i = 1; i < ramp.length; i++) if (v <= ramp[i][0]) return window.d3.interpolateRgb(ramp[i - 1][1], ramp[i][1])((v - ramp[i - 1][0]) / (ramp[i][0] - ramp[i - 1][0]));
  return ramp[ramp.length - 1][1];
}
// Snow on the ground: from 1 cm the terrain turns snow-blue to white; below, bare earth
const depthColor = (cm, z) => (cm >= 1 ? rampColor(cm, DEPTH_RAMP.slice(1)) : bareAt(z));
const reliefExpr = stops => ['interpolate', ['linear'], ['elevation'], ...stops.flatMap(([z, c]) => [z, c])];

// ---------- map ----------
export function createMap(container, { onReady } = {}) {
  maplibregl.addProtocol('igndem', demTile);
  maplibregl.addProtocol('snowgrid', snowTile); buildLuts();
  const lidar = `${API.ignWmts}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png`;
  const bounds = SITE.map.bounds.flat();
  const map = new maplibregl.Map({
    container, attributionControl: false, maxPitch: 78,
    // The map spans the full width: page scrolling must not zoom it (Ctrl + wheel, or two fingers, does)
    cooperativeGestures: true,
    locale: getLang() === 'fr'
      ? { 'CooperativeGesturesHandler.WindowsHelpText': 'Ctrl + molette pour zoomer sur la carte', 'CooperativeGesturesHandler.MacHelpText': '⌘ + molette pour zoomer sur la carte', 'CooperativeGesturesHandler.MobileHelpText': 'Deux doigts pour déplacer la carte' }
      : { 'CooperativeGesturesHandler.WindowsHelpText': 'Ctrl + scroll to zoom the map', 'CooperativeGesturesHandler.MacHelpText': '⌘ + scroll to zoom the map', 'CooperativeGesturesHandler.MobileHelpText': 'Use two fingers to move the map' },
    center: SITE.map.center, zoom: SITE.map.zoom, minZoom: 10.8, maxZoom: 17,
    maxBounds: [[bounds[0] - 0.05, bounds[1] - 0.04], [bounds[2] + 0.05, bounds[3] + 0.04]],
    style: {
      version: 8,
      sources: {
        dem: { type: 'raster-dem', tiles: ['igndem://{z}/{x}/{y}'], tileSize: DEM_SIZE, encoding: 'mapbox', minzoom: 10, maxzoom: 14, bounds },
        lidar: { type: 'raster', tiles: [lidar], tileSize: 256, minzoom: 12, maxzoom: 17, bounds },
        snowgrid: { type: 'raster', tiles: ['snowgrid://{z}/{x}/{y}/0'], tileSize: 256, minzoom: 10, maxzoom: 14, bounds },
        buildings: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        lifts: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        pistes: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#0b1220' } },
        { id: 'relief', type: 'color-relief', source: 'dem', paint: { 'color-relief-color': reliefExpr(BASE_STOPS), 'color-relief-opacity': 1 } },
        { id: 'snowgrid', type: 'raster', source: 'snowgrid', layout: { visibility: 'none' }, paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' } },
        { id: 'hillshade', type: 'hillshade', source: 'dem', paint: {
          'hillshade-method': 'igor', 'hillshade-exaggeration': 0.75, 'hillshade-illumination-direction': 315, 'hillshade-illumination-anchor': 'map',
          'hillshade-shadow-color': 'rgba(2,5,12,0.85)', 'hillshade-highlight-color': 'rgba(220,235,255,0.42)', 'hillshade-accent-color': 'rgba(0,0,0,0.25)' } },
        { id: 'lidar', type: 'raster', source: 'lidar', minzoom: 13, layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.55, 'raster-brightness-max': 0.75, 'raster-contrast': 0.25 } },
        // French piste colours, as on the Sybelles map (OSM in France: novice = green, easy = blue,
        // intermediate = red, advanced/expert = black). Black runs get a light casing to stay visible on the dark map.
        { id: 'pistes-casing', type: 'line', source: 'pistes', filter: ['in', ['get', 'd'], ['literal', ['advanced', 'expert']]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
          'line-color': 'rgba(235,242,255,.75)', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2.4, 15, 4, 17, 5.8] } },
        { id: 'pistes', type: 'line', source: 'pistes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
          'line-color': ['match', ['get', 'd'], 'novice', '#2fc46b', 'easy', '#3d8bff', 'intermediate', '#ff4b4b', 'advanced', '#0a0a0a', 'expert', '#0a0a0a', 'freeride', '#ffb547', '#3d8bff'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 15, 2.2, 17, 3.5], 'line-opacity': 0.85 } },
        { id: 'lifts-casing', type: 'line', source: 'lifts', paint: { 'line-color': 'rgba(3,6,12,.85)', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2.5, 16, 5] } },
        { id: 'lifts', type: 'line', source: 'lifts', paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 16, 2] } },
        { id: 'buildings', type: 'fill-extrusion', source: 'buildings', minzoom: 12, paint: {
          'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'h'], 3, '#c9d6ea', 20, '#e9f0fb', 45, '#ffffff'],
          'fill-extrusion-height': ['coalesce', ['get', 'h'], 6], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.92, 'fill-extrusion-vertical-gradient': true } },
      ],
      sky: { 'sky-color': '#0a1430', 'horizon-color': '#24375c', 'fog-color': '#0b1220', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.5, 'fog-ground-blend': 0.75, 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 12, 0] },
    },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }), 'bottom-left');

  const state = { mode: 'fresh', markers: [], labels: [] };

  map.on('load', () => {
    addLabels(map, state);
    const hide = () => { const el = document.getElementById('map-loading'); if (el) el.style.opacity = 0; };
    map.once('idle', hide); setTimeout(hide, 6000);
    loadVectors(map);
    loadSentinel2(map, state).finally(() => { if (onReady) onReady(); });
  });

  return {
    map,
    // Paint the terrain by fresh snow amount as a function of elevation: amounts = [[z, cm], ...]
    setFreshSnow(amounts) {
      state.mode = 'fresh'; map.setLayoutProperty('snowgrid', 'visibility', 'none');
      // classes: walk up in 5 m steps; each class boundary becomes a 5 m-wide colour step, below 1 cm the terrain tint
      const colorAt = z => { const k = snowClass(interp(amounts, z)); return k < 0 ? baseAt(z) : SNOW_CLASSES[k][1]; };
      const stops = []; let kPrev = null;
      for (let z = 400; z <= 3600; z += 5) {
        const k = snowClass(interp(amounts, z));
        if (k === kPrev) { if (k < 0 && z % 100 === 0) stops.push([z, baseAt(z)]); }
        else { if (kPrev !== null && stops.length && stops[stops.length - 1][0] !== z - 5) stops.push([z - 5, colorAt(z - 5)]); stops.push([z, colorAt(z)]); }
        kPrev = k;
      }
      if (stops[stops.length - 1][0] !== 3600) stops.push([3600, colorAt(3600)]);
      map.setPaintProperty('relief', 'color-relief-color', reliefExpr(stops));
      updateLabelValues(state, z => `${fmt(interp(amounts, z), 0)} cm`);
    },
    // Snow on the ground (cm) as a function of elevation: amounts = [[z, cm], ...]
    // grid (optional): depth by band × slope × aspect from the snowpack model, drawn pixel by pixel
    setSnowDepth(amounts, grid) {
      state.mode = 'depth';
      if (grid) {
        snowState.grid = grid; snowState.stamp++;
        map.getSource('snowgrid').setTiles([`snowgrid://{z}/{x}/{y}/${snowState.stamp}`]);
        map.setLayoutProperty('snowgrid', 'visibility', 'visible');
      } else map.setLayoutProperty('snowgrid', 'visibility', 'none');
      const stops = []; for (let z = 400; z <= 3600; z += 50) stops.push([z, depthColor(interp(amounts, z), z)]);
      // a thin glacier-blue line where the snow cover starts (1 cm)
      let zl = null; for (let z = 400; z < 3600; z += 5) if (interp(amounts, z) < 1 && interp(amounts, z + 5) >= 1) zl = z + 5;
      if (zl !== null) {
        const keep = stops.filter(([z]) => z < zl - 14 || z > zl + 14);
        keep.push([zl - 12, depthColor(0, zl)], [zl - 7, '#bfefff'], [zl + 7, '#bfefff'], [zl + 12, depthColor(Math.max(1, interp(amounts, zl + 12)), zl)]);
        stops.length = 0; keep.sort((a, b) => a[0] - b[0]).forEach(s => stops.push(s));
      }
      map.setPaintProperty('relief', 'color-relief-color', reliefExpr(stops));
      updateLabelValues(state, z => { const v = interp(amounts, z); return v < 0.5 ? (getLang() === 'fr' ? 'sans neige' : 'no snow') : `${fmt(v, 0)} cm`; });
    },
    // Snow line: terrain above the line in snow white, below in rain blue
    setSnowLine(lineZ) {
      state.mode = 'line'; map.setLayoutProperty('snowgrid', 'visibility', 'none');
      if (lineZ === null || lineZ === undefined) return;
      const stops = []; for (let z = 600; z <= 3400; z += 25) {
        const d = z - lineZ; const c = d < -60 ? window.d3.interpolateRgb(baseAt(z), '#1b4f8f')(0.55) : d > 60 ? window.d3.interpolateRgb(baseAt(z), '#dff3ff')(0.78) : '#ffd27a';
        stops.push([z, c]);
      }
      map.setPaintProperty('relief', 'color-relief-color', reliefExpr(stops));
      updateLabelValues(state, z => (z >= lineZ ? (getLang() === 'fr' ? 'neige' : 'snow') : (getLang() === 'fr' ? 'pluie' : 'rain')));
    },
    // Latest clear Sentinel-2 image (true colour), as an overlay on top of any snow layer
    setSatellite(on) {
      if (state.s2) map.setLayoutProperty('s2-rgb', 'visibility', on ? 'visible' : 'none');
    },
    get s2() { return state.s2; },
    setVisible(layer, on) {
      const ids = { buildings: ['buildings'], lifts: ['lifts', 'lifts-casing'], pistes: ['pistes', 'pistes-casing'], lidar: ['lidar'] }[layer] || [layer];
      ids.forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
    },
    set3D(on) {
      if (on) {
        map.setTerrain({ source: 'dem', exaggeration: 1.2 });
        map.easeTo({ pitch: 62, bearing: 292, zoom: 12.6, center: [6.2560, 45.2370], duration: 2200 });
      } else {
        map.setTerrain(null);
        map.easeTo({ pitch: 0, bearing: 0, duration: 1200 });
      }
    },
    orbit(on) {
      if (state.raf) cancelAnimationFrame(state.raf), state.raf = null;
      if (!on) return;
      const step = () => { map.setBearing(map.getBearing() + 0.08); state.raf = requestAnimationFrame(step); };
      step();
    },
  };
}


// Sentinel-2 snow map (20 m) and true-colour image, baked daily by the GitHub Action
async function loadSentinel2(map, state) {
  try {
    const r = await fetch('data/snow/s2.json', { cache: 'no-cache' }); if (!r.ok) return;
    const meta = await r.json(); const v = encodeURIComponent(meta.generated || '');
    map.addSource('s2rgb', { type: 'image', url: `data/snow/s2-rgb.jpg?v=${v}`, coordinates: meta.coordinates });
    map.addLayer({ id: 's2-rgb', type: 'raster', source: 's2rgb', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.9, 'raster-contrast': 0.1, 'raster-fade-duration': 0 } }, 'hillshade');
    state.s2 = meta;
  } catch (e) { /* no Sentinel-2 product yet */ }
}

function interp(pairs, z) {
  if (!pairs.length) return 0;
  if (z <= pairs[0][0]) return pairs[0][1];
  for (let i = 1; i < pairs.length; i++) if (z <= pairs[i][0]) { const [z0, v0] = pairs[i - 1], [z1, v1] = pairs[i]; return v0 + (v1 - v0) * (z - z0) / (z1 - z0); }
  return pairs[pairs.length - 1][1];
}

function addLabels(map, state) {
  for (const p of SITE.places) {
    const el = document.createElement('div');
    el.className = `map-label ${p.kind}`;
    el.innerHTML = `<div class="n">${p.name}</div><div class="z">${fmt(p.z)} m</div><div class="v" hidden></div>`;
    const mk = new maplibregl.Marker({ element: el, anchor: p.kind === 'peak' ? 'bottom' : 'center' }).setLngLat([p.lon, p.lat]).addTo(map);
    state.labels.push({ p, el, mk });
  }
}
function updateLabelValues(state, fn) {
  state.labels.forEach(({ p, el }) => {
    const v = el.querySelector('.v'); const txt = fn(p.z);
    if (txt === null || txt === undefined) { v.hidden = true; return; }
    v.hidden = false; v.textContent = txt;
  });
}

// Buildings and lifts (IGN BD TOPO), pistes (OpenStreetMap). Baked copies are used when present.
async function loadVectors(map) {
  const baked = async name => { try { const r = await fetch(`data/${name}`, { cache: 'no-cache' }); return r.ok ? r.json() : null; } catch (e) { return null; } };
  const wfs = (type, bbox, props) => `https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=${type}&SRSNAME=EPSG:4326&BBOX=${bbox},urn:ogc:def:crs:EPSG::4326&OUTPUTFORMAT=application/json&COUNT=5000${props ? '&PROPERTYNAME=' + props : ''}`;
  // Buildings
  (async () => {
    let fc = await baked('buildings.geojson');
    if (!fc) {
      try {
        const j = await (await fetch(wfs('BDTOPO_V3:batiment', '45.15,6.12,45.32,6.36', 'geometrie,hauteur,nombre_d_etages,usage_1'))).json();
        fc = { type: 'FeatureCollection', features: j.features.map(f => ({ type: 'Feature', geometry: f.geometry, properties: { h: f.properties.hauteur || (f.properties.nombre_d_etages ? f.properties.nombre_d_etages * 3 : 6), u: f.properties.usage_1 } })) };
      } catch (e) { console.warn('buildings', e); }
    }
    if (fc) map.getSource('buildings').setData(fc);
  })();
  // Lifts
  (async () => {
    let fc = await baked('lifts.geojson');
    if (!fc) {
      try {
        const j = await (await fetch(wfs('BDTOPO_V3:transport_par_cable', '45.15,6.12,45.32,6.37'))).json();
        fc = { type: 'FeatureCollection', features: j.features.map(f => ({ type: 'Feature', geometry: f.geometry, properties: { n: f.properties.toponyme, k: f.properties.nature } })) };
      } catch (e) { console.warn('lifts', e); }
    }
    if (fc) map.getSource('lifts').setData(fc);
  })();
  // Pistes (baked by the GitHub Action from OpenStreetMap; live Overpass as a fallback)
  (async () => {
    let fc = await baked('pistes.geojson');
    if (!fc) {
      try {
        const q = '[out:json][timeout:25];way["piste:type"="downhill"](45.15,6.12,45.32,6.37);out geom tags;';
        const j = await (await fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q))).json();
        fc = { type: 'FeatureCollection', features: j.elements.filter(e => e.geometry).map(e => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: e.geometry.map(g => [g.lon, g.lat]) }, properties: { d: e.tags['piste:difficulty'] || '', n: e.tags.name || '' } })) };
      } catch (e) { console.warn('pistes', e); }
    }
    if (fc) map.getSource('pistes').setData(fc);
  })();
}
