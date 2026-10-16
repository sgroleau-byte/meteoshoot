# Apprend la couverture combinée (médiane) par échéance, la valide (semaines entrelacées, régions laissées de côté) et
# l'exporte pour l'app (src/weather/blendModel.json).
import json, sys, numpy as np, pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from load import load_all, sun_sin
pd.set_option('display.width', 220)
OUT_JSON = sys.argv[1] if len(sys.argv) > 1 else 'blendModel.json'
D = load_all()
H = D[D['human']].copy()
H['week'] = H.index.isocalendar().week.values; H['fold'] = H['week'] % 5
REG = {'CYGP': 'Est QC', 'CYYY': 'Est QC', 'CYGR': 'Est QC', 'CYZV': 'Est QC', 'CYQB': 'Québec', 'CYOY': 'Québec', 'CYBG': 'Québec', 'CYRJ': 'Québec',
       'CYUL': 'Sud QC', 'CYMX': 'Sud QC', 'CYND': 'Sud QC', 'CYUY': 'Ouest QC', 'CYVO': 'Ouest QC'}
H['region'] = [REG.get(s, {'NS': 'Atlantique', 'NB': 'Atlantique', 'PE': 'Atlantique', 'NL': 'Atlantique', 'ON': 'Ontario', 'MB': 'Prairies', 'SK': 'Prairies', 'AB': 'Prairies', 'BC': 'C.-B.'}.get(p, 'Autre')) for s, p in zip(H['sid'], H['prov'])]
H['sdate'] = pd.DatetimeIndex(H.index - pd.to_timedelta((-H['lon'] / 15).values, unit='h')).strftime('%Y-%m-%d')
# part de l'heure au soleil prévue par ICON: même référence que l'app (src/weather/solar.js)
def dni_ref(h):
    h = np.maximum(h, 0.01); amk = 1 / (np.sin(np.radians(h)) + 0.50572 * np.power(h + 6.07995, -1.6364)); me = 1353 * np.power(0.7, np.power(amk, 0.678))
    dc = 950 - 710 * np.exp(-h / 20.2); t = np.clip((h - 8) / 12, 0, 1); return me + (dc - me) * t * t * (3 - 2 * t)
acc = np.zeros(len(H))
for k in range(12):
    s = sun_sin(H['lat'].values, H['lon'].values, H.index - pd.Timedelta(minutes=60 - (k + 0.5) * 5))
    h = np.degrees(np.arcsin(np.clip(s, -1, 1))); acc += np.where(h > 0, np.sin(np.radians(np.maximum(h, 0))) * dni_ref(h), 0)
H['cdir'] = acc / 12
for L, col in [('0', 'ICON_dir0'), ('1', 'ICON_dir1')]:
    if col in H:
        p = (H[col] / H['cdir']).where(H['cdir'] >= 3).clip(0, 1)
        # rayonnement à T = moyenne de [T-1h, T]: pour les nuages à T, moyenne des rangées T et T+1 (comme l'app pour la 3D)
        nxt = p.groupby(H['sid']).shift(-1); H[f'pSun{L}'] = pd.concat([p, nxt], axis=1).mean(axis=1)
H['sunEl'] = H['sun']
FEATS = ['ICON', 'GEM', 'GFS', 'ECMWF', 'AIFS', 'UKMO', 'NBM', 'IFS9', 'ICONlow', 'pSun', 'sunEl']
def table(L):
    X = pd.DataFrame(index=H.index)
    for m in ['ICON', 'GEM', 'GFS', 'ECMWF', 'AIFS', 'UKMO', 'NBM', 'IFS9']:
        c = f'{m}_cc{L}'; X[m] = H[c] if c in H else np.nan
    X['ICONlow'] = H['ICON_ccl0'] if L == '0' and 'ICON_ccl0' in H else np.nan
    X['pSun'] = H[f'pSun{L}'] if f'pSun{L}' in H else np.nan
    X['sunEl'] = H['sunEl']
    return X
def mets(f, o):
    clear = o <= 25; over = o >= 75
    return {'n': len(o), 'EAM': np.mean(np.abs(f - o)), 'biais': np.mean(f - o), 'FA40': np.mean(f[clear] >= 40), 'FA50': np.mean(f[clear] >= 50),
            'manque30': np.mean(f[over] <= 30), 'cat': np.mean(np.digitize(f, [30, 70]) == np.digitize(o, [30, 70]))}
def boot(eA, eB, dates, n=2000):
    d = pd.DataFrame({'d': eA - eB, 'date': dates}).groupby('date')['d'].mean().values
    rng = np.random.default_rng(0); b = d[rng.integers(0, len(d), (n, len(d)))].mean(1)
    return round(float(d.mean()), 2), [round(x, 2) for x in np.percentile(b, [2.5, 97.5])]
import os
DEPTH=int(os.environ.get('DEPTH','4')); ITER=int(os.environ.get('ITER','220'))
def gbm(): return HistGradientBoostingRegressor(loss='absolute_error', max_depth=DEPTH, max_iter=ITER, learning_rate=0.06*220/ITER, min_samples_leaf=80, l2_regularization=1.0, random_state=0)

import os
for L, name in [('0', 'd0'), ('1', 'd1')]:
    X = table(L); o = H['tot%']; ok = X['ICON'].notna() & o.notna()
    feats = [f for f in FEATS if X.loc[ok, f].notna().mean() > 0.2]
    X = X.loc[ok, feats]; y = o[ok].values.astype(float); folds = H.loc[ok, 'fold'].values
    pred = np.full(len(y), np.nan)
    for k in np.unique(folds):
        tr = folds != k; g = gbm().fit(X.values[tr], y[tr]); pred[~tr] = np.clip(g.predict(X.values[~tr]), 0, 100)
    pd.DataFrame({'sid': H.loc[ok, 'sid'].values, 'time': H.index[ok].astype('int64') // 10**9, 'comb': pred}).to_csv(f'cvpred_{name}.csv', index=False)
    print('sauvé', name, len(y))
