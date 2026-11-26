// Relief map (2D and 3D) built only from free IGN services, OpenStreetMap and NASA GIBS.
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

async function demTile(params, abort) {
  const [z, x, y] = params.url.replace('igndem://', '').split('/').map(Number);
  const b = tileBBox3857(z, x, y);
  const url = `${API.ignWms}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES&STYLES=&FORMAT=image/geotiff&CRS=EPSG:3857&BBOX=${b.join(',')}&WIDTH=${DEM_SIZE}&HEIGHT=${DEM_SIZE}`;
  const r = await fetch(url, { signal: abort.signal });
  if (!r.ok) throw new Error('DEM ' + r.status);
  const { W, H, data } = readTiffFloat32(await r.arrayBuffer());
  dedupe(data, W, H); blur(data, W, H, 2, 1);
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

// ---------- palettes ----------
// Base terrain tint by elevation (night-alpine), used when no snow information is drawn
const BASE_STOPS = [[700, '#0c1424'], [1100, '#111c31'], [1500, '#16233b'], [1900, '#1c2c47'], [2300, '#253855'], [2800, '#2f4565'], [3400, '#3a5275']];
// Fresh snow ramp (cm): from the terrain tint to glacier blue to white
export const SNOW_RAMP = [[0, null], [1, '#1d3a5f'], [5, '#2370cd'], [10, '#519ced'], [20, '#84b9f3'], [35, '#b6d5f8'], [60, '#dff3ff'], [100, '#ffffff']];

function baseAt(z) {
  for (let i = 1; i < BASE_STOPS.length; i++) if (z <= BASE_STOPS[i][0]) {
    const [z0, c0] = BASE_STOPS[i - 1], [z1, c1] = BASE_STOPS[i];
    return window.d3.interpolateRgb(c0, c1)((z - z0) / (z1 - z0));
  }
  return BASE_STOPS[BASE_STOPS.length - 1][1];
}
function snowColor(cm, z) {
  if (!(cm > 0.5)) return baseAt(z);
  for (let i = 2; i < SNOW_RAMP.length; i++) if (cm <= SNOW_RAMP[i][0]) {
    const [a, ca] = SNOW_RAMP[i - 1], [b, cb] = SNOW_RAMP[i];
    const c0 = ca || baseAt(z);
    return window.d3.interpolateRgb(c0, cb)((cm - a) / (b - a));
  }
  return '#ffffff';
}
const reliefExpr = stops => ['interpolate', ['linear'], ['elevation'], ...stops.flatMap(([z, c]) => [z, c])];

// ---------- map ----------
export function createMap(container, { onReady } = {}) {
  maplibregl.addProtocol('igndem', demTile);
  const lidar = `${API.ignWmts}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png`;
  const bounds = SITE.map.bounds.flat();
  const map = new maplibregl.Map({
    container, attributionControl: false, maxPitch: 78,
    center: SITE.map.center, zoom: SITE.map.zoom, minZoom: 11.5, maxZoom: 17.5,
    maxBounds: [[bounds[0] - 0.05, bounds[1] - 0.04], [bounds[2] + 0.05, bounds[3] + 0.04]],
    style: {
      version: 8,
      sources: {
        dem: { type: 'raster-dem', tiles: ['igndem://{z}/{x}/{y}'], tileSize: DEM_SIZE, encoding: 'mapbox', minzoom: 10, maxzoom: 14, bounds },
        lidar: { type: 'raster', tiles: [lidar], tileSize: 256, minzoom: 12, maxzoom: 17, bounds },
        modis: { type: 'raster', tiles: [`${API.gibs}/MODIS_Terra_NDSI_Snow_Cover/default/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`], tileSize: 256, maxzoom: 8 },
        viirs: { type: 'raster', tiles: [`${API.gibs}/VIIRS_SNPP_NDSI_Snow_Cover/default/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`], tileSize: 256, maxzoom: 8 },
        buildings: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        lifts: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        pistes: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#0b1220' } },
        { id: 'relief', type: 'color-relief', source: 'dem', paint: { 'color-relief-color': reliefExpr(BASE_STOPS), 'color-relief-opacity': 1 } },
        { id: 'snow-sat', type: 'raster', source: 'viirs', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.75, 'raster-resampling': 'linear', 'raster-saturation': -1, 'raster-brightness-min': 0.35 } },
        { id: 'hillshade', type: 'hillshade', source: 'dem', paint: {
          'hillshade-method': 'igor', 'hillshade-exaggeration': 0.75, 'hillshade-illumination-direction': 315, 'hillshade-illumination-anchor': 'map',
          'hillshade-shadow-color': 'rgba(2,5,12,0.85)', 'hillshade-highlight-color': 'rgba(220,235,255,0.42)', 'hillshade-accent-color': 'rgba(0,0,0,0.25)' } },
        { id: 'lidar', type: 'raster', source: 'lidar', minzoom: 13, layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.55, 'raster-brightness-max': 0.75, 'raster-contrast': 0.25 } },
        { id: 'pistes', type: 'line', source: 'pistes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
          'line-color': ['match', ['get', 'd'], 'novice', '#3ddc97', 'easy', '#3ddc97', 'intermediate', '#4aa3ff', 'advanced', '#ff5d5d', 'expert', '#9aa7b8', 'freeride', '#ffb547', '#4aa3ff'],
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
      state.mode = 'fresh';
      const stops = []; for (let z = 600; z <= 3400; z += 50) stops.push([z, snowColor(interp(amounts, z), z)]);
      map.setPaintProperty('relief', 'color-relief-color', reliefExpr(stops));
      hideSat(map, state);
      updateLabelValues(state, z => `${fmt(interp(amounts, z), 0)} cm`);
    },
    // Snow line: terrain above the line in snow white, below in rain blue
    setSnowLine(lineZ) {
      state.mode = 'line';
      if (lineZ === null || lineZ === undefined) return;
      const stops = []; for (let z = 600; z <= 3400; z += 25) {
        const d = z - lineZ; const c = d < -60 ? window.d3.interpolateRgb(baseAt(z), '#1b4f8f')(0.55) : d > 60 ? window.d3.interpolateRgb(baseAt(z), '#dff3ff')(0.78) : '#ffd27a';
        stops.push([z, c]);
      }
      map.setPaintProperty('relief', 'color-relief-color', reliefExpr(stops));
      hideSat(map, state);
      updateLabelValues(state, z => (z >= lineZ ? (getLang() === 'fr' ? 'neige' : 'snow') : (getLang() === 'fr' ? 'pluie' : 'rain')));
    },
    setSatelliteSnow() {
      state.mode = 'now';
      map.setPaintProperty('relief', 'color-relief-color', reliefExpr(BASE_STOPS));
      if (state.s2) { ['s2-rgb', 's2-snow'].forEach(id => map.setLayoutProperty(id, 'visibility', 'visible')); }
      else map.setLayoutProperty('snow-sat', 'visibility', 'visible');
      updateLabelValues(state, () => null);
    },
    get s2() { return state.s2; },
    setVisible(layer, on) {
      const ids = { buildings: ['buildings'], lifts: ['lifts', 'lifts-casing'], pistes: ['pistes'], lidar: ['lidar'] }[layer] || [layer];
      ids.forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
    },
    set3D(on) {
      if (on) {
        map.setTerrain({ source: 'dem', exaggeration: 1.2 });
        map.easeTo({ pitch: 62, bearing: 292, zoom: 13.25, center: [6.2560, 45.2370], duration: 2200 });
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

function hideSat(map, state) {
  map.setLayoutProperty('snow-sat', 'visibility', 'none');
  if (state.s2) ['s2-rgb', 's2-snow'].forEach(id => map.setLayoutProperty(id, 'visibility', 'none'));
}

// Sentinel-2 snow map (20 m) and true-colour image, baked daily by the GitHub Action
async function loadSentinel2(map, state) {
  try {
    const r = await fetch('data/snow/s2.json', { cache: 'no-cache' }); if (!r.ok) return;
    const meta = await r.json(); const v = encodeURIComponent(meta.generated || '');
    map.addSource('s2rgb', { type: 'image', url: `data/snow/s2-rgb.jpg?v=${v}`, coordinates: meta.coordinates });
    map.addSource('s2snow', { type: 'image', url: `data/snow/s2-snow.png?v=${v}`, coordinates: meta.coordinates });
    map.addLayer({ id: 's2-rgb', type: 'raster', source: 's2rgb', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.9, 'raster-contrast': 0.1, 'raster-fade-duration': 0 } }, 'hillshade');
    map.addLayer({ id: 's2-snow', type: 'raster', source: 's2snow', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.55, 'raster-fade-duration': 0 } }, 'pistes');
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
        const j = await (await fetch(wfs('BDTOPO_V3:batiment', '45.195,6.195,45.305,6.315', 'geometrie,hauteur,nombre_d_etages,usage_1'))).json();
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
        const j = await (await fetch(wfs('BDTOPO_V3:transport_par_cable', '45.17,6.17,45.30,6.37'))).json();
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
        const q = '[out:json][timeout:25];way["piste:type"="downhill"](45.17,6.17,45.30,6.37);out geom tags;';
        const j = await (await fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q))).json();
        fc = { type: 'FeatureCollection', features: j.elements.filter(e => e.geometry).map(e => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: e.geometry.map(g => [g.lon, g.lat]) }, properties: { d: e.tags['piste:difficulty'] || '', n: e.tags.name || '' } })) };
      } catch (e) { console.warn('pistes', e); }
    }
    if (fc) map.getSource('pistes').setData(fc);
  })();
}
