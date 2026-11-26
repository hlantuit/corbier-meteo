// Site constants. Everything specific to Le Corbier lives here.
export const SITE = {
  name: 'Le Corbier',
  // Front de neige (resort centre)
  lat: 45.2406,
  lon: 6.2688,
  elev: 1550,
  tz: 'Europe/Paris',
  // Elevation levels shown in snow-by-altitude views
  levels: [
    { z: 1300, fr: 'Villarembert', en: 'Villarembert' },
    { z: 1550, fr: 'Le Corbier', en: 'Le Corbier' },
    { z: 1900, fr: 'Mi-pentes', en: 'Mid-slopes' },
    { z: 2265, fr: 'Pointe du Corbier', en: 'Pointe du Corbier' },
    { z: 2430, fr: "L'Ouillon", en: "L'Ouillon" },
  ],
  // Météo-France automatic stations used for observations and verification
  // Le Corbier: manual snow observations (06 and 12 UTC) during the ski season, at the resort itself.
  // Saint-Jean-d'Arves: automatic hourly station 4 km away, same elevation, all year (temperature, precipitation, snow depth).
  stations: [
    { id: '73318400', name: 'Le Corbier', elev: 1585, lat: 45.243333, lon: 6.266667, kind: 'nivo' },
    { id: '73242003', name: "Saint-Jean-d'Arves", elev: 1573, lat: 45.206833, lon: 6.278833, kind: 'auto' },
  ],
  map: {
    center: [6.2470, 45.2390],
    zoom: 13.5,
    bounds: [[6.02, 45.10], [6.52, 45.40]],
  },
  // Curated labels (positions from IGN BD TOPO, elevations from RGE ALTI)
  places: [
    { name: 'Le Corbier', lat: 45.2406, lon: 6.2688, z: 1555, kind: 'village' },
    { name: 'Villarembert', lat: 45.2464, lon: 6.2803, z: 1300, kind: 'hamlet' },
    { name: 'La Toussuire', lat: 45.2539, lon: 6.2589, z: 1707, kind: 'hamlet' },
    { name: "Saint-Jean-d'Arves", lat: 45.2065, lon: 6.2730, z: 1534, kind: 'hamlet' },
    { name: "Saint-Sorlin-d'Arves", lat: 45.2208, lon: 6.2285, z: 1526, kind: 'hamlet' },
    { name: 'Pointe du Corbier', lat: 45.2343, lon: 6.2434, z: 2265, kind: 'peak' },
    { name: "L'Ouillon", lat: 45.2395, lon: 6.2150, z: 2426, kind: 'peak' },
    { name: 'Le Grand Truc', lat: 45.2743, lon: 6.2564, z: 2206, kind: 'peak' },
    { name: 'Les Bottières', lat: 45.2672, lon: 6.2984, z: 1267, kind: 'hamlet' },
    { name: 'Saint-Colomban-des-Villards', lat: 45.2941, lon: 6.2268, z: 1100, kind: 'hamlet' },
  ],
};

// Hourly lapse rate used to move model temperatures between elevations (K per m)
export const LAPSE = -0.0065;

// Tabular API resources of Météo-France hourly data for département 73 (data.gouv.fr)
export const MF_RESOURCES = {
  latest: '7c18ae09-a2bb-49f5-9f0d-990bc8df78ef',
  previous: '10fcc3fa-d8cf-4b5d-bdda-e758939defdf',
};

// Models shown in the live comparison. Colours follow the model, never its rank
// (validated categorical palette, dark surface #0f1726).
export const MODELS = [
  { id: 'meteofrance_arome_france_hd', short: 'AROME HD', res: '1,3 km', org: 'Météo-France', color: '#338ced', hiRes: true, hours: 51 },
  { id: 'ecmwf_ifs', short: 'IFS', res: '9 km', org: 'ECMWF', color: '#e76624', hiRes: false, hours: 360 },
  { id: 'meteoswiss_icon_seamless', short: 'ICON-CH', res: '1–2 km', org: 'MétéoSuisse', color: '#00a888', hiRes: true, hours: 120, verifyAs: ['meteoswiss_icon_ch1', 'meteoswiss_icon_ch2'] },
  { id: 'ecmwf_aifs025_single', short: 'AIFS', res: '25 km (IA)', org: 'ECMWF', color: '#d28e05', hiRes: false, hours: 360 },
  { id: 'icon_d2', short: 'ICON-D2', res: '2 km', org: 'DWD', color: '#e24d8b', hiRes: true, hours: 48 },
  { id: 'meteofrance_arpege_europe', short: 'ARPEGE', res: '11 km', org: 'Météo-France', color: '#0aac23', hiRes: false, hours: 102 },
  { id: 'ukmo_global_deterministic_10km', short: 'UKMO', res: '10 km', org: 'Met Office', color: '#9887ef', hiRes: false, hours: 168 },
  { id: 'gfs_seamless', short: 'GFS', res: '13–25 km', org: 'NOAA', color: '#eb6263', hiRes: false, hours: 384 },
  // Used in the consensus (they score well locally) but drawn as neutral lines in the comparison
  { id: 'italia_meteo_arpae_icon_2i', short: 'ICON-2I', res: '2 km', org: 'ItaliaMeteo', color: null, hiRes: true, hours: 72, extra: true },
  { id: 'icon_eu', short: 'ICON-EU', res: '7 km', org: 'DWD', color: null, hiRes: false, hours: 120, extra: true },
];

export const ENSEMBLES = [
  { id: 'ecmwf_ifs025_ensemble', short: 'ECMWF ENS', members: 51, days: 15 },
  { id: 'ncep_gefs025', short: 'NOAA GEFS', members: 31, days: 16 },
];

export const COLORS = {
  ink: '#eaf1fb',
  ink2: '#93a3b8',
  ink3: '#5e6e85',
  grid: '#1c2a40',
  axis: '#2b3b55',
  surface: '#0f1726',
  snow: '#dff3ff',
  snowDeep: '#7fd4ff',
  rain: '#3e8ef7',
  mixed: '#9fb8ff',
  warm: '#ff7a59',
  cold: '#5aa9ff',
  sun: '#ffc861',
  consensus: '#ffffff',
};

export const API = {
  forecast: 'https://api.open-meteo.com/v1/forecast',
  ensemble: 'https://ensemble-api.open-meteo.com/v1/ensemble',
  seasonal: 'https://seasonal-api.open-meteo.com/v1/seasonal',
  archive: 'https://archive-api.open-meteo.com/v1/archive',
  tabular: 'https://tabular-api.data.gouv.fr/api/resources',
  ignWms: 'https://data.geopf.fr/wms-r',
  ignWmts: 'https://data.geopf.fr/wmts',
  ignVector: 'https://data.geopf.fr/tms/1.0.0/BDTOPO',
  gibs: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best',
};
