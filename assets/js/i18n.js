// Strings in French (default) and English. Keys are used through t('key') and data-i18n attributes.
const STR = {
  fr: {
    'brand.sub': 'Observatoire neige & météo · Les Sybelles, Savoie',
    'nav.now': 'Maintenant', 'nav.48h': '48 h', 'nav.15d': '15 jours', 'nav.models': 'Modèles', 'nav.season': 'Saison', 'nav.cams': 'Webcams', 'nav.archive': 'Archives',
    'now.title': 'Le Corbier, maintenant',
    'now.observed': 'Observé', 'now.forecast': 'Prévu',
    'now.temp': 'Température', 'now.snowDepth': 'Neige au sol', 'now.snowline': 'Limite pluie-neige', 'now.fzl': 'Isotherme 0 °C', 'now.wind': 'Vent', 'now.next': 'Prochaine neige',
    'now.station': 'Relevés Météo-France du Corbier, 1 585 m',
    'now.updated': 'mesure de', 'now.none7d': 'rien de significatif sur 7 jours',
    'map.layers': 'Couches', 'map.relief': 'Relief LiDAR', 'map.snowNow': 'Neige au sol (satellite)', 'map.snowFc': 'Neige fraîche prévue', 'map.snowline': 'Limite pluie-neige',
    'map.buildings': 'Bâtiments', 'map.lifts': 'Remontées', 'map.pistes': 'Pistes', 'map.3d': '3D', 'map.2d': '2D', 'map.orbit': 'Survol',
    'map.horizon': 'Cumul', 'map.hour': 'Heure', 'map.loading': 'Chargement du relief IGN…',
    'map.snowNowNote': 'MODIS/VIIRS (NASA), 500 m, dernière image sans nuages', 'map.s2Note': 'Sentinel-2, 20 m',
    'h48.title': 'Les 48 prochaines heures', 'h48.lead': 'Dix modèles corrigés de leur biais local et pondérés selon leur score ici : les modèles à maille kilométrique (AROME HD, ICON-CH, ICON-D2, ICON-2I) pèsent le plus sur ces deux jours.',
    'h48.temp': 'Température', 'h48.precip': 'Précipitations à 1 550 m', 'h48.snowline': 'Limite pluie-neige et isotherme 0 °C', 'h48.wind': 'Vent et rafales à 1 550 m', 'h48.cloud': 'Nuages',
    'alt.title': 'Neige fraîche par altitude', 'alt.lead': 'Cumul attendu selon l’altitude, à partir de la limite pluie-neige de chaque modèle et d’une densité de neige qui dépend de la température.',
    'd15.title': 'Les 15 prochains jours', 'd15.lead': '51 scénarios ECMWF : la dispersion dit à quel point la prévision est fiable.',
    'd15.temp': 'Température à 1 550 m — 51 membres', 'd15.daily': 'Neige fraîche par jour à 1 550 m', 'd15.cum': 'Cumul de neige fraîche à 1 550 m', 'd15.prob': 'Probabilités sur 7 jours',
    'models.title': 'Quel modèle croire, et quand ?', 'models.lead': 'Chaque modèle confronté aux mesures Météo-France depuis l’hiver 2024-25, échéance par échéance : les relevés de neige fraîche du Corbier (1 585 m) pour la neige, la station automatique de Saint-Jean-d’Arves (1 573 m, à 4 km) pour la température et les précipitations, que Le Corbier ne mesure pas heure par heure.',
    'models.compare': 'Comparateur', 'models.verif': 'Score local par échéance',
    'models.var.temp': 'Température', 'models.var.precip': 'Précipitations', 'models.var.snow': 'Neige fraîche', 'models.var.snowline': 'Limite pluie-neige',
    'season.title': 'Semaines et saison', 'season.lead': 'Au-delà de 15 jours, on ne prévoit plus le temps mais des écarts à la normale.',
    'season.weekly': 'Semaines 1 à 6 — écart à la normale (ECMWF EC46)', 'season.monthly': 'Mois à venir — écart à la normale (ECMWF SEAS5)',
    'cams.title': 'Webcams', 'cams.lead': 'Les quatre caméras du domaine, en direct (Skaping).',
    'archive.title': 'Archives et réanalyse', 'archive.lead': 'La saison en cours replacée dans 75 hivers de réanalyse ERA5-Land et dans les mesures Météo-France.',
    'archive.cum': 'Cumul de neige depuis le 1ᵉʳ novembre à 1 550 m', 'archive.depth': 'Hauteur de neige mesurée au Corbier (1 585 m)', 'archive.stripes': 'Hivers à 1 550 m, 1950 → aujourd’hui', 'archive.totals': 'Neige tombée par hiver (nov.–avr.)',
    'unit.cm': 'cm', 'unit.mm': 'mm', 'unit.m': 'm', 'unit.kmh': 'km/h',
    'leg.consensus': 'Consensus pondéré', 'leg.range': 'Écart entre modèles', 'leg.snow': 'Neige', 'leg.rain': 'Pluie', 'leg.mixed': 'Pluie et neige', 'leg.members': 'Membres', 'leg.median': 'Médiane', 'leg.p1090': '10 – 90 %', 'leg.p2575': '25 – 75 %',
    'leg.thisSeason': 'Saison en cours', 'leg.normal': 'Médiane 1991–2020', 'leg.obs': 'Mesuré',
    'misc.today': "Aujourd'hui", 'misc.tomorrow': 'Demain', 'misc.lead': 'Échéance', 'misc.day': 'J', 'misc.days': 'jours', 'misc.hours': 'h', 'misc.loading': 'Chargement…', 'misc.error': 'Données indisponibles pour le moment.',
    'misc.prob': 'Probabilité', 'misc.atLeast': 'au moins', 'misc.weights': 'Poids dans le consensus', 'misc.table': 'Voir le tableau', 'misc.chart': 'Voir le graphique',
    'foot.sources': 'Sources', 'foot.method': 'Méthodes',
  },
  en: {
    'brand.sub': 'Snow & weather observatory · Les Sybelles, Savoie',
    'nav.now': 'Now', 'nav.48h': '48 h', 'nav.15d': '15 days', 'nav.models': 'Models', 'nav.season': 'Season', 'nav.cams': 'Webcams', 'nav.archive': 'Archive',
    'now.title': 'Le Corbier, right now',
    'now.observed': 'Observed', 'now.forecast': 'Forecast',
    'now.temp': 'Temperature', 'now.snowDepth': 'Snow on the ground', 'now.snowline': 'Rain–snow line', 'now.fzl': 'Freezing level', 'now.wind': 'Wind', 'now.next': 'Next snowfall',
    'now.station': 'Météo-France observations at Le Corbier, 1,585 m',
    'now.updated': 'measured', 'now.none7d': 'nothing significant within 7 days',
    'map.layers': 'Layers', 'map.relief': 'LiDAR relief', 'map.snowNow': 'Snow cover (satellite)', 'map.snowFc': 'Forecast fresh snow', 'map.snowline': 'Rain–snow line',
    'map.buildings': 'Buildings', 'map.lifts': 'Lifts', 'map.pistes': 'Pistes', 'map.3d': '3D', 'map.2d': '2D', 'map.orbit': 'Fly around',
    'map.horizon': 'Total', 'map.hour': 'Time', 'map.loading': 'Loading IGN terrain…',
    'map.snowNowNote': 'MODIS/VIIRS (NASA), 500 m, latest cloud-free image', 'map.s2Note': 'Sentinel-2, 20 m',
    'h48.title': 'The next 48 hours', 'h48.lead': 'Ten models, each corrected for its local bias and weighted by its score here: the kilometre-scale models (AROME HD, ICON-CH, ICON-D2, ICON-2I) carry the most weight over these two days.',
    'h48.temp': 'Temperature', 'h48.precip': 'Precipitation at 1,550 m', 'h48.snowline': 'Rain–snow line and freezing level', 'h48.wind': 'Wind and gusts at 1,550 m', 'h48.cloud': 'Clouds',
    'alt.title': 'Fresh snow by elevation', 'alt.lead': 'Expected totals by elevation, from each model’s rain–snow line and a temperature-dependent snow density.',
    'd15.title': 'The next 15 days', 'd15.lead': '51 ECMWF scenarios: the spread tells you how much to trust the forecast.',
    'd15.temp': 'Temperature at 1,550 m — 51 members', 'd15.daily': 'Daily fresh snow at 1,550 m', 'd15.cum': 'Accumulated fresh snow at 1,550 m', 'd15.prob': 'Chances over 7 days',
    'models.title': 'Which model to trust, and when?', 'models.lead': 'Every model checked against Météo-France measurements since winter 2024-25, lead time by lead time: fresh-snow observations at Le Corbier (1,585 m) for snow, and the automatic station at Saint-Jean-d’Arves (1,573 m, 4 km away) for temperature and precipitation, which Le Corbier does not measure hourly.',
    'models.compare': 'Comparison', 'models.verif': 'Local score by lead time',
    'models.var.temp': 'Temperature', 'models.var.precip': 'Precipitation', 'models.var.snow': 'Fresh snow', 'models.var.snowline': 'Rain–snow line',
    'season.title': 'Weeks and season', 'season.lead': 'Beyond 15 days we no longer forecast the weather, only departures from normal.',
    'season.weekly': 'Weeks 1 to 6 — departure from normal (ECMWF EC46)', 'season.monthly': 'Coming months — departure from normal (ECMWF SEAS5)',
    'cams.title': 'Webcams', 'cams.lead': 'The four cameras of the ski area, live (Skaping).',
    'archive.title': 'Archive and reanalysis', 'archive.lead': 'This season set against 75 winters of ERA5-Land reanalysis and Météo-France measurements.',
    'archive.cum': 'Snowfall since 1 November at 1,550 m', 'archive.depth': 'Measured snow depth at Le Corbier (1,585 m)', 'archive.stripes': 'Winters at 1,550 m, 1950 → today', 'archive.totals': 'Snowfall per winter (Nov–Apr)',
    'unit.cm': 'cm', 'unit.mm': 'mm', 'unit.m': 'm', 'unit.kmh': 'km/h',
    'leg.consensus': 'Weighted consensus', 'leg.range': 'Model spread', 'leg.snow': 'Snow', 'leg.rain': 'Rain', 'leg.mixed': 'Rain and snow', 'leg.members': 'Members', 'leg.median': 'Median', 'leg.p1090': '10 – 90 %', 'leg.p2575': '25 – 75 %',
    'leg.thisSeason': 'This season', 'leg.normal': '1991–2020 median', 'leg.obs': 'Measured',
    'misc.today': 'Today', 'misc.tomorrow': 'Tomorrow', 'misc.lead': 'Lead time', 'misc.day': 'D', 'misc.days': 'days', 'misc.hours': 'h', 'misc.loading': 'Loading…', 'misc.error': 'Data unavailable right now.',
    'misc.prob': 'Probability', 'misc.atLeast': 'at least', 'misc.weights': 'Weight in the consensus', 'misc.table': 'Show table', 'misc.chart': 'Show chart',
    'foot.sources': 'Sources', 'foot.method': 'Methods',
  },
};

let lang = 'fr';
try { const saved = localStorage.getItem('corbier.lang'); if (saved === 'en' || saved === 'fr') lang = saved; } catch (e) { /* private mode */ }

export function getLang() { return lang; }
export function setLang(l) {
  lang = l; try { localStorage.setItem('corbier.lang', l); } catch (e) { /* ignore */ }
  document.documentElement.lang = l; applyStatic();
  window.dispatchEvent(new CustomEvent('langchange', { detail: l }));
}
export function t(key) { return (STR[lang] && STR[lang][key]) || STR.fr[key] || key; }
export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
}

// Number and date formatting
export function fmt(v, digits = 0) {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  const f = 10 ** digits; v = Math.round(v * f) / f; if (Object.is(v, -0) || v === 0) v = 0;
  return new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
}
export function locale() { return lang === 'fr' ? 'fr-FR' : 'en-GB'; }
export function fmtDay(d, opts = { weekday: 'short', day: 'numeric' }) {
  return new Intl.DateTimeFormat(locale(), { ...opts, timeZone: 'Europe/Paris' }).format(d);
}
export function fmtTime(d) {
  return new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(d);
}
