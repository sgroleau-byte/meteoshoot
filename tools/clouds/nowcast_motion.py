# Prévision des heures suivantes par déplacement des nuages (16 octobre 2026; résultat: aucun gain sur le satellite au-dessus
# du lieu, à aucune échéance, voir docs/nuages-verification.md): mouvement estimé entre l'image de H-1:31 et
# celle de H:01 (appariement de blocs sur le total), puis valeur du satellite « en amont » (là d'où viendra l'air au-dessus
# du lieu dans h heures). Comparé, sur les mêmes rangées, au satellite au-dessus du lieu et à une grande boîte (110 km).
import glob, json, numpy as np, pandas as pd
from sklearn.isotonic import IsotonicRegression
SIDS = json.load(open('goes_win/sids.json')); R = 20; C = R
rows = []
files = sorted(glob.glob('goes_win/*.npz'))
SH = range(-5, 6)
def box(a, y, x, r=1):
    y, x = int(round(y)), int(round(x)); y = min(max(y, r), 2 * R - r); x = min(max(x, r), 2 * R - r)
    b = a[y - r:y + r + 1, x - r:x + r + 1].astype(float); b = b[b != 255]
    return float(b.mean()) if b.size else np.nan
for fn in files:
    t = pd.to_datetime(fn.split('/')[-1][:10], format='%Y%m%d%H', utc=True)
    W = np.load(fn)['w']  # [station, temps (0: H-1:31, 1: H:01), champ (TCF, CF1, CF2), 41, 41]
    for k, sid in enumerate(SIDS):
        T0, T1 = W[k, 0, 0].astype(float), W[k, 1, 0].astype(float)
        if (T1 == 255).mean() > 0.2 or (T0 == 255).mean() > 0.2: continue
        m0, m1 = T0 != 255, T1 != 255
        # appariement: le bloc central de T0 (25 x 25) déplacé de (dy, dx) pour coller à T1
        best, bd, c0 = None, (0, 0), None
        a = T0[C - 12:C + 13, C - 12:C + 13]; ma = m0[C - 12:C + 13, C - 12:C + 13]
        if a[ma].std() < 3: dy = dx = 0; q = 0.0  # champ uniforme: pas de mouvement mesurable
        else:
            for dy in SH:
                for dx in SH:
                    b = T1[C - 12 + dy:C + 13 + dy, C - 12 + dx:C + 13 + dx]; mb = m1[C - 12 + dy:C + 13 + dy, C - 12 + dx:C + 13 + dx]; mm = ma & mb
                    e = np.abs(a[mm] - b[mm]).mean()
                    if dy == 0 and dx == 0: c0 = e
                    if best is None or e < best: best, bd = e, (dy, dx)
            dy, dx = bd; q = (c0 - best) / max(c0, 1e-6)
        r = {'sid': sid, 't': t, 'dy': dy, 'dx': dx, 'q': q, 'satC': box(W[k, 1, 0], C, C), 'satBig': box(W[k, 1, 0], C, C, 5), 'lowC': box(W[k, 1, 1], C, C), 'satC0': box(W[k, 0, 0], C, C)}
        for h in [1, 2, 3, 4]:
            # 2 h demi-heures de déplacement par heure d'échéance (le mouvement mesuré couvre 30 min)
            r[f'up{h}'] = box(W[k, 1, 0], C - 2 * h * dy, C - 2 * h * dx); r[f'lowUp{h}'] = box(W[k, 1, 1], C - 2 * h * dy, C - 2 * h * dx)
            # moyenne le long du trajet (le mouvement mesuré est incertain): de l'amont jusqu'au lieu
            r[f'path{h}'] = float(np.nanmean([box(W[k, 1, 0], C - 2 * h * dy * f, C - 2 * h * dx * f) for f in (0.25, 0.5, 0.75, 1.0)]))
        rows.append(r)
M = pd.DataFrame(rows).set_index(['sid', 't']); M.to_pickle('motion_M.pkl')
print(len(M), 'heures-aéroports', '| mouvement non nul', round(float(((M.dy != 0) | (M.dx != 0)).mean()), 2), '| déplacement médian (cellules/30 min)', float(np.median(np.hypot(M.dy, M.dx))))
H = pd.read_pickle('nowcast_H.pkl')
H.index = H.index.set_levels([H.index.levels[0], H.index.levels[1].as_unit('ns')]) if hasattr(H.index.levels[1], 'as_unit') else H.index
M.index = M.index.set_levels([M.index.levels[0], M.index.levels[1].as_unit('ns')]) if hasattr(M.index.levels[1], 'as_unit') else M.index
J = H.join(M, how='inner')
print('jointes', len(J))
G1 = np.arange(0, 1.001, 0.05)
G2 = np.array([(a, b) for a in G1 for b in G1 if a + b <= 1.0001])
wk = np.array([t.isocalendar()[1] % 2 for t in J.index.get_level_values(1)])
def cv1(m, s, y):
    tot = 0
    for k in [0, 1]:
        tr, te = wk != k, wk == k
        E = np.abs(m[tr][None] + G1[:, None] * (s[tr] - m[tr])[None] - y[tr][None]).mean(1); w = G1[E.argmin()]
        tot += np.abs(m[te] + w * (s[te] - m[te]) - y[te]).sum()
    return tot / len(y)
def cv2(m, s1, s2, y):
    tot = 0
    for k in [0, 1]:
        tr, te = wk != k, wk == k
        E = np.abs(m[tr][None] + G2[:, :1] * (s1[tr] - m[tr])[None] + G2[:, 1:] * (s2[tr] - m[tr])[None] - y[tr][None]).mean(1); w = G2[E.argmin()]
        tot += np.abs(m[te] + w[0] * (s1[te] - m[te]) + w[1] * (s2[te] - m[te]) - y[te]).sum()
    return tot / len(y)
for h in [1, 2, 3, 4]:
    sh = J.groupby(level=0).shift(-h)
    for lab, dsel in [('jour', J['sun'].values > 5), ('nuit', J['sun'].values <= 5)]:
        X = pd.DataFrame({'y': sh['tot%'].values, 'm': sh['Cd0'].values, 'c': J['satC'].values, 'u': J[f'up{h}'].values, 'b': J['satBig'].values, 'p': J[f'path{h}'].values,
                          'g': np.where(J['q'].values > 0.15, J[f'up{h}'].values, J['satC'].values)}, index=J.index)
        ok = X.notna().all(axis=1).values & dsel
        Z = X[ok]; global wk_all
        wk_s = wk[ok]
        # tables d'étalonnage (médiane approchée par isotone sur la moyenne; même table pour les trois)
        cal = IsotonicRegression(out_of_bounds='clip').fit(Z['c'], Z['y']) if lab == 'jour' else None
        f = (lambda v: cal.predict(v)) if cal is not None else (lambda v: v)
        m, y = Z['m'].values, Z['y'].values; c, u, b, pth, gt = f(Z['c'].values), f(Z['u'].values), f(Z['b'].values), f(Z['p'].values), f(Z['g'].values)
        wk_bak = wk; wk = wk_s
        print(f"h={h} {lab}: n={len(Z)} prévision {np.mean(np.abs(m - y)):.2f} | au-dessus {cv1(m, c, y):.2f} | en amont {cv1(m, u, y):.2f} | grande boîte {cv1(m, b, y):.2f} | au-dessus + amont {cv2(m, c, u, y):.2f} | amont + grande boîte {cv2(m, u, b, y):.2f} | trajet {cv1(m, pth, y):.2f} | amont si mouvement net {cv1(m, gt, y):.2f}")
        wk = wk_bak
