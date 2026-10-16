# Tables finales de la correction en direct (16 octobre 2026). Fond: prévision courte combinée (d0). Pour chaque étage (total,
# bas), moment (jour: soleil > 5° à l'heure de l'observation; nuit sinon, crépuscule compris), échéance h (0 à 6 h) et classe
# de distance de l'aéroport avec observateur le plus proche: poids du satellite étalonné et de l'aéroport (grille, écart
# absolu moyen minimal), plus les poids de l'aéroport seul (satellite absent, au nord de 50,7°). Lissés ensuite: jamais en
# hausse avec l'échéance, et pour l'aéroport jamais en hausse avec la distance.
import numpy as np, pandas as pd, json
from sklearn.isotonic import IsotonicRegression
import sys
H = pd.read_pickle('nowcast_H.pkl')
PART = sys.argv[1] if len(sys.argv) > 1 else None  # 'pair' ou 'impair': calage sur une moitié des semaines seulement
if PART:
    wk = np.array([t.isocalendar()[1] % 2 for t in H.index.get_level_values(1)])
    H = H[wk == (0 if PART == 'pair' else 1)]
KN = [0, 2, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100]
HS = [0, 1, 2, 3, 4, 6]
CL = [('0', 0, 0.5), ('30', 0.5, 60), ('75', 60, 90), ('120', 90, 150)]  # centre de classe (km): au lieu, <60, 60-90, 90-150
G2 = np.array([(a, b) for a in np.arange(0, 1.001, 0.05) for b in np.arange(0, 1.001, 0.05) if a + b <= 1.0001]); G1 = np.arange(0, 1.001, 0.05)
def build(h, ycol, scol, ncol):
    sh = H.groupby(level=0).shift(-h) if h else H
    X = pd.DataFrame({'y': sh[ycol], 'm': sh['Cd0'], 'sat': H[scol], 'nb': H[ncol], 'km': H['nbkm'], 'own': H[ycol], 'day': H['sun'] > 5, 'blind': H['blind']})
    if ycol == 'low%':
        X['m'] = (sh['ICON_ccl0'] * sh['Cd0'] / sh['ICON_cc0'].clip(lower=5)).clip(upper=sh['Cd0'])
        X.loc[X['blind'] == True, 'sat'] = np.nan
    return X.dropna(subset=['y', 'm'])
# Étalonnage par la médiane (l'écart absolu moyen est le critère, comme pour la combinaison): médiane lissée de
# l'observé autour de chaque valeur du satellite (huitièmes étalés sur leur demi-pas pour une valeur continue), croissante.
def med_table(x, y):
    x = np.asarray(x, float); y = np.asarray(y, float); rng = np.random.default_rng(0); out = []
    for k in KN:
        w = 1.0
        while (np.abs(x - k) <= w).sum() < 400 and w <= 15: w += 1
        yy = y[np.abs(x - k) <= w]; yy = np.clip(np.repeat(yy, 20) + rng.uniform(-6.25, 6.25, len(yy) * 20), 0, 100)
        out.append(np.median(yy))
    return np.maximum.accumulate(np.array(out))
mae = lambda p, y: float(np.mean(np.abs(p - y)))
OUT = {'knots': KN, 'h': HS, 'km': [0, 30, 75, 120, 150]}
for tier, ycol, scol, ncol in [('tot', 'tot%', 'tcf', 'nbTot'), ('low', 'low%', 'sLow', 'nbLow')]:
    X0 = build(0, ycol, scol, ncol); X0 = X0[X0['sat'].notna()]
    # étalonnage seulement là où il aide une fois mélangé à la prévision (banc croisé): total de jour et nuages bas de nuit;
    # ailleurs le satellite brut (table identité) fait mieux
    CAL = {('tot', True): 'med', ('tot', False): 'raw', ('low', True): 'raw', ('low', False): 'med'}
    T = {dn: (med_table(X0.loc[X0['day'] == dn, 'sat'], X0.loc[X0['day'] == dn, 'y']) if CAL[(tier, dn)] == 'med' else np.array(KN, float)) for dn in [True, False]}
    OUT[tier] = {'satDay': [round(float(v), 1) for v in T[True]], 'satNight': [round(float(v), 1) for v in T[False]]}
    for dn, lab in [(True, 'day'), (False, 'night')]:
        S0 = np.zeros(len(HS)); WS = np.zeros((len(HS), len(CL))); WA = np.zeros((len(HS), len(CL))); WA1 = np.zeros((len(HS), len(CL)))
        for i, h in enumerate(HS):
            X = build(h, ycol, scol, ncol); X = X[X['day'] == dn]
            sT = np.interp(X['sat'], KN, T[dn]); X = X.assign(sT=np.where(X['sat'].notna(), sT, np.nan))
            q = X[X['sT'].notna()]
            E = np.abs(q['m'].values[None] + G1[:, None] * (q['sT'] - q['m']).values[None] - q['y'].values[None]).mean(1); S0[i] = G1[E.argmin()]
            for j, (c, lo, hi) in enumerate(CL):
                Z = X.assign(ap=X['own']) if c == '0' else X[(X['km'] > lo) & (X['km'] <= hi)].assign(ap=lambda r: r['nb'])
                Z = Z.dropna(subset=['ap'])
                z2 = Z[Z['sT'].notna()]
                E = np.abs(z2['m'].values[None] + G2[:, :1] * (z2['sT'] - z2['m']).values[None] + G2[:, 1:] * (z2['ap'] - z2['m']).values[None] - z2['y'].values[None]).mean(1)
                WS[i, j], WA[i, j] = G2[E.argmin()]
                E = np.abs(Z['m'].values[None] + G1[:, None] * (Z['ap'] - Z['m']).values[None] - Z['y'].values[None]).mean(1); WA1[i, j] = G1[E.argmin()]
        # lissage: non croissant avec h; aéroport non croissant avec la distance
        mono_h = lambda A: np.minimum.accumulate(A, axis=0)
        S0 = np.minimum.accumulate(S0); WS = mono_h(WS); WA = np.minimum.accumulate(mono_h(WA), axis=1); WA1 = np.minimum.accumulate(mono_h(WA1), axis=1)
        OUT[tier][lab] = {'sat': S0.round(2).tolist(), 'pairSat': WS.round(2).tolist(), 'pairAp': WA.round(2).tolist(), 'apOnly': WA1.round(2).tolist()}
        print(tier, lab, 'satellite seul', S0.round(2).tolist()); print('  avec aéroport: satellite', WS.round(2).tolist()); print('  aéroport', WA.round(2).tolist()); print('  aéroport seul', WA1.round(2).tolist(), flush=True)
json.dump(OUT, open(f'nowcast_tables{"_" + PART if PART else ""}.json', 'w'))
print(json.dumps(OUT)[:300])
