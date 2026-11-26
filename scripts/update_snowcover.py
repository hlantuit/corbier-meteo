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

AOI = (6.185, 45.185, 6.330, 45.285)  # W, S, E, N (lon/lat)
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
            'limit': 40, 'query': {'eo:cloud_cover': {'lt': 85}}, 'sortby': [{'field': 'properties.datetime', 'direction': 'desc'}]}
    items = requests.post(STAC, json=body, timeout=60).json().get('features', [])
    print('items', len(items))
    dst_t, w, h = grid()
    for it in items:
        bb = it.get('bbox')
        if bb and not (bb[0] <= AOI[0] and bb[1] <= AOI[1] and bb[2] >= AOI[2] and bb[3] >= AOI[3]):
            continue  # scene does not cover the whole area
        a = it['assets']
        try:
            scl = read_to_grid(a['scl']['href'], dst_t, w, h, Resampling.nearest)[0]
        except Exception as e:
            print('scl failed', it['id'], e); continue
        valid = scl > 0
        cloud = np.isin(scl, [3, 8, 9, 10])
        if valid.mean() < 0.95:
            continue
        clear = 1 - cloud[valid].mean()
        print(it['id'], it['properties']['datetime'][:10], f'clear {clear:.2f}')
        if clear < 0.6:
            continue
        g = read_to_grid(a['green']['href'], dst_t, w, h)[0]
        s = read_to_grid(a['swir16']['href'], dst_t, w, h)[0]
        gs, go = scale_offset(a['green'], it); ss, so = scale_offset(a['swir16'], it)
        G = g * gs + go; S = s * ss + so
        ndsi = (G - S) / np.maximum(G + S, 1e-6)
        snow = (((ndsi > 0.40) & (G > 0.10)) | (scl == 11)) & ~cloud & valid
        rgba = np.zeros((h, w, 4), dtype=np.uint8)
        rgba[snow] = (235, 246, 255, 215)
        rgba[cloud & valid] = (120, 132, 150, 110)
        os.makedirs(OUT, exist_ok=True)
        Image.fromarray(rgba, 'RGBA').save(os.path.join(OUT, 's2-snow.png'), optimize=True)
        try:
            rgb = read_to_grid(a['visual']['href'], dst_t, w, h, Resampling.bilinear, bands=[1, 2, 3])
            img = np.clip(np.moveaxis(rgb, 0, -1), 0, 255).astype(np.uint8)
            Image.fromarray(img, 'RGB').save(os.path.join(OUT, 's2-rgb.jpg'), quality=82)
        except Exception as e:
            print('rgb failed', e)
        meta = {'date': it['properties']['datetime'], 'id': it['id'], 'clear': round(float(clear), 3),
                'snow_fraction': round(float(snow[valid & ~cloud].mean()), 3),
                'coordinates': [[AOI[0], AOI[3]], [AOI[2], AOI[3]], [AOI[2], AOI[1]], [AOI[0], AOI[1]]],
                'resolution_m': RES, 'generated': dt.datetime.utcnow().isoformat() + 'Z'}
        with open(os.path.join(OUT, 's2.json'), 'w') as f:
            json.dump(meta, f)
        print('wrote', meta)
        return 0
    print('no clear scene in the last 20 days; keeping the previous image')
    return 0


if __name__ == '__main__':
    sys.exit(main())
