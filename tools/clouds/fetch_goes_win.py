# Fenêtres satellite autour des 22 aéroports avec observateur, pour tester une prévision des heures suivantes par
# déplacement des nuages (16 octobre 2026). Par heure H (15 juin au 14 octobre 2026): l'image de H:01 et celle de H-1:31,
# fenêtre de 41 x 41 cellules (environ 500 km) centrée sur l'aéroport (parallaxe à 2 000 m), champs TCF (total), CF1
# (0 à 1,5 km au-dessus de la mer) et CF2 (1,5 à 3 km), en entiers 0-100 (255: manquant). Fichiers goes_win/AAAAMMJJHH.npz (dossier à créer).
import json, os, math, io, re, datetime as dt, urllib.request, concurrent.futures as cf, time
import numpy as np, h5py
B = 'https://noaa-goes19.s3.amazonaws.com'
AUTO = set('CYBC CYFC CYHU CYLW CYMT CYQG CYRQ CYSC CYXS CYJT CYML'.split())
S = [s for s in json.load(open('stations.json')) if s['id'] not in AUTO]
json.dump([s['id'] for s in S], open('goes_win/sids.json', 'w'))
SAT_LON = -75.2; R = 20
def parallax(lat, lng, h):
    Re, Hs = 6371, 35786; la = math.radians(lat); dl = math.radians(lng - SAT_LON)
    c = math.acos(math.cos(la) * math.cos(dl)); vza = math.atan2(math.sin(c), math.cos(c) - Re / (Re + Hs)); d = h / 1000 * math.tan(vza)
    az = math.atan2(math.sin(dl), math.sin(la) * math.cos(dl) * 0 + math.sin(la))
    az = math.atan2(math.sin(dl) * math.cos(0), math.cos(0) * math.sin(la) - math.sin(0) * math.cos(la) * math.cos(dl))
    return lat + d * math.cos(az) / 111.2, lng + d * math.sin(az) / (111.2 * math.cos(la))
listing = {}
def keys_of(t):
    p = f'ABI-L2-CCLC/{t.year}/{t.timetuple().tm_yday:03d}/{t.hour:02d}/'
    if p not in listing:
        x = urllib.request.urlopen(f'{B}/?list-type=2&prefix={p}', timeout=60).read().decode(); listing[p] = sorted(re.findall(r'<Key>([^<]+)</Key>', x))
    return listing[p]
def pick(t, minute):
    ks = keys_of(t)
    if not ks: return None
    best = min(ks, key=lambda k: abs(int(re.search(r'_s\d{9}(\d{2})(\d{2})', k).group(2)) - minute)); return best
def windows(buf):
    with h5py.File(io.BytesIO(buf), 'r') as f:
        p = f['goes_imager_projection'].attrs; g = lambda k: float(np.ravel(p[k])[0])
        req, rpol, H = g('semi_major_axis'), g('semi_minor_axis'), g('perspective_point_height') + g('semi_major_axis'); lon0 = math.radians(g('longitude_of_projection_origin'))
        xs, xo = float(f['x'].attrs['scale_factor'][0]), float(f['x'].attrs['add_offset'][0]); ys, yo = float(f['y'].attrs['scale_factor'][0]), float(f['y'].attrs['add_offset'][0])
        e2 = (req * req - rpol * rpol) / (req * req)
        def ij(la, lo):
            phi, lam = math.radians(la), math.radians(lo); pc = math.atan(rpol * rpol / (req * req) * math.tan(phi)); rc = rpol / math.sqrt(1 - e2 * math.cos(pc) ** 2)
            sx = H - rc * math.cos(pc) * math.cos(lam - lon0); sy = -rc * math.cos(pc) * math.sin(lam - lon0); sz = rc * math.sin(pc)
            return round((math.asin(-sy / math.sqrt(sx * sx + sy * sy + sz * sz)) - xo) / xs), round((math.atan(sz / sx) - yo) / ys)
        tcf = f['TCF'][()].astype(np.float32); tsc = float(f['TCF'].attrs['scale_factor'][0]); toff = float(np.ravel(f['TCF'].attrs.get('add_offset', [0]))[0])
        T = np.where(f['TCF'][()] == 65535, 255, np.clip(np.round((tcf * tsc + toff) * 100), 0, 100)).astype(np.uint8)
        C1 = f['CF1'][()].astype(np.uint8); C2 = f['CF2'][()].astype(np.uint8)
        nr, nc = T.shape
        out = np.full((len(S), 3, 2 * R + 1, 2 * R + 1), 255, np.uint8)
        for k, s in enumerate(S):
            la, lo = parallax(s['lat'], s['lon'], 2000); i, j = ij(la, lo)
            j0, j1, i0, i1 = j - R, j + R + 1, i - R, i + R + 1
            if j0 < 0 or i0 < 0 or j1 > nr or i1 > nc: continue
            out[k, 0] = T[j0:j1, i0:i1]; out[k, 1] = C1[j0:j1, i0:i1]; out[k, 2] = C2[j0:j1, i0:i1]
        return out
def one(hour):
    fn = f'goes_win/{hour:%Y%m%d%H}.npz'
    if os.path.exists(fn): return 'déjà'
    err = None
    for a in range(5):
        try:
            k1 = pick(hour, 1); k0 = pick(hour - dt.timedelta(hours=1), 31)
            if not k1 or not k0: return 'aucun'
            w1 = windows(urllib.request.urlopen(f'{B}/{k1}', timeout=120).read()); w0 = windows(urllib.request.urlopen(f'{B}/{k0}', timeout=120).read())
            np.savez_compressed(fn, w=np.stack([w0, w1], axis=1)); return 'ok'
        except Exception as e: err = e; time.sleep(5 * (a + 1))
    return 'échec ' + str(err)[:80]
hours = []; t = dt.datetime(2026, 6, 15, 0)
while t < dt.datetime(2026, 10, 15, 0): hours.append(t); t += dt.timedelta(hours=1)
done = 0
with cf.ThreadPoolExecutor(8) as ex:
    for h, r in zip(hours, ex.map(one, hours)):
        done += 1
        if done % 100 == 0 or r.startswith('échec'): print(done, len(hours), h, r, flush=True)
print('FIN FENÊTRES', flush=True)
