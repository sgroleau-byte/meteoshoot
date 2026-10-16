# Export des rangées du banc pour rejouer le code de l'app (nowcast_replay.mjs): fond = prévision courte combinée (d0),
# satellite brut, aéroport voisin et celui du lieu, échéances 0 à 4 h. Produit bench_rows.csv, et bench_rows_pair.csv /
# bench_rows_impair.csv (semaines paires et impaires) pour la mesure hors échantillon avec les tables de nowcast_fit.py.
import numpy as np, pandas as pd
H = pd.read_pickle('nowcast_H.pkl')
wk = np.array([t.isocalendar()[1] % 2 for t in H.index.get_level_values(1)])
out = []
for h in [0, 1, 2, 3, 4]:
    sh = H.groupby(level=0).shift(-h) if h else H
    X = pd.DataFrame({'y': sh['tot%'], 'yL': sh['low%'], 'm': sh['Cd0'], 'mL': (sh['ICON_ccl0'] * sh['Cd0'] / sh['ICON_cc0'].clip(lower=5)).clip(upper=sh['Cd0']),
                      'tcf': H['tcf'], 'sLow': H['sLow'], 'sMid': H['sMid'], 'sHigh': H['sHigh'], 'blind': H['blind'].astype(float), 'nb': H['nbTot'], 'nbL': H['nbLow'], 'km': H['nbkm'],
                      'own': H['tot%'], 'ownL': H['low%'], 'sun': H['sun'], 'h': h, 'wk': wk})
    out.append(X.dropna(subset=['y', 'm', 'tcf']))
D = pd.concat(out).reset_index()
cols = ['sid', 'h', 'y', 'yL', 'm', 'mL', 'tcf', 'sLow', 'sMid', 'sHigh', 'blind', 'nb', 'nbL', 'km', 'own', 'ownL', 'sun']
D[cols].to_csv('bench_rows.csv', index=False)
for k, P in [(0, 'pair'), (1, 'impair')]: D[D['wk'] == k][cols].to_csv(f'bench_rows_{P}.csv', index=False)
print(len(D), 'rangées')
