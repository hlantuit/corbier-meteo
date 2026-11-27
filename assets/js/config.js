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
  // Météo-France stations measuring snow depth within 25 km, used to calibrate the snow-on-the-ground map
  snowStations: [
    { id: '73318400', name: 'Le Corbier', elev: 1585, lat: 45.243333, lon: 6.266667, manual: true },
    { id: '73242003', name: "Saint-Jean-d'Arves", elev: 1573, lat: 45.206833, lon: 6.278833 },
    { id: '73280001', name: "Saint-Sorlin-d'Arves", elev: 1694, lat: 45.224, lon: 6.216333 },
    // nivo 07466, manual morning report at the top of the Choseaux chairlift (in season)
    { id: '73280402', name: "Saint-Sorlin 2 090 m", elev: 2090, lat: 45.217167, lon: 6.2025, manual: true },
    { id: '73013002', name: 'Albiez-Montrond', elev: 1633, lat: 45.210667, lon: 6.336333 },
    { id: '73307400', name: 'Valmeinier', elev: 1788, lat: 45.176, lon: 6.493833 },
    { id: '73257005', name: 'Val Thorens', elev: 2277, lat: 45.294, lon: 6.581 },
    { id: '73257001', name: 'Saint-Martin-de-Belleville', elev: 1443, lat: 45.368167, lon: 6.5105 },
  ],
  map: {
    center: [6.2520, 45.2440],
    zoom: 12.7,
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
    { name: 'Les Perrons', lat: 45.2090, lon: 6.1824, z: 2582, kind: 'peak' }, // snow observation site: top of the Trois Lacs chairlift (IGN RGE ALTI), not the Grand Perron summit
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
  obs: '#ffc65c', // measurements
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

// Skaping webcams. Panoramic cameras store a still every `step` minutes (Paris time, at minute `offset`)
// at skaping.s3…/<path>/<YYYY>/<MM>/<DD>/<size>/<HH>-<mm>.jpg (sizes: thumb 180 px, mini 360, small 480, large 720 high);
// the live camera publishes a continuously refreshed thumbnail of its video stream.
export const CAMS = [
  { id: 'live', page: 'https://www.skaping.com/le-corbier/live', fr: 'Le Corbier en direct', en: 'Le Corbier live', subFr: 'Front de neige · 1 550 m', subEn: 'Snow front · 1,550 m',
    thumb: 'https://skaping.quanteec.com/contents/encodings/live/cf855356-9237-4153-746c-7561-6665-64-8b60-d9205323f770d/thumbnail.jpg' },
  { id: 'front', page: 'https://www.skaping.com/le-corbier/front-de-neige', fr: 'Front de neige, panorama', en: 'Snow front, panorama', subFr: 'Le Corbier · 1 550 m', subEn: 'Le Corbier · 1,550 m', path: 'le-corbier/front-de-neige/panoramique', step: 30, offset: 1 },
  { id: 'pointe', page: 'https://www.skaping.com/les-sybelles/pointe-du-corbier', fr: 'Pointe du Corbier', en: 'Pointe du Corbier', subFr: '2 265 m · vue sur les Aiguilles d’Arves', subEn: '2,265 m · view of the Aiguilles d’Arves', path: 'les-sybelles/pointe-du-corbier', step: 10, offset: 0 },
  { id: 'ouillon', page: 'https://www.skaping.com/les-sybelles/ouillon', fr: 'L’Ouillon', en: 'L’Ouillon', subFr: '2 426 m · sommet des Sybelles', subEn: '2,426 m · top of Les Sybelles', path: 'les-sybelles/ouillon', step: 10, offset: 0 },
];
export const SKAPING_S3 = 'https://skaping.s3.gra.io.cloud.ovh.net/';

export const API = {
  forecast: 'https://api.open-meteo.com/v1/forecast',
  ensemble: 'https://ensemble-api.open-meteo.com/v1/ensemble',
  seasonal: 'https://seasonal-api.open-meteo.com/v1/seasonal',
  archive: 'https://archive-api.open-meteo.com/v1/archive',
  historical: 'https://historical-forecast-api.open-meteo.com/v1/forecast',
  tabular: 'https://tabular-api.data.gouv.fr/api/resources',
  ignWms: 'https://data.geopf.fr/wms-r',
  ignWmts: 'https://data.geopf.fr/wmts',
  ignVector: 'https://data.geopf.fr/tms/1.0.0/BDTOPO',
};
