"""Récolte des dates moyennes de phénologie (MODIS MCD12Q2, service ORNL DAAC, sans compte) sur une grille de points
Canada + États-Unis. Pour chaque point: fenêtre de 4 km (81 pixels de 500 m), médiane des pixels valides par année,
moyenne 2012-2021 des bandes MidGreendown (milieu du brunissement), Dormancy (feuilles tombées), Greenup (débourrement)
et MidGreenup (feuillaison). Écrit points.json (dossier du script): [{lat, lng, n, mgd, dor, gup, mgu}] en jours de l'année.
Les réponses brutes sont mises en cache dans raw/ pour relancer sans recharger le service."""
import json, os, sys, time, datetime, statistics, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw'); os.makedirs(RAW, exist_ok=True)
BANDS = {'mgd': 'MidGreendown', 'dor': 'Dormancy', 'gup': 'Greenup', 'mgu': 'MidGreenup'}
Y0, Y1 = 2012, 2021

def lattice():
    pts = []
    for la in range(29, 56, 2):
        for ln in range(-125, -52, 3):
            pts.append((la, ln))
    # Coeur du marché: Québec, Ontario, Maritimes, Nouvelle-Angleterre, plus serré.
    for la10 in range(430, 500, 10):
        for ln10 in range(-800, -600, 10):
            la, ln = la10 / 10 + 0.5, ln10 / 10 + 0.5
            pts.append((la, ln))
    seen, out = set(), []
    for p in pts:
        if p not in seen: seen.add(p); out.append(p)
    return out

def fetch(lat, lng, band):
    fn = os.path.join(RAW, f'{lat}_{lng}_{band}.json')
    if os.path.exists(fn):
        with open(fn) as f: return json.load(f)
    url = (f'https://modis.ornl.gov/rst/api/v1/MCD12Q2/subset?latitude={lat}&longitude={lng}&band={band}.Num_Modes_01'
           f'&startDate=A{Y0}001&endDate=A{Y1}365&kmAboveBelow=2&kmLeftRight=2')
    for k in range(3):
        try:
            req = urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': 'MeteoShoot phenology harvest'})
            with urllib.request.urlopen(req, timeout=90) as r: j = json.load(r)
            with open(fn, 'w') as f: json.dump(j, f)
            return j
        except urllib.error.HTTPError as e:
            if e.code in (400, 404): j = {'error': e.code};
            else: time.sleep(3 * (k + 1)); continue
            with open(fn, 'w') as f: json.dump(j, f)
            return j
        except Exception:
            time.sleep(3 * (k + 1))
    return {'error': 'timeout'}

def doy_mean(j):
    if 'subset' not in j: return None, 0
    ms, n = [], 0
    for s in j['subset']:
        y = int(s['modis_date'][1:5]); v = [d for d in s['data'] if d != 32767]
        if len(v) >= 12:
            med = statistics.median(v)
            doy = med - (datetime.date(y, 1, 1).toordinal() - datetime.date(1970, 1, 1).toordinal())
            ms.append(doy); n = max(n, len(v))
    if len(ms) < 5: return None, n
    return round(statistics.mean(ms), 1), n

def point(p):
    lat, lng = p
    out = {'lat': lat, 'lng': lng}
    for k, b in BANDS.items():
        j = fetch(lat, lng, b)
        m, n = doy_mean(j)
        if m is None: return None
        out[k] = m; out['n'] = n
    return out

if __name__ == '__main__':
    pts = lattice(); print(len(pts), 'points', flush=True)
    res, done = [], 0
    with ThreadPoolExecutor(max_workers=4) as ex:
        for r in ex.map(point, pts):
            done += 1
            if r: res.append(r)
            if done % 20 == 0: print(done, 'faits,', len(res), 'valides', flush=True)
    with open(os.path.join(HERE, 'points.json'), 'w') as f: json.dump(res, f)
    print('fini:', len(res), 'points valides sur', len(pts))
