"""Ajuste le calendrier moyen (points.json de harvest.py) et écrit src/scene3d/phenology.js.
1) altitude de chaque point (API d'altitude d'Open-Meteo, 100 points par appel);
2) régression par moindres carrés doy = a + b*lat + c*elev pour chaque date (mgd, dor, gup, mgu);
3) points gardés avec leurs valeurs brutes: le module season.js corrige la régression par les écarts des voisins.
Usage: python3 -I fit.py <points.json> <sortie phenology.js>"""
import json, sys, urllib.request, statistics

pts = json.load(open(sys.argv[1]))
# Altitudes.
for i in range(0, len(pts), 100):
    lot = pts[i:i + 100]
    url = 'https://api.open-meteo.com/v1/elevation?latitude=' + ','.join(str(p['lat']) for p in lot) + '&longitude=' + ','.join(str(p['lng']) for p in lot)
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'MeteoShoot'}), timeout=60) as r: j = json.load(r)
    for p, e in zip(lot, j['elevation']): p['elev'] = round(e)
pts = [p for p in pts if p.get('elev') is not None]
# Points plausibles pour un feuillage d'arbres (le satellite voit aussi les cultures, les prairies et les hivers verts de
# Californie): milieu du brunissement d'août à mi-novembre, chute 2 à 10 semaines après, débourrement de mars à juin.
ok = lambda p: 215 <= p['mgd'] <= 320 and 14 <= p['dor'] - p['mgd'] <= 70 and 60 <= p['gup'] <= 170 and 0 <= p['mgu'] - p['gup'] <= 60
print('écartés:', [(p['lat'], p['lng']) for p in pts if not ok(p)])
pts = [p for p in pts if ok(p)]

def lstsq(rows, y):
    # résout (X'X) b = X'y pour 3 colonnes (1, lat, elev) par élimination de Gauss
    n = 3; A = [[0.0] * n for _ in range(n)]; B = [0.0] * n
    for x, v in zip(rows, y):
        for i in range(n):
            B[i] += x[i] * v
            for k in range(n): A[i][k] += x[i] * x[k]
    for i in range(n):
        piv = A[i][i]
        for k in range(i, n): A[i][k] /= piv
        B[i] /= piv
        for r in range(n):
            if r != i:
                f = A[r][i]
                for k in range(i, n): A[r][k] -= f * A[i][k]
                B[r] -= f * B[i]
    return B

# Régression sur la forêt feuillue de l'Est (à l'est du 95e méridien), robuste (second passage sans les écarts de plus
# de deux écarts-types); les points de l'Ouest et du Sud restent dans la liste et corrigent localement.
east = [p for p in pts if p['lng'] >= -95 and p['lat'] >= 35]
fit = {}
for k in ('mgd', 'dor', 'gup', 'mgu'):
    sel = east
    for _ in range(2):
        b = lstsq([[1.0, p['lat'], p['elev']] for p in sel], [p[k] for p in sel])
        res = [p[k] - (b[0] + b[1] * p['lat'] + b[2] * p['elev']) for p in sel]
        sd = statistics.pstdev(res); sel = [p for p, r in zip(sel, res) if abs(r) <= 2 * sd]
    fit[k] = [round(v, 5) for v in b]
    res = [p[k] - (b[0] + b[1] * p['lat'] + b[2] * p['elev']) for p in east]
    print(k, 'a=%.1f b_lat=%.2f j/deg c_elev=%.2f j/100 m' % (b[0], b[1], b[2] * 100), 'écart-type des résidus %.1f j' % statistics.pstdev(res))

rows = ','.join('[%g,%g,%d,%g,%g,%g,%g]' % (p['lat'], p['lng'], p['elev'], p['mgd'], p['dor'], p['gup'], p['mgu']) for p in pts)
js = f"""// Calendrier moyen de phénologie du feuillage (généré par tools/phenology-harvest.py puis tools/phenology-fit.py,
// {len(pts)} points, satellite MODIS MCD12Q2, moyenne 2012 à 2021, fenêtres de 4 km). Ne pas modifier à la main.
// pts: [lat, lng, altitude m, mgd, dor, gup, mgu] en jours de l'année (milieu du brunissement, feuilles tombées,
// débourrement, feuillaison). fit: [a, b par degré de latitude, c par mètre d'altitude] pour chaque date.
export const PHENO = {{
  fit: {json.dumps(fit)},
  pts: [{rows}],
}};
"""
open(sys.argv[2], 'w').write(js)
print('écrit', sys.argv[2], len(pts), 'points')
