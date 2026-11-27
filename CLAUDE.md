# CLAUDE.md — Le Corbier snow & weather observatory

Read this first. It is the full hand-over of the project; the code comments say the rest.

## What this is

A personal, public snow and weather dashboard for **Le Corbier (Les Sybelles, Savoie, 73300)**, hosted on GitHub Pages:

- Site: https://hlantuit.github.io/corbier-meteo/
- Repo: https://github.com/hlantuit/corbier-meteo (branch `main`, Pages deploys from `main` / root, no build step)
- Local folder on the owner's PC: `C:\Users\hlantuit\Desktop\Projects\corbier-meteo`

The owner is a permafrost / Arctic scientist (AWI): fine to be technical, keep messages short, ask before big
redesigns. He reads the site in French; FR is the default language, EN via a toggle.

## Non-negotiables

- **Free and open data only.** No paid APIs, no keys in the page. The only secret is the ECMWF Data Store key,
  stored as the Actions secret `ECMWF_DATASTORE_KEY` (used by `scripts/update_seasonal_c3s.py`). Never print it.
- **Look:** "super pretty", modern, dark alpine theme; must not look like GitHub or a default AI page.
  Charts follow a validated categorical palette on the dark surface `#0f1726`:
  `#338ced, #e76624, #00a888, #d28e05, #e24d8b, #0aac23, #9887ef, #eb6263`; no dual axes; legends for ≥2 series;
  measurements are amber `COLORS.obs = #ffc65c`.
- **Bilingual:** every user-facing string has FR and EN (`assets/js/i18n.js` or inline `fr() ? … : …`).
- **Measurements at Le Corbier first**, Saint-Jean-d'Arves only as fallback (see Stations).

## Working rules for Claude Code

1. Before changing anything: `git pull --rebase` (a bot commits data to `main` every hour).
2. After every change to `assets/` or `index.html`: run `sh scripts/bump-version.sh`
   (stamps `?v=…` on the CSS/JS URLs and in the import map, so browsers never mix old and new modules).
3. Check syntax: `node --check assets/js/*.js scripts/*.mjs`.
4. Render test (offline, fixtures for every external service): see Testing below.
5. Commit with a clear message, then `git pull --rebase && git push`. Pages republishes in 1–2 minutes.
6. Then verify the live site (Playwright or a browser) — the page must load without console errors.
7. Never commit secrets, `node_modules/`, `_probe/`, `__pycache__/`. `data/` is normally written by the workflow.

## Architecture (static site, ES modules, no bundler)

```
index.html              page skeleton, import map (version stamps), sections: bulletin, hero map, 48 h, 15 days,
                        models, season, webcams, archive, footer
assets/css/app.css      all styling (dark theme vars at top; responsive breakpoints 1100 / 760 px)
assets/js/app.js        orchestration: fetch → compute → render; map wiring, 14-day strip, bulletin, webcams,
                        auto-refresh every 30 min while the page is visible
assets/js/config.js     SITE (coords, levels, stations, snowStations, map, places), MODELS, CAMS, API endpoints, COLORS
assets/js/data.js       fetchers + physics (wet-bulb, snow fraction, Hedstrom–Pomeroy density), calibration,
                        multi-model consensus, ensemble stats, Météo-France obs, history for the snowpack
assets/js/snowpack.js   snowpack model (bands × slope/aspect classes), fit to stations, nudging, sunshine ratios
assets/js/bulletin.js   digest of the forecast + rule-based FR/EN bulletin (also used by the Action)
assets/js/charts.js     D3 charts (meteogram, altitude bars, ensemble daily/temp/cum, comparator, verification
                        heatmap, seasonal anomalies, archive charts, winter stripes)
assets/js/map.js        MapLibre map: IGN DEM decoding, relief colouring, snow-depth raster, vectors, 3D
assets/js/i18n.js       strings FR/EN, fmt helpers, language toggle (localStorage 'corbier.lang')
assets/js/package.json  {"type":"module"} so Node scripts can import the browser modules
vendor/                 maplibre-gl 5.24.1, d3 v7 (vendored)
scripts/                Node/Python jobs run by the workflow (see Workflow)
tests/                  Playwright render test with fixtures, offline bulletin test
data/                   baked JSON/GeoJSON/images written by the workflow
```

## Data sources (all free, CORS-enabled for the browser unless noted)

- **Open-Meteo forecast** `api.open-meteo.com/v1/forecast`, `elevation=1550`, `past_days=2`, `forecast_days=16`,
  `timeformat=unixtime`. Models (verified ids): `meteofrance_arome_france_hd` (no snowfall/freezing level),
  `ecmwf_ifs` (9 km), `meteoswiss_icon_seamless` (CH1 then CH2), `ecmwf_aifs025_single`, `icon_d2`,
  `meteofrance_arpege_europe`, `ukmo_global_deterministic_10km`, `gfs_seamless`, extras grey:
  `italia_meteo_arpae_icon_2i`, `icon_eu`. ICON family provides `snowfall_height` and `freezing_level_height`.
- **Open-Meteo historical forecast** `historical-forecast-api.open-meteo.com/v1/forecast` — models' own analyses
  since 1 October (`icon_seamless, meteofrance_seamless, ecmwf_ifs025`, averaged) → drives the snowpack past.
- **Ensemble** `ensemble-api…` `ecmwf_ifs025_ensemble`, 51 members, 15 days (no freezing level).
- **Seasonal** `seasonal-api…`: weekly EC46 `ecmwf_ec46_ensemble_mean` with `temperature_2m_anomaly`,
  `precipitation_anomaly`, `snowfall_anomaly` (no `_mean_anomaly`); monthly SEAS5 `ecmwf_seas5_ensemble_mean`
  (+ `snow_depth_anomaly`).
- **Archive** `archive-api…` `era5_seamless` (ERA5-Land on Open-Meteo has no precip/snow).
- **Previous Runs API** `previous-runs-api.open-meteo.com` (`_previous_dayN`; day 0 = plain variable name);
  rate limit ≈ 600 weighted calls/min → scripts pace 20–25 s between models.
- **Météo-France hourly observations** via data.gouv tabular API
  `tabular-api.data.gouv.fr/api/resources/<id>/data/` — resources: latest `7c18ae09-a2bb-49f5-9f0d-990bc8df78ef`
  (2025–2026), previous `10fcc3fa-d8cf-4b5d-bdda-e758939defdf`. `page_size` ≤ 200, use `page=` for more;
  filters `NUM_POSTE__exact`, `NUM_POSTE__in`, `AAAAMMJJHH__in`, `AAAAMMJJHH__sort`. `AAAAMMJJHH` comes back as a
  NUMBER → `String()` it. Fields: `T`, `RR1`, `NEIGETOT` (snow depth cm), `HNEIGEF` (fresh snow), `FF`, `FXI`, `DD`.
  Data lag is typically 15–27 h. The resource ids may change when Météo-France rolls the yearly files.
- **IGN Géoplateforme**: WMS-R float32 GeoTIFF DEM `ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES` (decoded in the
  browser; nearest-neighbour duplicate rows are de-duplicated + light blur), WMTS LiDAR HD shading, WFS BD TOPO
  (`batiment`, `transport_par_cable`), altimetry API, geocoder.
- **OpenStreetMap / Overpass** for pistes.
- **Sentinel-2 L2A** COGs via Earth Search STAC (AWS, no account) — optional true-colour overlay only.
- **Skaping webcams** (see Webcams).
- **Resort report** `www.le-corbier.com/en/slope-snow-information/` (server-rendered HTML, robots.txt allows):
  depth/fresh snow declared at L'Ouillon 2,431 m and Le Corbier 1,550 m, snow quality, avalanche danger (BERA level,
  EN words LOW…VERY HIGH), open pistes by colour dot (#4CAF50/#1565C0/#C62828/#212121), lifts, nordic km.
  `scripts/update-resort.mjs` → `data/resort.json` hourly; keeps the old file if parsing fails. Shown in the now-card
  (hidden when > 48 h old). Not yet used in the snowpack fit.
- **AI bulletin**: GitHub Models was RETIRED on 30 Jul 2026 (models.github.ai now answers every path with
  200 text/plain "OK"). `scripts/update-bulletin.mjs` now calls any OpenAI-compatible chat endpoint from secret
  `AI_API_KEY` + variables `AI_API_URL`, `AI_MODEL` (comma list = fallbacks), `AI_PROVIDER` (label shown on the page).
  Not configured → step logs and exits 0, page shows its rule-based bulletin.

## Stations

- **Le Corbier `73318400`** (1,585 m): manual nivo station, morning reports (06 UTC) **only during the ski season**
  (snow depth, fresh snow). No hourly T/precip. Used first whenever a report is < 4 days old.
- **Saint-Jean-d'Arves `73242003`** (1,573 m, 4 km): automatic hourly station all year — T, precip, snow depth.
- Snowpack calibration (`SITE.snowStations`): the two above + Saint-Sorlin-d'Arves 73280001 (1,694 m),
  Albiez-Montrond 73013002 (1,633 m), Valmeinier 73307400 (1,788 m), Val Thorens 73257005 (2,277 m),
  Saint-Martin-de-Belleville 73257001 (1,443 m). Les Rochilles nivose (wind-scoured) and La Norma (34 km) are
  deliberately excluded.

## Methods

- **Calibration (`data/verification.json`)**: per model, temperature bias by lead day (0–7) and UTC hour (cold
  season Nov–Apr, smoothed); weights 1/MAE² for T and ETS² for precipitation. ICON-CH seamless verifies as CH1 at
  lead 0, CH2 after. ENS temperatures get the IFS bias. Snow-day ETS (≥ 5 cm) scored against Le Corbier reports
  (`snowSource: 'corbier'`), T and precip against Saint-Jean hourly.
- **Consensus** (`D.consensus`): weighted, bias-corrected, at any elevation via lapse −6.5 K/km. Snow fraction from
  the model's snowfall height, else freezing level − 300 m, else wet-bulb; fresh-snow density Hedstrom & Pomeroy
  (1998). No precipitation gradient with elevation.
- **Snowpack (`snowpack.js`)**: hourly from 1 October, 100 m bands 400–3,600 m. Snowfall from precipitation and
  wet-bulb; degree-day melt 2→5 mm/°C/day through the season + rain heat; settling to 350 kg/m³ (450 wet).
  Fit: precipitation factor k ∈ [0.6, 1.8] and temperature offset dT ∈ [−2, 2] °C (coarse-to-fine grid, weak
  priors) against morning snow depths of the stations, weighted by distance (12 km) and age (10 days). Nudging:
  log-ratio measured/modelled at each station's latest reading, spread ±350 m around its elevation, fading away.
  **Slope & aspect**: each band is also run for slopes 15/30/45° × 8 aspects; melt × (0.4 + 0.6 R), R = daily
  clear-sky energy on the slope / flat ground (S30 ≈ 1.9, N30 ≈ 0.2 in December). Stations = flat ground, so the
  fit is unaffected. Limits: no cast shadows from ridges, melt only when air T > 0 °C, no wind redistribution.
  Typical fit error ≈ 6 cm. Test on real data (27 Nov 2026): ≈ 24 cm at 1,550 m, 89 cm at 2,265 m, Val Thorens
  modelled 84 vs 81 cm measured.
- **Multi-winter calibration** (`scripts/calibrate-snowpack.mjs`, weekly, Sunday 02:23 UTC, `what=snowcal`): fits the
  snowpack constants `SP.DEFAULTS` (k, dT, grad, ddfW, ddfS, twMid, tauCold, rhoCold) on all winters since autumn
  2022 (limit of the historical-forecast forcing; 2022 forcing starts 9 Nov, stations with snow already on the ground
  are left out that winter) against Météo-France daily 06 UTC snow depth (NEIGETOT06, QUOT files Q_73_*_autres-
  parametres.csv.gz from meteofrance.s3.sbg.io.cloud.ovh.net). Station-winters weigh equally × distance weight.
  Leave-one-winter-out skill; `data/snowcal.json` has `used: true` only if calibrated beats defaults out of sample.
  Page and bulletin call `SP.setParams()`; the live k/dT fit is centred on the calibrated k/dT.
  First run (27 Nov 2026, 5 winters): RMSE free run 21.7 → 16.8 cm, as run live 13.3 → 12.2 cm; 2023-24 free run
  worse (18.6 → 21.6). Fitted ddfW sits on its lower bound (0.1 mm/°C/day): almost no midwinter melt.
  Known station disagreement: Le Corbier manual reads ~15–20 cm more than Saint-Jean-d'Arves (same altitude, 4 km).
  Resort (Lumiplan) depths are NOT used: no measurement time, no documented site. Le Corbier -S- 73318401 (2,198 m)
  has no data since 2022. 07466 = Saint-Sorlin 73280402 (2,090 m, Choseaux top), added to `snowStations`.
- **Bulletin**: `B.buildDigest()` → `B.writeBulletin()` rule-based text (next 48 h, days 3–7, snow on the ground,
  ALWAYS ending with the 14-day ensemble trend and its uncertainty). The Action rewrites the draft with GitHub
  Models into `data/bulletin.json`; the page shows it if < 3 h old, else its own rule-based text.

## Map (`map.js`)

- Custom protocol `igndem://` → IGN float32 DEM → Terrain-RGB (hillshade `igor`, 3D terrain). Decoded tiles are
  cached (`getDem`, LRU 150) and shared.
- Layer modes (radio `snowlayer`): `fresh` (color-relief by elevation, blue→white ramp), `line` (rain–snow line,
  hourly slider 0–120 h), `depth` (default when < 3 cm of fresh snow is expected at the summit within 7 days).
  Depth uses the custom raster protocol `snowgrid://z/x/y/stamp`: each pixel gets its elevation, slope and aspect
  from the DEM and the depth interpolated from the snowpack grid; bare ground is warm earth (`BARE_STOPS`), snow
  blue→white (`DEPTH_RAMP`), snow edge `#bfefff`. Changing day → new stamp → tiles re-render from cache.
- 15-day strip docked under the map (skipass-style): per day / cumulative, play button, days ≥ 7 marked
  "tendance"; numbers = 2,265 m (top) and 1,550 m (bottom), flat ground. Read-out shows sunny/shady depths.
- Vectors: baked `data/buildings.geojson` (≈ 11.5 k), `lifts.geojson`, `pistes.geojson` covering all of
  Les Sybelles (bbox 45.15–45.32 N, 6.12–6.36 E, Les Perrons to Saint-Colomban); live WFS/Overpass fallback.
- `cooperativeGestures: true` (Ctrl + scroll to zoom). Opening view centre [6.252, 45.244], zoom 12.7.

## Webcams (`CAMS` in config.js)

Skaping panoramas store a still every `step` minutes (Paris time, at minute `offset`) at
`https://skaping.s3.gra.io.cloud.ovh.net/<path>/<YYYY>/<MM>/<DD>/<size>/<HH>-<mm>.jpg`
(sizes `thumb` 180 px, `mini` 360, `small` 480, `large` 720 high; no bucket listing).
- `le-corbier/front-de-neige/panoramique`: every 30 min at :01, :31
- `les-sybelles/pointe-du-corbier`, `les-sybelles/ouillon`: every 10 min
- live camera `le-corbier/live`: HLS stream; thumbnail
  `https://skaping.quanteec.com/contents/encodings/live/cf855356-…/thumbnail.jpg` (380×214, refreshed)
The page probes the newest slots, shows the latest still (draggable panorama), refreshes every 10 min, and
"● Direct" swaps the card to an iframe of the Skaping page. The page HTML also carries `og:image` with the latest
still if the schedule ever changes.

## Workflow (`.github/workflows/update-data.yml`)

Schedule (UTC):
hourly :07 bulletin · 05:17 & 17:17 climate (ERA5 archive + station seasons) · 11:43 & 15:43 Sentinel-2 ·
Mon & Thu 03:41 verification (~6 min) · 2nd of month vectors · 14th of month C3S seasonal.
`workflow_dispatch` input `what` = all | climate | snow | verification | vectors | seasonal | bulletin.
Permissions: `contents: write`. Steps are `continue-on-error`; final step commits `data/` and
pushes with `git pull --rebase`.

## Testing

```
npm i -g playwright   # if needed; Chromium must be available
cd tests
NODE_PATH=$(npm root -g) node run.mjs .. /tmp/shots            # full page + section screenshots
# env: VW/VH/DPR viewport, LANG_EN=1, MODE3D=1, SNOWLINE=1, SNOWNOW=1 (depth layer), DAY=3, CUMUL=1,
#      HERO_ONLY=1, WAIT=ms, PROBE='<js expression evaluated in the page>'
node bulletin-node.mjs                                        # runs scripts/update-bulletin.mjs offline
```
`fixtures.mjs` answers every external host (forecast, historical, ensemble, seasonal, tabular incl. `__in`,
IGN GeoTIFF/WFS, Overpass, webcams with `cam-pano.jpg` / `cam-live.jpg`). Expect "ERRORS:" and "MISSES:" empty.

## Status (27 Nov 2026)

The hourly workflow is installed in `.github/workflows/` (the git credential has the `workflow` scope).
`gh` is not installed on the owner's PC: trigger runs from Actions → Update data → Run workflow.
Season snow-depth chart (`archiveDepth`): interior gaps ≤ 10 days are filled linearly (tooltip shows "≈").
Map: fresh snow drawn in 7 classes (`SNOW_CLASSES`); pistes in French colours (OSM novice=green, easy=blue,
intermediate=red, advanced/expert=black); place pills are model values shown with "≈", Les Perrons is placed at the
resort's snow observation site, the top of the Trois Lacs chairlift (45.2090 N, 6.1824 E, 2,582 m); `noValue`
hides a place's pill if ever needed. Live webcam card opens in live mode on load (lazy iframe).

## Ideas not done yet

- Radiation melt below 0 °C on sunny slopes; ridge cast shadows (horizon angles from the DEM).
- Use Le Corbier's manual fresh-snow reports (`HNEIGEF`) in the snowpack fit when the season starts.
- Sentinel-2 snow classification (`data/snow/s2-snow.png`) is produced but not shown (it reported 100 % snow with
  34 % cloud — treat with care); it could validate the modelled snow line on clear days.
- More Sybelles webcams (La Toussuire, Saint-Sorlin, Saint-Jean, Les Bottières, Saint-Colomban) if Skaping or the
  resorts publish them.
