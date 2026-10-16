# Stations automatiques (ceilomètre) comme source de plus pour les nuages bas, par-dessus la correction actuelle
# (satellite + aéroport avec observateur, tables de nowcast_tables.json): poids wA selon l'échéance, jour/nuit et distance.
import pandas as pd, numpy as np, json, math, sys
from load import load_all
T = json.load(open('nowcast_tables.json')); KN = T['knots']; HX = T['h'] + [8]; KM = [0, 30, 75, 120, 150]
def interp(xs, ys, x): return np.interp(x, xs, ys)
def byH(col, h): return np.interp(np.maximum(0, h), HX, list(col) + [0])
def at2(tab, h, d, end):
    cols = [byH([r[j] for r in tab], h) for j in range(4)] + [end]
    return np.array([np.interp(min(150, max(0, dd)), KM, [c[i] if np.ndim(c) else c for c in cols]) for i, dd in enumerate(d)])
def weights(tier, day, hS, hA, d, hasS, hasA):
    n = len(d); ws = np.zeros(n); wa = np.zeros(n)
    for dn in [True, False]:
        Tt = T[tier]['day' if dn else 'night']; sel = day == dn
        both = sel & hasS & hasA & (d < 150); so = sel & hasS & ~(hasA & (d < 150)); ao = sel & ~hasS & hasA & (d < 150)
        if both.any():
            ws[both] = [np.interp(min(150, dd), KM, [byH([r[j] for r in Tt['pairSat']], hS) for j in range(4)] + [byH(Tt['sat'], hS)]) for dd in d[both]]
            wa[both] = [np.interp(min(150, dd), KM, [byH([r[j] for r in Tt['pairAp']], hA) for j in range(4)] + [0]) for dd in d[both]]
        if so.any(): ws[so] = byH(Tt['sat'], hS)
        if ao.any(): wa[ao] = [np.interp(min(150, dd), KM, [byH([r[j] for r in Tt['apOnly']], hA) for j in range(4)] + [0]) for dd in d[ao]]
    s = ws + wa; k = np.where(s > 1, 1 / np.maximum(s, 1e-9), 1); return ws * k, wa * k
D = load_all(); ST = {**{s['id']: s for s in json.load(open('stations_raw.json'))}, **{s['id']: s for s in json.load(open('stations.json'))}}
autos = [s for s, v in D.groupby('sid')['human'].apply(lambda h: (~h).mean()).items() if v > 0.8]
H = pd.read_pickle('nowcast_H.pkl')
km = lambda a, b: 6371 * 2 * math.asin(math.sqrt(math.sin(math.radians(ST[b]['lat'] - ST[a]['lat']) / 2) ** 2 + math.cos(math.radians(ST[a]['lat'])) * math.cos(math.radians(ST[b]['lat'])) * math.sin(math.radians(ST[b]['lon'] - ST[a]['lon']) / 2) ** 2))
near = {a: min((km(a, b), b) for b in autos) for a in H.index.get_level_values(0).unique()}
A = D[D['sid'].isin(autos)].copy(); A['t'] = A.index; A = A.set_index(['sid', 't'])['low%']
H['aid'] = [near[s][1] for s in H.index.get_level_values(0)]; H['akm'] = [near[s][0] for s in H.index.get_level_values(0)]
H['aLow'] = A.reindex(pd.MultiIndex.from_arrays([H['aid'].values, H.index.get_level_values(1)])).values
wk = np.array([t.isocalendar()[1] % 2 for t in H.index.get_level_values(1)])
G1 = np.arange(0, 1.001, 0.05); out = {}
for h in [0, 1, 2, 3, 4, 6]:
    sh = H.groupby(level=0).shift(-h) if h else H
    m = ((sh['ICON_ccl0'] * sh['Cd0'] / sh['ICON_cc0'].clip(lower=5)).clip(upper=sh['Cd0'])).values
    y = sh['low%'].values; day = (H['sun'] > 5).values
    sat = np.where(H['blind'].values == True, np.nan, H['sLow'].values)
    satT = np.where(day, np.interp(sat, KN, T['low']['satDay']), np.interp(sat, KN, T['low']['satNight']))
    ap = H['nbLow'].values; d = H['nbkm'].values
    ok = ~np.isnan(y) & ~np.isnan(m) & ~np.isnan(H['aLow'].values) & (H['akm'].values < H['nbkm'].values) & (H['akm'].values <= 120)
    hasS = ~np.isnan(satT); hasA = ~np.isnan(ap)
    ws, wa = weights('low', day[ok], h, h, d[ok], hasS[ok], hasA[ok])
    p0 = m[ok] + ws * (np.nan_to_num(satT[ok]) - m[ok]) * hasS[ok] + wa * (np.nan_to_num(ap[ok]) - m[ok]) * hasA[ok]
    aL, ak, yy, dd, ww = H['aLow'].values[ok], H['akm'].values[ok], y[ok], day[ok], wk[ok]
    for dn, lab in [(True, 'day'), (False, 'night')]:
        for c, lo, hi in [(30, 0, 60), (90, 60, 120)]:
            s = (dd == dn) & (ak > lo) & (ak <= hi)
            if s.sum() < 400: continue
            tot = 0; wsel = []
            for k in [0, 1]:
                tr, te = s & (ww != k), s & (ww == k)
                E = np.abs(p0[tr][None] + G1[:, None] * (aL[tr] - p0[tr])[None] - yy[tr][None]).mean(1); w = G1[E.argmin()]; wsel.append(w)
                tot += np.abs(p0[te] + w * (aL[te] - p0[te]) - yy[te]).sum()
            E = np.abs(p0[s][None] + G1[:, None] * (aL[s] - p0[s])[None] - yy[s][None]).mean(1)
            out.setdefault(lab, {}).setdefault(c, []).append(float(G1[E.argmin()]))
            print(f'h={h} {lab} automatique à {lo}-{hi} km (plus proche que l\'observateur): n={s.sum()} actuelle {np.mean(np.abs(p0[s] - yy[s])):.2f} -> {tot / s.sum():.2f} hors échantillon, poids {wsel}', flush=True)
json.dump(out, open('auto_weights.json', 'w')); print(out)
