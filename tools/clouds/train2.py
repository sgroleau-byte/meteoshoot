# Combinaison sur deux ans (octobre 2024 à octobre 2026): effet de la 2e année, d'entrées de saison et d'heure solaire, et
# d'un poids accru aux fenêtres de lever et de coucher. Validation: semaines entrelacées, et une année contre l'autre.
import os, sys, json, numpy as np, pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
from load import load_all, sun_sin
pd.set_option('display.width', 220)

def load_year(d, tag):
    cwd = os.getcwd(); os.chdir(d)
    try: D = load_all()
    finally: os.chdir(cwd)
    D = D[D['human']].copy(); D['year'] = tag; return D
dirs = [(BASE, 'A'), (os.path.join(os.path.dirname(BASE), 'verif2'), 'B')]
H = pd.concat([load_year(d, t) for d, t in dirs if os.path.exists(os.path.join(d, 'truth.json'))])
H['week'] = H.index.isocalendar().week.values; H['fold'] = H['week'] % 5
H['sdate'] = pd.DatetimeIndex(H.index - pd.to_timedelta((-H['lon'] / 15).values, unit='h')).strftime('%Y-%m-%d') + H['year']
# part au soleil prévue par ICON (même référence que l'app), moyenne T et T+1
def dni_ref(h):
    h = np.maximum(h, 0.01); amk = 1 / (np.sin(np.radians(h)) + 0.50572 * np.power(h + 6.07995, -1.6364)); me = 1353 * np.power(0.7, np.power(amk, 0.678))
    dc = 950 - 710 * np.exp(-h / 20.2); t = np.clip((h - 8) / 12, 0, 1); return me + (dc - me) * t * t * (3 - 2 * t)
acc = np.zeros(len(H))
for k in range(12):
    s = sun_sin(H['lat'].values, H['lon'].values, H.index - pd.Timedelta(minutes=60 - (k + 0.5) * 5))
    hh = np.degrees(np.arcsin(np.clip(s, -1, 1))); acc += np.where(hh > 0, np.sin(np.radians(np.maximum(hh, 0))) * dni_ref(hh), 0)
H['cdir'] = acc / 12
for L, col in [('0', 'ICON_dir0'), ('1', 'ICON_dir1')]:
    if col in H:
        p = (H[col] / H['cdir']).where(H['cdir'] >= 3).clip(0, 1)
        key = H['sid'] + H['year']; nxt = p.groupby(key).shift(-1); H[f'pSun{L}'] = pd.concat([p, nxt], axis=1).mean(axis=1)
H['sunEl'] = H['sun']
doy = H.index.dayofyear.values; H['doyS'] = np.sin(2 * np.pi * doy / 365.25); H['doyC'] = np.cos(2 * np.pi * doy / 365.25)
H['sHour'] = ((H.index.hour.values + H.index.minute.values / 60 + H['lon'].values / 15) % 24)  # heure solaire locale
BASEF = ['ICON', 'GEM', 'GFS', 'ECMWF', 'AIFS', 'UKMO', 'NBM', 'IFS9', 'ICONlow', 'pSun', 'sunEl']
def table(L, extra):
    X = pd.DataFrame(index=H.index)
    for m in ['ICON', 'GEM', 'GFS', 'ECMWF', 'AIFS', 'UKMO', 'NBM', 'IFS9']:
        c = f'{m}_cc{L}'; X[m] = H[c].values if c in H else np.nan
    X['ICONlow'] = H['ICON_ccl0'].values if L == '0' and 'ICON_ccl0' in H else np.nan
    X['pSun'] = H[f'pSun{L}'].values if f'pSun{L}' in H else np.nan
    X['sunEl'] = H['sunEl'].values
    for e in extra: X[e] = H[e].values
    return X
def gbm(): return HistGradientBoostingRegressor(loss='absolute_error', max_depth=3, max_iter=150, learning_rate=0.088, min_samples_leaf=80, l2_regularization=1.0, random_state=0)
def mets(f, o):
    clear = o <= 25; over = o >= 75
    return {'EAM': np.mean(np.abs(f - o)), 'FA50': np.mean(f[clear] >= 50), 'manque30': np.mean(f[over] <= 30)}
def run(L, extra, years, wwin, label, test_other=False):
    X = table(L, extra); o = H['tot%'].values.astype(float)
    ok = (~np.isnan(X['ICON'].values)) & ~np.isnan(o) & H['year'].isin(years).values
    feats = [f for f in BASEF + extra if np.mean(~np.isnan(X.loc[ok, f].values)) > 0.2]
    Xv = X.loc[ok, feats].values; y = o[ok]; folds = H['fold'].values[ok]; win = H['win'].values[ok]; yr = H['year'].values[ok]
    w = np.where(win, wwin, 1.0)
    pred = np.full(len(y), np.nan)
    if test_other:   # apprendre sur une année, tester sur l'autre
        for a in np.unique(yr):
            tr = yr != a
            if tr.sum() == 0: continue
            g = gbm().fit(Xv[tr], y[tr], sample_weight=w[tr]); pred[~tr] = np.clip(g.predict(Xv[~tr]), 0, 100)
    else:
        for k in np.unique(folds):
            tr = folds != k; g = gbm().fit(Xv[tr], y[tr], sample_weight=w[tr]); pred[~tr] = np.clip(g.predict(Xv[~tr]), 0, 100)
    m = ~np.isnan(pred); icon = Xv[:, feats.index('ICON')]
    r = {'échéance': f'd{L}', 'essai': label, 'n': int(m.sum())}
    for lab, mm in [('tout', m), ('fenêtres', m & win)]:
        a = mets(pred[mm], y[mm]); b = mets(icon[mm], y[mm])
        r[f'{lab} ICON'] = round(b['EAM'], 2); r[f'{lab} comb'] = round(a['EAM'], 2); r[f'{lab} FA50'] = round(a['FA50'], 3)
    return r
rows = []
for L in ['1', '2', '0']:
    rows.append(run(L, [], ['A'], 1.0, 'an 1 seul (référence)'))
    if (H['year'] == 'B').any():
        rows.append(run(L, [], ['A', 'B'], 1.0, '2 ans'))
        rows.append(run(L, ['doyS', 'doyC', 'sHour'], ['A', 'B'], 1.0, '2 ans + saison + heure solaire'))
        rows.append(run(L, ['doyS', 'doyC', 'sHour'], ['A', 'B'], 3.0, '2 ans + saison + heure + fenêtres x3'))
        rows.append(run(L, ['doyS', 'doyC', 'sHour'], ['A', 'B'], 1.0, 'une année contre l autre', test_other=True))
    print(pd.DataFrame(rows[-5:] if (H['year'] == 'B').any() else rows[-1:]).to_string(index=False), flush=True)
pd.DataFrame(rows).to_csv('train2_res.csv', index=False)
