// Monthly: buildings and lifts (IGN BD TOPO, WFS) and pistes (OpenStreetMap, Overpass) -> data/*.geojson
import { getJSON, log, writeJSON, sleep } from './common.mjs';

const BBOX = { s: 45.185, w: 6.185, n: 45.285, e: 6.330 };
const round = c => (Array.isArray(c[0]) ? c.map(round) : [+c[0].toFixed(6), +c[1].toFixed(6)]);

async function wfsAll(type, props) {
  const feats = []; let start = 0;
  for (;;) {
    const u = `https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=${type}&SRSNAME=EPSG:4326&BBOX=${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e},urn:ogc:def:crs:EPSG::4326&OUTPUTFORMAT=application/json&COUNT=5000&STARTINDEX=${start}${props ? '&PROPERTYNAME=' + props : ''}`;
    const j = await getJSON(u); feats.push(...j.features);
    if (j.features.length < 5000) break; start += 5000; await sleep(1000);
  }
  return feats;
}

try {
  const b = await wfsAll('BDTOPO_V3:batiment', 'geometrie,hauteur,nombre_d_etages,usage_1');
  writeJSON('data/buildings.geojson', { type: 'FeatureCollection', features: b.filter(f => f.geometry).map(f => ({ type: 'Feature', geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) }, properties: { h: f.properties.hauteur || (f.properties.nombre_d_etages ? f.properties.nombre_d_etages * 3 : 6), u: f.properties.usage_1 || null } })) });
} catch (e) { log('buildings failed', e); }

try {
  const l = await wfsAll('BDTOPO_V3:transport_par_cable');
  writeJSON('data/lifts.geojson', { type: 'FeatureCollection', features: l.filter(f => f.geometry).map(f => ({ type: 'Feature', geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) }, properties: { n: f.properties.toponyme || null, k: f.properties.nature || null } })) });
} catch (e) { log('lifts failed', e); }

const q = `[out:json][timeout:90];way["piste:type"="downhill"](${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e});out geom tags;`;
for (const ep of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']) {
  try {
    const j = await getJSON(`${ep}?data=${encodeURIComponent(q)}`, { tries: 2 });
    const feats = j.elements.filter(e => e.geometry).map(e => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: e.geometry.map(g => [+g.lon.toFixed(6), +g.lat.toFixed(6)]) }, properties: { d: e.tags['piste:difficulty'] || '', n: e.tags.name || '' } }));
    if (feats.length) { writeJSON('data/pistes.geojson', { type: 'FeatureCollection', features: feats }); break; }
  } catch (e) { log('overpass failed at', ep); }
}
