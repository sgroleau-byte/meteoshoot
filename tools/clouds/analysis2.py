# Banc de vérification v2 (méthode révisée d'après la critique): échéance réaliste day1 en principal, une valeur par
# fenêtre de tournage, modèles calibrés avant combinaison, validation croisée par semaines entrelacées, bootstrap par jour.
import json, sys, numpy as np, pandas as pd
from sklearn.isotonic import IsotonicRegression
from scipy.optimize import nnls
from load import load_all
pd.set_option('display.width', 220)
GLOB = ['ICON', 'GEM', 'GFS', 'ECMWF', 'AIFS', 'UKMO']   # GEM = HRDPS et GFS = HRRR aux courtes échéances (doublons retirés)
D = load_all()
H = D[D['human']].copy()
H = H[H['sun'] > -6]                                    # jour et crépuscule civil seulement
# date solaire locale: une séance du soir n'est pas coupée à minuit UTC
H['sdate'] = pd.DatetimeIndex(H.index - pd.to_timedelta((-H['lon'] / 15).values, unit='h')).strftime('%Y-%m-%d')
H['week'] = H.index.isocalendar().week.values
H['fold'] = H['week'] % 5
REG = {'CYGP': 'Est du Québec', 'CYYY': 'Est du Québec', 'CYGR': 'Est du Québec', 'CYZV': 'Est du Québec',
       'CYQB': 'Québec-Saguenay', 'CYOY': 'Québec-Saguenay', 'CYBG': 'Québec-Saguenay', 'CYRJ': 'Québec-Saguenay',
       'CYUL': 'Sud du Québec', 'CYMX': 'Sud du Québec', 'CYND': 'Sud du Québec', 'CYUY': 'Ouest du Québec', 'CYVO': 'Ouest du Québec'}
H['region'] = [REG.get(s, {'NS': 'Atlantique', 'NB': 'Atlantique', 'PE': 'Atlantique', 'NL': 'Atlantique', 'ON': 'Ontario', 'MB': 'Prairies', 'SK': 'Prairies', 'AB': 'Prairies', 'BC': 'Colombie-Britannique'}.get(p, 'Autre')) for s, p in zip(H['sid'], H['prov'])]
# rapport du direct prévu par ICON au direct par ciel clair (part de l'heure au soleil), heures où le ciel clair donne assez
def dni_clear_h(sin_el):
    el = np.degrees(np.arcsin(np.clip(sin_el, 1e-3, 1)))
    am = 1 / (np.sin(np.radians(el)) + 0.50572 * np.power(el + 6.07995, -1.6364))
    return 1353 * np.power(0.7, np.power(am, 0.678)) * np.sin(np.radians(el))
from load import sun_sin
def clear_dir(df):
    acc = np.zeros(len(df))
    for k in range(12):
        s = sun_sin(df['lat'].values, df['lon'].values, df.index - pd.Timedelta(minutes=5 * k + 2.5))
        acc += np.where(s > 0.02, dni_clear_h(s), 0)
    return acc / 12
H['cdir'] = clear_dir(H)
for lead, col in [('0', 'ICON_dir0'), ('1', 'ICON_dir1')]:
    if col in H: H[f'pdir{lead}'] = (H[col] / H['cdir']).where(H['cdir'] > 40).clip(0, 1.2)
# le rayonnement à T est la moyenne de [T-1h, T]: pour l'heure T on prend la moyenne des rangées T et T+1 de la même station
for lead in ['0', '1']:
    c = f'pdir{lead}'
    if c in H:
        nxt = H.groupby('sid')[c].shift(-1)
        H[c + 'm'] = pd.concat([H[c], nxt], axis=1).mean(axis=1)

def event_table(lead):
    """Une rangée par station, date solaire et fenêtre (lever, coucher): moyennes des heures pleines de la fenêtre."""
    cols = [f'{m}_cc{lead}' for m in GLOB if f'{m}_cc{lead}' in H] + [c for c in [f'ICON_ccl0', f'pdir{lead}m', 'ICON_t2', 'ICON_td2', 'ICON_rh850', 'ICON_rh925'] if c in H]
    W = H[H['win']]
    agg = W.groupby(['sid', 'sdate', 'wkind']).agg(**{'obs': ('tot%', 'mean'), 'obsl': ('low%', 'mean'), 'n': ('tot%', 'size'), 'fold': ('fold', 'first'), 'region': ('region', 'first')},
                                                   **{c: (c, 'mean') for c in cols})
    return agg.reset_index()

def mets(f, o):
    f = np.asarray(f, float); o = np.asarray(o, float)
    clear = o <= 25; over = o >= 75
    return {'n': len(o), 'EAM': np.mean(np.abs(f - o)), 'biais': np.mean(f - o),
            'FA40': np.mean(f[clear] >= 40) if clear.any() else np.nan,   # réel dégagé (au plus 2/8), annoncé 40 % ou plus
            'FA50': np.mean(f[clear] >= 50) if clear.any() else np.nan,
            'manque': np.mean(f[over] <= 30) if over.any() else np.nan,   # réel couvert (6/8 ou plus), annoncé 30 % ou moins
            'cat': np.mean(np.digitize(f, [30, 70]) == np.digitize(o, [30, 70]))}

def cv_iso(x, y, folds):
    out = np.full(len(y), np.nan)
    for k in np.unique(folds):
        tr = folds != k
        ir = IsotonicRegression(y_min=0, y_max=100, out_of_bounds='clip').fit(x[tr], y[tr]); out[~tr] = ir.predict(x[~tr])
    return out

def cv_weights(X, y, folds, shrink=0.3):
    """poids positifs de somme 1 sur des prévisions calibrées, ramenés vers des poids égaux"""
    out = np.full(len(y), np.nan); Ws = []
    k_ = X.shape[1]
    for k in np.unique(folds):
        tr = folds != k
        w, _ = nnls(X[tr], y[tr]); w = w / w.sum() if w.sum() > 0 else np.ones(k_) / k_
        w = (1 - shrink) * w + shrink / k_; Ws.append(w); out[~tr] = X[~tr] @ w
    return out, np.mean(Ws, 0), np.std(Ws, 0)

def boot_diff(eA, eB, dates, n=3000):
    d = pd.DataFrame({'d': eA - eB, 'date': dates}).groupby('date')['d'].mean().values
    rng = np.random.default_rng(0); b = d[rng.integers(0, len(d), (n, len(d)))].mean(1)
    return float(np.mean(d)), np.percentile(b, [2.5, 97.5]).tolist()

RES = {}
for lead in ['1', '0', '2']:
    E = event_table(lead)
    if f'ICON_cc{lead}' not in E: continue
    E = E[E[f'ICON_cc{lead}'].notna()]
    models = [m for m in GLOB if f'{m}_cc{lead}' in E and E[f'{m}_cc{lead}'].notna().mean() > 0.5]
    if len(models) < 2: continue
    E = E.dropna(subset=[f'{m}_cc{lead}' for m in models] + ['obs'])
    if len(E) < 300: continue
    o = E['obs'].values; folds = E['fold'].values
    rows = []
    cal = {}
    for m in models:
        raw = E[f'{m}_cc{lead}'].values
        cal[m] = cv_iso(raw, o, folds)
        rows.append({'méthode': f'{m} brut', **mets(raw, o)})
        rows.append({'méthode': f'{m} calibré', **mets(cal[m], o)})
    X = np.column_stack([cal[m] for m in models])
    rows.append({'méthode': 'moyenne calibrée', **mets(X.mean(1), o)})
    rows.append({'méthode': 'médiane calibrée', **mets(np.median(X, 1), o)})
    pw, w, ws = cv_weights(X, o, folds)
    rows.append({'méthode': 'poids appris', **mets(pw, o)})
    # ICON + son rayonnement direct (fenêtres où le ciel clair donne assez de direct)
    pc = f'pdir{lead}m'
    extra = {}
    if pc in E:
        ok = E[pc].notna().values
        if ok.sum() > 200:
            Xi = np.column_stack([E['ICON_cc' + lead].values[ok], E[pc].values[ok]])
            # régression isotone 2D approchée: table par cases (couverture ICON x part au soleil), lissée
            from sklearn.ensemble import HistGradientBoostingRegressor
            pred = np.full(ok.sum(), np.nan)
            for k in np.unique(folds[ok]):
                tr = folds[ok] != k
                g = HistGradientBoostingRegressor(max_depth=3, max_iter=150, learning_rate=0.06, monotonic_cst=[1, -1]).fit(Xi[tr], o[ok][tr])
                pred[~tr] = np.clip(g.predict(Xi[~tr]), 0, 100)
            rows.append({'méthode': 'ICON calibré (fenêtres avec soleil)', **mets(cal['ICON'][ok], o[ok])})
            rows.append({'méthode': 'ICON + rayonnement direct ICON', **mets(pred, o[ok])})
            # tous les modèles + rayonnement ICON
            Xa = np.column_stack([X[ok], E[pc].values[ok]])
            pred2 = np.full(ok.sum(), np.nan)
            for k in np.unique(folds[ok]):
                tr = folds[ok] != k
                g = HistGradientBoostingRegressor(max_depth=3, max_iter=150, learning_rate=0.06).fit(Xa[tr], o[ok][tr])
                pred2[~tr] = np.clip(g.predict(Xa[~tr]), 0, 100)
            rows.append({'méthode': 'poids appris (fenêtres avec soleil)', **mets(pw[ok], o[ok])})
            rows.append({'méthode': 'tous + rayonnement ICON', **mets(pred2, o[ok])})
            extra['ok'] = ok; extra['pred'] = pred; extra['pred2'] = pred2
    T = pd.DataFrame(rows)
    print(f'\n==================== échéance day{lead}  ({len(E)} fenêtres, {E.sid.nunique()} stations, modèles {models})')
    print(T.to_string(index=False, float_format=lambda x: f'{x:.3f}' if abs(x) < 1 else f'{x:.1f}'))
    print('poids appris (moyenne, écart entre plis):', {m: (round(a, 2), round(b, 2)) for m, a, b in zip(models, w, ws)})
    eI = np.abs(E['ICON_cc' + lead].values - o); eW = np.abs(pw - o)
    print('écart EAM ICON brut moins poids appris, bootstrap par jour:', boot_diff(eI, eW, E['sdate'].values))
    eC = np.abs(cal['ICON'] - o); print('écart EAM ICON calibré moins poids appris:', boot_diff(eC, eW, E['sdate'].values))
    if 'pred' in extra:
        ok = extra['ok']; print('écart EAM ICON calibré moins ICON+rayonnement:', boot_diff(np.abs(cal['ICON'][ok] - o[ok]), np.abs(extra['pred'] - o[ok]), E['sdate'].values[ok]))
        print('écart EAM poids appris moins tous+rayonnement:', boot_diff(np.abs(pw[ok] - o[ok]), np.abs(extra['pred2'] - o[ok]), E['sdate'].values[ok]))
    # par région (EAM), ICON brut vs poids appris
    E['eI'] = eI; E['eW'] = eW; E['eC'] = eC
    for m in models: E['e_' + m] = np.abs(E[f'{m}_cc{lead}'] - o)
    print('EAM par région:'); print(E.groupby('region')[['eI', 'eC', 'eW'] + ['e_' + m for m in models]].mean().round(1).assign(n=E.groupby('region').size()).to_string())
    RES[f'day{lead}'] = {'table': T.to_dict('records'), 'poids': dict(zip(models, np.round(w, 3).tolist())), 'n': len(E)}
json.dump(RES, open('res_v2.json', 'w'), indent=1, default=float)
