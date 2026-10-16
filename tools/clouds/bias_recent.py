# Correction par l'erreur récente (16 octobre 2026; résultat: aucun gain, poids optimal nul): la combinaison de la veille corrigée de son biais des derniers jours au
# même aéroport (heures connues au moment où la prévision est publiée, soit au moins 30 h avant l'heure visée).
import numpy as np, pandas as pd
from load import load_all
D = load_all(); H = D[D['human']].copy()
P = pd.read_csv('cvpred_d1.csv'); ts = (np.ceil(P['time'].values * 1000 / 3600) * 3600).astype('int64')
P['t'] = pd.to_datetime(ts, unit='s', utc=True)
H['t'] = H.index; H = H.reset_index(drop=True)
P['t'] = P['t'].dt.as_unit(H['t'].dt.unit)
Z = H[['sid', 't', 'tot%', 'sun']].merge(P[['sid', 't', 'comb']], on=['sid', 't']).dropna().sort_values(['sid', 't'])
Z['e'] = Z['tot%'] - Z['comb']
out = []
for win in [24, 72, 168]:
    for lag in [30]:
        def f(g):
            s = g.set_index('t')['e']
            r = s.rolling(f'{win}h').mean().shift(freq=f'{lag}h')  # moyenne des erreurs sur [t-lag-win, t-lag]
            rm = s.rolling(f'{win}h').median().shift(freq=f'{lag}h')
            return pd.DataFrame({'bias': r, 'biasMed': rm}).reindex(s.index)
        B = Z.groupby('sid', group_keys=True).apply(f).reset_index()
        Y = Z.merge(B, on=['sid', 't']).dropna()
        wk = np.array([t.isocalendar()[1] % 2 for t in Y['t']])
        for col in ['bias', 'biasMed']:
            best = []
            for k in [0, 1]:
                tr, te = wk != k, wk == k
                al = np.arange(0, 1.01, 0.05); E = [np.mean(np.abs(Y['comb'][tr] + a * Y[col][tr] - Y['tot%'][tr])) for a in al]; a = al[int(np.argmin(E))]
                best.append((a, np.abs(np.clip(Y['comb'][te] + a * Y[col][te], 0, 100) - Y['tot%'][te]).sum()))
            out.append({'fenêtre (h)': win, 'mesure': col, 'n': len(Y), 'combinaison': round(float(np.mean(np.abs(Y['comb'] - Y['tot%']))), 2), 'corrigée': round(sum(b[1] for b in best) / len(Y), 2), 'alpha': [b[0] for b in best]})
            print(out[-1], flush=True)
