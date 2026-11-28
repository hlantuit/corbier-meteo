// Daily: ERA5 archive at the resort's base elevation and Météo-France snow depth -> data/<resort>/climate.json
// SITE_ID=<resort id> node scripts/update-climate.mjs for another resort (default: Le Corbier, data/climate.json).
import { createRequire } from 'node:module';
import { getJSON, log, writeJSON, fetchStationHourly } from './common.mjs';
import { SITE } from '../assets/js/config.js';
const require = createRequire(import.meta.url);
const Cc = require('./lib/climate-core.js');

const end = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${SITE.lat}&longitude=${SITE.lon}&elevation=${SITE.base.z}&start_date=1950-01-01&end_date=${end}&daily=snowfall_sum,temperature_2m_mean&models=era5_seamless&timezone=Europe%2FParis`;
const j = await getJSON(url);
log(SITE.name, 'archive days:', j.daily.time.length);
const C = Cc.buildClimate(j.daily, { elevation: SITE.base.z });

// Measured snow depth: Le Corbier's own observations (ski season), last four winters.
// Until this season's first report, the current winter comes from Saint-Jean-d'Arves (automatic, 4 km away).
const y = new Date().getUTCFullYear(); const since = `${y - 4}093023`;
const corbier = await fetchStationHourly('73318400', since);
const seasons = Cc.stationSeasons(corbier, 4).map(s => ({ ...s, current: false, source: 'nivo' }));
const curWinter = new Date().getUTCMonth() >= 7 ? y + 1 : y;
if (!seasons.some(s => s.winter === curWinter)) {
  const auto = await fetchStationHourly('73242003', `${curWinter - 1}093023`);
  const cur = Cc.stationSeasons(auto, 1).find(s => s.winter === curWinter);
  if (cur) seasons.push({ ...cur, source: 'auto' });
}
seasons.forEach(s => { s.current = s.winter === curWinter; });
C.station = { id: '73318400', name: 'Le Corbier', elev: 1585, seasons: seasons.slice(-4) };

const trim = a => a.slice(0, a.reduce((acc, v, i) => (v !== null ? i + 1 : acc), 0));
C.current = trim(C.current);
C.station.seasons.forEach(s => { s.values = trim(s.values); });
writeJSON(`data/${SITE.dataDir}climate.json`, C);
