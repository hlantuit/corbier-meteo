// Daily: ERA5 / ERA5-Land archive at 1 550 m and Météo-France snow depth -> data/climate.json
import { createRequire } from 'node:module';
import { getJSON, log, writeJSON, fetchStationHourly } from './common.mjs';
const require = createRequire(import.meta.url);
const Cc = require('./lib/climate-core.js');

const end = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const url = `https://archive-api.open-meteo.com/v1/archive?latitude=45.2406&longitude=6.2688&elevation=1550&start_date=1950-01-01&end_date=${end}&daily=snowfall_sum,temperature_2m_mean&models=era5_seamless&timezone=Europe%2FParis`;
const j = await getJSON(url);
log('archive days:', j.daily.time.length);
const C = Cc.buildClimate(j.daily);

// Station snow depth: the last four winters
const y = new Date().getUTCFullYear(); const since = `${y - 4}093023`;
const hourly = await fetchStationHourly('73242003', since);
C.station = { id: '73242003', name: "Saint-Jean-d'Arves", elev: 1573, seasons: Cc.stationSeasons(hourly, 4) };

const trim = a => a.slice(0, a.reduce((acc, v, i) => (v !== null ? i + 1 : acc), 0));
C.current = trim(C.current);
C.station.seasons.forEach(s => { s.values = trim(s.values); });
writeJSON('data/climate.json', C);
