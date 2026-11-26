"""Daily: latest mostly-clear Sentinel-2 image over Le Corbier -> 20 m snow map + true-colour image.

Free data: Sentinel-2 L2A Cloud-Optimised GeoTIFFs on AWS (Element 84 Earth Search STAC), no account.
Writes data/snow/s2-snow.png (RGBA overlay), data/snow/s2-rgb.jpg and data/snow/s2.json.
Snow = NDSI > 0.40 with green reflectance > 0.10 (Hall & Riggs), outside clouds of the scene
classification (SCL 8, 9, 10). SCL class 11 (snow) is also counted as snow.
"""
import json, math, os, sys, datetime as dt
import numpy as np
import requests
import rasterio
from rasterio.warp import reproject, Resampling, transform_bounds
from rasterio.transform import from_bounds
from rasterio.windows import from_bounds as window_from_bounds
from PIL import Image

AOI = (6.130, 45.150, 6.360, 45.320)  # W, S, E, N (lon/lat): all of Les Sybelles, Les Perrons to Saint-Colomban
RES = 20.0  # metres in EPSG:3857 (about 14 m on the ground here)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'snow')
STAC = 'https://earth-search.aws.element84.com/v1/search'

os.environ.setdefault('GDAL_DISABLE_READDIR_ON_OPEN', 'EMPTY_DIR')
os.environ.setdefault('CPL_VSIL_CURL_ALLOWED_EXTENSIONS', '.tif')
os.environ.setdefault('AWS_NO_SIGN_REQUEST', 'YES')


def merc(lon, lat):
    x = lon * 20037508.342789244 / 180
    y = math.log(math.tan((90 + lat) * math.pi / 360)) * 6378137
    return x, y


def grid():
    x0, y0 = merc(AOI[0], AOI[1]); x1, y1 = merc(AOI[2], AOI[3])
    w = int(round((x1 - x0) / RES)); h = int(round((y1 - y0) / RES))
    return from_bounds(x0, y0, x1, y1, w, h), w, h


def read_to_grid(href, dst_t, w, h, resampling=Resampling.bilinear, bands=None):
    with rasterio.open(href) as src:
        b = transform_bounds('EPSG:4326', src.crs, *AOI, densify_pts=21)
        win = window_from_bounds(*b, transform=src.transform).round_offsets().round_lengths()
        idx = bands or list(range(1, src.count + 1))
        data = src.read(idx, window=win, boundless=True, fill_value=0)
        src_t = src.window_transform(win)
        out = np.zeros((len(idx), h, w), dtype=np.float32)
        for i in range(len(idx)):
            reproject(data[i].astype(np.float32), out[i], src_transform=src_t, src_crs=src.crs,
                      dst_transform=dst_t, dst_crs='EPSG:3857', resampling=resampling, src_nodata=0, dst_nodata=0)
        return out


def scale_offset(asset, item):
    rb = (asset.get('raster:bands') or [{}])[0]
    if 'scale' in rb:
        return rb.get('scale', 1e-4), rb.get('offset', 0.0)
    base = item['properties'].get('s2:processing_baseline', '04.00')
    return 1e-4, (-0.1 if base >= '04.00' else 0.0)


def main():
    end = dt.datetime.utcnow(); start = end - dt.timedelta(days=20)
    body = {'collections': ['sentinel-2-l2a'], 'bbox': list(AOI), 'datetime': f'{start:%Y-%m-%dT%H:%M:%SZ}/{end:%Y-%m-%dT%H:%M:%SZ}',
            'limit': 60, 'query': {'eo:cloud_cover': {'lt': 85}}, 'sortby': [{'field': 'properties.datetime', 'direction': 'desc'}]}
    items = requests.post(STAC, json=body, timeout=60).json().get('features', [])
    print('items', len(items))
    dst_t, w, h = grid()
    # The area straddles Sentinel-2 tiles (UTM zones 31 and 32): mosaic all tiles of the same pass
    passes = {}
    for it in items:
        key = (it['properties']['datetime'][:10], it['properties'].get('platform', ''))
        passes.setdefault(key, []).append(it)
    for key in sorted(passes, reverse=True):
        tiles = sorted(passes[key], key=lambda it: it['properties'].get('eo:cloud_cover', 100))
        scl = np.zeros((h, w), dtype=np.float32); owner = np.full((h, w), -1, dtype=np.int16)
        for k, it in enumerate(tiles):
            try:
                sc = read_to_grid(it['assets']['scl']['href'], dst_t, w, h, Resampling.nearest)[0]
            except Exception as e:
                print('scl failed', it['id'], e); continue
            fill = (scl == 0) & (sc > 0)
            scl[fill] = sc[fill]; owner[fill] = k
        valid = scl > 0
        cloud = np.isin(scl, [3, 8, 9, 10])
        if valid.mean() < 0.97:
            print(key, f'coverage {valid.mean():.2f}, skipped'); continue
        clear = 1 - cloud[valid].mean()
        print(key, len(tiles), 'tiles', f'clear {clear:.2f}')
        if clear < 0.6:
            continue
        G = np.zeros((h, w), dtype=np.float32); S = np.zeros((h, w), dtype=np.float32); RGB = np.zeros((3, h, w), dtype=np.float32)
        for k, it in enumerate(tiles):
            m = owner == k
            if not m.any():
                continue
            a = it['assets']
            g = read_to_grid(a['green']['href'], dst_t, w, h)[0]
            sw = read_to_grid(a['swir16']['href'], dst_t, w, h)[0]
            gs, go = scale_offset(a['green'], it); ss, so = scale_offset(a['swir16'], it)
            G[m] = (g * gs + go)[m]; S[m] = (sw * ss + so)[m]
            try:
                rgb = read_to_grid(a['visual']['href'], dst_t, w, h, Resampling.bilinear, bands=[1, 2, 3])
                RGB[:, m] = rgb[:, m]
            except Exception as e:
                print('rgb failed', it['id'], e)
        ndsi = (G - S) / np.maximum(G + S, 1e-6)
        snow = (((ndsi > 0.40) & (G > 0.10)) | (scl == 11)) & ~cloud & valid
        rgba = np.zeros((h, w, 4), dtype=np.uint8)
        rgba[snow] = (235, 246, 255, 215)
        rgba[cloud & valid] = (120, 132, 150, 110)
        os.makedirs(OUT, exist_ok=True)
        Image.fromarray(rgba, 'RGBA').save(os.path.join(OUT, 's2-snow.png'), optimize=True)
        img = np.clip(np.moveaxis(RGB, 0, -1), 0, 255).astype(np.uint8)
        Image.fromarray(img, 'RGB').save(os.path.join(OUT, 's2-rgb.jpg'), quality=82)
        meta = {'date': tiles[0]['properties']['datetime'], 'id': ' + '.join(it['id'] for it in tiles), 'clear': round(float(clear), 3),
                'snow_fraction': round(float(snow[valid & ~cloud].mean()), 3),
                'coordinates': [[AOI[0], AOI[3]], [AOI[2], AOI[3]], [AOI[2], AOI[1]], [AOI[0], AOI[1]]],
                'resolution_m': RES, 'generated': dt.datetime.utcnow().isoformat() + 'Z'}
        with open(os.path.join(OUT, 's2.json'), 'w') as f:
            json.dump(meta, f)
        print('wrote', meta)
        return 0
    print('no clear, complete pass in the last 20 days; keeping the previous image')
    return 0


if __name__ == '__main__':
    sys.exit(main())
