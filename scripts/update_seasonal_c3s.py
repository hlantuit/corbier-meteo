"""Monthly (optional): Copernicus C3S multi-system seasonal anomalies for Le Corbier -> data/seasonal-c3s.json

Needs the secret ECMWF_DATASTORE_KEY (your personal access token from https://cds.climate.copernicus.eu,
profile page). You must also accept the licence of the dataset "seasonal-postprocessed-single-levels" once
on the CDS website. Without the key this script exits quietly and the page shows SEAS5 only.
"""
import calendar, datetime as dt, json, os, sys, tempfile

KEY = os.environ.get('ECMWF_DATASTORE_KEY', '').strip()
if not KEY:
    print('ECMWF_DATASTORE_KEY not set: skipping C3S multi-system seasonal forecast')
    sys.exit(0)

import cdsapi
import xarray as xr

LAT, LON = 45.2406, 6.2688
AREA = [46.5, 5.5, 44.5, 7.5]  # N, W, S, E
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# (label, originating_centre, candidate system numbers newest first)
SYSTEMS = [
    ('ECMWF', 'ecmwf', ['51']), ('Météo-France', 'meteo_france', ['9', '8']), ('DWD', 'dwd', ['22', '21']),
    ('CMCC', 'cmcc', ['4', '35']), ('Met Office', 'ukmo', ['604', '603', '602']), ('NCEP', 'ncep', ['2']),
    ('JMA', 'jma', ['3']), ('ECCC', 'eccc', ['5', '4']),
]
VARS = {'t2m': '2m_temperature_anomaly', 'tp': 'total_precipitation_anomalous_rate_of_accumulation', 'sf': 'snowfall_anomalous_rate_of_accumulation'}

client = cdsapi.Client(url='https://cds.climate.copernicus.eu/api', key=KEY, quiet=True)


def fetch(centre, system, var, year, month):
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, 'x.nc')
        client.retrieve('seasonal-postprocessed-single-levels', {
            'originating_centre': centre, 'system': system, 'variable': [var], 'product_type': ['ensemble_mean'],
            'year': [str(year)], 'month': [f'{month:02d}'], 'leadtime_month': ['1', '2', '3', '4', '5', '6'],
            'data_format': 'netcdf', 'area': AREA,
        }, path)
        ds = xr.open_dataset(path)
        name = list(ds.data_vars)[0]
        da = ds[name].sel(latitude=LAT, longitude=LON, method='nearest')
        lead_dim = [d for d in da.dims if 'forecastMonth' in d or 'lead' in d.lower()]
        out = {}
        for i in range(da.sizes[lead_dim[0]] if lead_dim else 1):
            v = float(da.isel({lead_dim[0]: i}).squeeze().values) if lead_dim else float(da.squeeze().values)
            y, m = year, month + i
            while m > 12:
                m -= 12; y += 1
            out[f'{y}-{m:02d}'] = (v, calendar.monthrange(y, m)[1] * 86400)
        return out


def main():
    today = dt.date.today()
    inits = [(today.year, today.month)]
    prev = today.replace(day=1) - dt.timedelta(days=1)
    inits.append((prev.year, prev.month))
    for year, month in inits:
        months, used = {}, []
        for label, centre, systems in SYSTEMS:
            ok = False
            for system in systems:
                try:
                    for key, var in VARS.items():
                        vals = fetch(centre, system, var, year, month)
                        for ym, (v, secs) in vals.items():
                            if key == 't2m':
                                val = v
                            elif key == 'tp':
                                val = v * 1000 * secs           # m/s -> mm per month
                            else:
                                val = v * 1000 * secs * 0.7     # m w.e./s -> cm of snow (7 cm = 10 mm)
                            months.setdefault(ym, {}).setdefault(key, {})[label] = round(val, 2)
                    used.append(f'{label} ({system})'); ok = True
                    print('ok', label, system)
                    break
                except Exception as e:
                    print('skip', label, system, str(e)[:160])
            if not ok:
                print('no data for', label)
        if len(used) >= 2:
            out = {'init': f'{year}-{month:02d}', 'systems': used, 'months': months, 'generated': dt.datetime.utcnow().isoformat() + 'Z',
                   'units': {'t2m': '°C', 'tp': 'mm/month', 'sf': 'cm/month'}}
            with open(os.path.join(ROOT, 'data', 'seasonal-c3s.json'), 'w') as f:
                json.dump(out, f, ensure_ascii=False)
            print('wrote seasonal-c3s.json with', used)
            return 0
    print('C3S forecast not available yet; keeping the previous file')
    return 0


if __name__ == '__main__':
    sys.exit(main())
