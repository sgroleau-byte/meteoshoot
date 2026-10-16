# Calage de la correction en direct (16 octobre 2026): satellite GOES-19 au-dessus du lieu, aéroport VOISIN (le cas d'un
# projet loin de l'aéroport), et prévision combinée (prédictions croisées, sans fuite). Cible: couverture observée au lieu
# (aéroport cible) h heures plus tard. Poids ajustés par moindres carrés, positifs, de jour et de nuit.
import json, glob, math, numpy as np, pandas as pd
from scipy.optimize import nnls
from load import load_all
D = load_all(); H = D[D['human']].copy(); H['t'] = H.index
ST = {s['id']: s for s in json.load(open('stations.json'))}
# satellite
rows = []
for f in sorted(glob.glob('goes_samples/*.json')):
    t = pd.Timestamp(f.split('/')[-1][:10], tz='UTC') if False else pd.to_datetime(f.split('/')[-1][:10], format='%Y%m%d%H', utc=True)
    for sid, v in json.load(open(f))['st'].items(): rows.append((sid, t, *v))
G = pd.DataFrame(rows, columns=['sid', 't', 'tcf', 'cf1', 'cf2', 'cf3', 'cf4', 'cf5'])
u = lambda *a: 1 - np.prod([1 - x for x in a], axis=0)
el = G['sid'].map(lambda s: ST[s].get('elev') or 0).astype(float).values
f2 = np.clip((el + 2000 - 1524) / 1524, 0, 1)
c = {k: G[k].values / 100 for k in ['cf1', 'cf2', 'cf3', 'cf4', 'cf5']}
G['sLow'] = 100 * u(c['cf1'], f2 * c['cf2']); G['sMid'] = 100 * u((1 - f2) * c['cf2'], c['cf3'], 0.3 * c['cf4']); G['sHigh'] = 100 * u(0.7 * c['cf4'], c['cf5'])
G['blind'] = 100 * u(G['sMid'].values / 100, G['sHigh'].values / 100) >= 50
H = H.merge(G[['sid', 't', 'tcf', 'sLow', 'blind']], on=['sid', 't'], how='left')
# prévision combinée hors échantillon (échéance courte d0 et veille d1)
for name in ['d0', 'd1']:
    P = pd.read_csv(f'cvpred_{name}.csv'); ts = (np.ceil(P['time'].values * 1000 / 3600) * 3600).astype('int64')
    P['t'] = pd.to_datetime(ts, unit='s', utc=True).as_unit(H['t'].dt.unit); H = H.merge(P[['sid', 't', 'comb']].rename(columns={'comb': 'C' + name}), on=['sid', 't'], how='left')
# aéroport voisin le plus proche (avec observateur)
def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, [ST[a]['lat'], ST[a]['lon'], ST[b]['lat'], ST[b]['lon']])
    return 6371 * 2 * math.asin(math.sqrt(math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2))
ids = sorted(H['sid'].unique()); near = {}
for a in ids:
    d = sorted((km(a, b), b) for b in ids if b != a); near[a] = d[0]
H['nb'] = H['sid'].map(lambda s: near[s][1]); H['nbkm'] = H['sid'].map(lambda s: near[s][0])
obs = H.set_index(['sid', 't'])[['tot%', 'low%']]
H = H.join(obs.rename(columns={'tot%': 'nbTot', 'low%': 'nbLow'}), on=['nb', 't'])
H = H.sort_values(['sid', 't']).set_index(['sid', 't'])
# garder aussi les tranches satellite moyennes/hautes et l'heure locale approximative
H = H.join(G.set_index(['sid', 't'])[['sMid', 'sHigh', 'cf1', 'cf2', 'cf3', 'cf4', 'cf5']], how='left')
H.to_pickle('nowcast_H.pkl'); print('ok', H.shape)
