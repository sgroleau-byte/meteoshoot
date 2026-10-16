# Satellite GOES-19, produit des couches nuageuses (CCL, secteur CONUS), un fichier par heure du 15 juin au 14 octobre 2026:
# fractions par tranche d'altitude dans une boîte de 3 x 3 cellules autour des 33 aéroports, avec la même parallaxe que
# api/goes.js, rangées dans goes_samples/ (dossier à créer). Rien n'est gardé des fichiers eux-mêmes (environ 0,4 Mo chacun).
import json, os, sys, math, io, datetime as dt, urllib.request, re, concurrent.futures as cf
import numpy as np, h5py
B = 'https://noaa-goes19.s3.amazonaws.com'
AUTO = set('CYBC CYFC CYHU CYLW CYMT CYQG CYRQ CYSC CYXS CYJT CYML'.split())
S = [s for s in json.load(open('stations.json')) if s['id'] not in AUTO]
LAYER_H = [800, 2200, 4200, 6400, 9500]; SAT_LON = -75.2
def parallax(lat, lng, h):
    R, Hs = 6371, 35786; la = math.radians(lat); dl = math.radians(lng - SAT_LON)
    c = math.acos(math.cos(la) * math.cos(dl)); vza = math.atan2(math.sin(c), math.cos(c) - R / (R + Hs)); d = h / 1000 * math.tan(vza)
    az = math.atan2(math.sin(dl), math.sin(la) * math.cos(0) - 0)  # direction depuis le point sous le satellite (comme api/goes.js)
    az = math.atan2(math.sin(dl) * math.cos(0), math.cos(0) * math.sin(la) - math.sin(0) * math.cos(la) * math.cos(dl))
    return lat + d * math.cos(az) / 111.2, lng + d * math.sin(az) / (111.2 * math.cos(la))
def one(hour):
    import time
    for k in range(5):
        try: return one_(hour)
        except Exception as e: err = e; time.sleep(5 * (k + 1))
    return 'échec ' + str(err)[:80]
def one_(hour):
    out = f'goes_samples/{hour:%Y%m%d%H}.json'
    if os.path.exists(out): return 'déjà'
    doy = hour.timetuple().tm_yday
    x = urllib.request.urlopen(f'{B}/?list-type=2&prefix=ABI-L2-CCLC/{hour.year}/{doy:03d}/{hour.hour:02d}/', timeout=60).read().decode()
    keys = sorted(re.findall(r'<Key>([^<]+)</Key>', x))
    if not keys: return 'aucun'
    buf = urllib.request.urlopen(f'{B}/{keys[0]}', timeout=120).read()
    with h5py.File(io.BytesIO(buf), 'r') as f:
        p = f['goes_imager_projection'].attrs; g = lambda k: float(np.ravel(p[k])[0])
        req, rpol, H = g('semi_major_axis'), g('semi_minor_axis'), g('perspective_point_height') + g('semi_major_axis'); lon0 = math.radians(g('longitude_of_projection_origin'))
        xs, xo = float(f['x'].attrs['scale_factor'][0]), float(f['x'].attrs['add_offset'][0]); ys, yo = float(f['y'].attrs['scale_factor'][0]), float(f['y'].attrs['add_offset'][0])
        e2 = (req * req - rpol * rpol) / (req * req)
        def ij(la, lo):
            phi, lam = math.radians(la), math.radians(lo); pc = math.atan(rpol * rpol / (req * req) * math.tan(phi)); rc = rpol / math.sqrt(1 - e2 * math.cos(pc) ** 2)
            sx = H - rc * math.cos(pc) * math.cos(lam - lon0); sy = -rc * math.cos(pc) * math.sin(lam - lon0); sz = rc * math.sin(pc)
            return round((math.asin(-sy / math.sqrt(sx * sx + sy * sy + sz * sz)) - xo) / xs), round((math.atan(sz / sx) - yo) / ys)
        arr = {k: f[k][()] for k in ['TCF', 'CF1', 'CF2', 'CF3', 'CF4', 'CF5']}
        tsc = float(f['TCF'].attrs['scale_factor'][0]); toff = float(np.ravel(f['TCF'].attrs.get('add_offset', [0]))[0])
        nr, nc = arr['TCF'].shape
        res = {}
        for s in S:
            vals = []
            for k, h in zip(['TCF', 'CF1', 'CF2', 'CF3', 'CF4', 'CF5'], [2500] + LAYER_H):
                la, lo = parallax(s['lat'], s['lon'], h); i, j = ij(la, lo)
                if not (1 <= i < nc - 1 and 1 <= j < nr - 1): vals = None; break
                box = arr[k][j - 1:j + 2, i - 1:i + 2].astype(float)
                fill = 65535 if k == 'TCF' else 255
                box = box[box != fill]
                if not box.size: vals = None; break
                vals.append(float(np.mean(box * tsc + toff) * 100) if k == 'TCF' else float(np.mean(box)))
            if vals: res[s['id']] = [round(v, 1) for v in vals]
    json.dump({'file': keys[0].split('/')[-1], 'st': res}, open(out, 'w'))
    return 'ok'
hours = []
t = dt.datetime(2026, 6, 15, 0); end = dt.datetime(2026, 10, 15, 0)
while t < end: hours.append(t); t += dt.timedelta(hours=1)
done = 0
with cf.ThreadPoolExecutor(8) as ex:
    for h, r in zip(hours, ex.map(lambda h: (lambda: one(h))() if True else None, hours)):
        done += 1
        if done % 100 == 0: print(done, len(hours), h, r, flush=True)
print('FIN GOES', flush=True)
