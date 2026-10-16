# Nuages bas combinés (16 octobre 2026). Échéance courte (d0): archive des prévisions courtes (12 mois, tous les modèles ont
# leur couverture basse). Veille et avant-veille (d1, d2): calculs complets de 12 h UTC (avril à octobre 2026, scratchpad
# runs/), seule archive qui garde la couverture basse à toutes les échéances. Cible: nuages bas observés (huitièmes des
# couches sous 6 500 pieds, observateurs canadiens). Référence: la méthode actuelle de l'app (bas d'ICON mis à l'échelle
# du total combiné).
import os, sys, json, glob, numpy as np, pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
BASE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, BASE)
from load import load_all, sun_sin
OUT = sys.argv[1] if len(sys.argv) > 1 else 'blendLow.json'
pd.set_option('display.width', 220)
D = load_all(); H = D[D['human']].copy()
H['week'] = H.index.isocalendar().week.values; H['fold'] = H['week'] % 5
REG = {'CYGP': 'Est QC', 'CYYY': 'Est QC', 'CYGR': 'Est QC', 'CYZV': 'Est QC', 'CYQB': 'Québec', 'CYOY': 'Québec', 'CYBG': 'Québec', 'CYRJ': 'Québec', 'CYUL': 'Sud QC', 'CYMX': 'Sud QC', 'CYND': 'Sud QC', 'CYUY': 'Ouest QC', 'CYVO': 'Ouest QC'}
def region(s, p): return REG.get(s, {'NS': 'Atlantique', 'NB': 'Atlantique', 'PE': 'Atlantique', 'NL': 'Atlantique', 'ON': 'Ontario', 'MB': 'Prairies', 'SK': 'Prairies', 'AB': 'Prairies', 'BC': 'C.-B.'}.get(p, 'Autre'))
H['region'] = [region(s, p) for s, p in zip(H['sid'], H['prov'])]

def dni_ref(h):
    h = np.maximum(h, 0.01); amk = 1 / (np.sin(np.radians(h)) + 0.50572 * np.power(h + 6.07995, -1.6364)); me = 1353 * np.power(0.7, np.power(amk, 0.678))
    dc = 950 - 710 * np.exp(-h / 20.2); t = np.clip((h - 8) / 12, 0, 1); return me + (dc - me) * t * t * (3 - 2 * t)
def clear_dir(lat, lon, idx):
    acc = np.zeros(len(idx))
    for k in range(12):
        s = sun_sin(lat, lon, idx - pd.Timedelta(minutes=60 - (k + 0.5) * 5)); hh = np.degrees(np.arcsin(np.clip(s, -1, 1)))
        acc += np.where(hh > 0, np.sin(np.radians(np.maximum(hh, 0))) * dni_ref(hh), 0)
    return acc / 12
def gbm(): return HistGradientBoostingRegressor(loss='absolute_error', max_depth=3, max_iter=150, learning_rate=0.088, min_samples_leaf=80, l2_regularization=1.0, random_state=0)
TOTF = ['ICON', 'GEM', 'GFS', 'ECMWF', 'AIFS', 'UKMO', 'NBM', 'IFS9']
LOWF = ['ICONlow', 'GEMlow', 'GFSlow', 'ECMWFlow', 'AIFSlow', 'UKMOlow']
blend = json.load(open('blend_final.json'))
def tree_predict(m, X):
    out = np.full(len(X), m['base'])
    for t in m['trees']:
        node = np.zeros(len(X), int)
        for _ in range(12):
            leaf = np.array(t['leaf'])[node] == 1
            if leaf.all(): break
            f = np.array(t['f'])[node]; th = np.array(t['th'])[node]; v = X[np.arange(len(X)), f]
            go_left = np.where(np.isnan(v), np.array(t['ml'])[node] == 1, v <= th)
            nxt = np.where(go_left, np.array(t['l'])[node], np.array(t['r'])[node]); node = np.where(leaf, node, nxt)
        out += np.array(t['v'])[node]
    return out

def build_d0():
    X = pd.DataFrame(index=H.index)
    for m in TOTF: X[m] = H.get(f'{m}_cc0', np.nan)
    for m in ['ICON', 'GEM', 'GFS', 'ECMWF', 'AIFS', 'UKMO']: X[m + 'low'] = H.get(f'{m}_ccl0', np.nan)
    p = (H['ICON_dir0'] / clear_dir(H['lat'].values, H['lon'].values, H.index)).where(clear_dir(H['lat'].values, H['lon'].values, H.index) >= 3).clip(0, 1)
    nxt = p.groupby(H['sid']).shift(-1); X['pSun'] = pd.concat([p, nxt], axis=1).mean(axis=1)
    X['sunEl'] = H['sun']; X['lead'] = np.nan
    return X

def build_runs():
    S = [s for s in json.load(open(os.path.join(BASE, '..', 'runs', 'stations.json'))) if s['id'] not in set('CYBC CYFC CYHU CYLW CYMT CYQG CYRQ CYSC CYXS CYJT CYML'.split())]
    obs = H[['sid', 'tot%', 'low%', 'fold', 'region', 'win']].copy(); obs['t'] = obs.index
    parts = []
    for f in sorted(glob.glob(os.path.join(BASE, '..', 'runs', 'data', '*.json'))):
        run = pd.Timestamp(os.path.basename(f)[:13].replace('T12', 'T12:00'), tz='UTC')
        J = json.load(open(f)); J = J if isinstance(J, list) else [J]
        for s, r in zip(S, J):
            h = r['hourly']; idx = pd.to_datetime(h['time'], utc=True)
            g = lambda v, m: np.array(h.get(f'{v}_{m}', [None] * len(idx)), dtype=float)
            X = pd.DataFrame(index=idx)
            X['ICON'] = g('cloud_cover', 'icon_global'); X['ICONlow'] = g('cloud_cover_low', 'icon_global')
            hr = g('cloud_cover', 'gem_hrdps_continental'); rd = g('cloud_cover', 'gem_regional'); X['GEM'] = np.where(np.isnan(hr), rd, hr)
            hr = g('cloud_cover_low', 'gem_hrdps_continental'); rd = g('cloud_cover_low', 'gem_regional'); X['GEMlow'] = np.where(np.isnan(hr), rd, hr)
            hr = g('cloud_cover', 'gfs_hrrr'); gl = g('cloud_cover', 'gfs_global'); X['GFS'] = np.where(np.isnan(hr), gl, hr)
            hr = g('cloud_cover_low', 'gfs_hrrr'); gl = g('cloud_cover_low', 'gfs_global'); X['GFSlow'] = np.where(np.isnan(hr), gl, hr)
            for a, m in [('ECMWF', 'ecmwf_ifs025'), ('AIFS', 'ecmwf_aifs025_single'), ('UKMO', 'ukmo_global_deterministic_10km')]:
                X[a] = g('cloud_cover', m); X[a + 'low'] = g('cloud_cover_low', m)
            X['NBM'] = np.nan; X['IFS9'] = np.nan
            cd = clear_dir(s['lat'], s['lon'], idx); dr = g('direct_radiation', 'icon_global')
            p = pd.Series(np.where(cd >= 3, np.clip(dr / np.maximum(cd, 1e-6), 0, 1), np.nan), index=idx)
            X['pSun'] = pd.concat([p, p.shift(-1)], axis=1).mean(axis=1).values
            X['sunEl'] = np.degrees(np.arcsin(np.clip(sun_sin(s['lat'], s['lon'], idx), -1, 1)))
            X['lead'] = (idx - run).total_seconds() / 3600; X['sid'] = s['id']; X['t'] = idx
            parts.append(X[(X['lead'] >= 10) & (X['lead'] <= 72)])
    if not parts: return None
    R = pd.concat(parts)
    R = R.merge(obs, on=['sid', 't'], how='inner')
    return R

def mets(f, o):
    clear = o <= 25
    return {'EAM': round(float(np.mean(np.abs(f - o))), 2), 'biais': round(float(np.mean(f - o)), 2), 'FA bas>=40 (réel<=2/8)': round(float(np.mean(f[clear] >= 40)), 3) if clear.any() else np.nan}

def evaluate(name, X, ylow, ytot, folds, reg, win, totModel, feats):
    Xv = X[feats].values.astype(float)
    # référence: méthode actuelle de l'app (bas d'ICON x total combiné / total d'ICON)
    comb = np.clip(tree_predict(totModel, X[totModel['features']].values.astype(float)), 0, 100)
    ico = X['ICON'].values; low_app = np.minimum(comb, np.where(ico >= 5, X['ICONlow'].values * comb / np.maximum(ico, 5), comb * 0.6))
    pred = np.full(len(ylow), np.nan)
    for k in np.unique(folds):
        tr = folds != k; g = gbm().fit(Xv[tr], ylow[tr]); pred[~tr] = np.clip(g.predict(Xv[~tr]), 0, 100)
    predR = np.full(len(ylow), np.nan)
    for r in np.unique(reg):
        tr = reg != r; g = gbm().fit(Xv[tr], ylow[tr]); predR[~tr] = np.clip(g.predict(Xv[~tr]), 0, 100)
    rows = []
    for lab, m in [('toutes heures', np.ones(len(ylow), bool)), ('fenêtres lever/coucher', win)]:
        rows.append({'échéance': name, 'heures': lab, 'méthode': 'ICON bas brut', **mets(X['ICONlow'].values[m], ylow[m])})
        rows.append({'échéance': name, 'heures': lab, 'méthode': 'app actuelle (ICON x combiné)', **mets(low_app[m], ylow[m])})
        rows.append({'échéance': name, 'heures': lab, 'méthode': 'nuages bas combinés (semaines)', **mets(pred[m], ylow[m])})
        rows.append({'échéance': name, 'heures': lab, 'méthode': 'nuages bas combinés (région exclue)', **mets(predR[m], ylow[m])})
    print(pd.DataFrame(rows).to_string(index=False), flush=True)
    E = pd.DataFrame({'r': reg, 'app': np.abs(low_app - ylow), 'comb': np.abs(pred - ylow)}); print(E.groupby('r').mean().round(1).assign(n=E.groupby('r').size()).to_string())
    g = gbm().fit(Xv, ylow); return g

def export(g, feats):
    trees = []
    for it in g._predictors:
        nd = it[0].nodes
        trees.append({'f': nd['feature_idx'].tolist(), 'th': [round(float(v), 6) if np.isfinite(v) else 0 for v in nd['num_threshold']], 'l': nd['left'].tolist(), 'r': nd['right'].tolist(),
                      'v': [round(float(v), 3) for v in nd['value']], 'ml': nd['missing_go_to_left'].astype(int).tolist(), 'leaf': nd['is_leaf'].astype(int).tolist()})
    return {'features': feats, 'base': round(float(np.asarray(g._baseline_prediction).ravel()[0]), 4), 'trees': trees}

EXP = {}
# d0
X0 = build_d0(); ok = X0['ICON'].notna() & H['low%'].notna()
f0 = [f for f in TOTF + LOWF + ['pSun', 'sunEl'] if X0.loc[ok, f].notna().mean() > 0.2]
g0 = evaluate('d0', X0.loc[ok], H.loc[ok, 'low%'].values.astype(float), H.loc[ok, 'tot%'].values, H.loc[ok, 'fold'].values, H.loc[ok, 'region'].values, H.loc[ok, 'win'].values, blend['d0'], f0)
EXP['low_d0'] = export(g0, f0)
# d1, d2 (calculs complets)
R = build_runs()
if R is not None and len(R) > 5000:
    for name, lo, hi, tm in [('d1', 10, 44, 'd1'), ('d2', 44, 72, 'd2')]:
        Rb = R[(R['lead'] >= lo) & (R['lead'] < hi)].dropna(subset=['ICON', 'low%'])
        fb = [f for f in TOTF + LOWF + ['pSun', 'sunEl'] if Rb[f].notna().mean() > 0.2]
        print(f'\n{name}: {len(Rb)} heures, {Rb.sid.nunique()} stations, {Rb.t.dt.date.nunique()} jours')
        g = evaluate(name, Rb, Rb['low%'].values.astype(float), Rb['tot%'].values, Rb['fold'].values, Rb['region'].values, Rb['win'].values, blend[tm], fb)
        EXP['low_' + name] = export(g, fb)
json.dump(EXP, open(OUT, 'w'), separators=(',', ':'), allow_nan=False)
print('exporté', OUT, list(EXP))
