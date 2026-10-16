# Vérification privée en continu (16 octobre 2026): compare les instantanés archivés toutes les 6 h (table cloud_verif,
# fonction Supabase cloud-verif) au ciel observé par les aéroports: MeteoShoot (ICON brut, couverture combinée, ciel
# observé des premières heures) contre les prévisions publiées par Environnement Canada (horaires sur 24 h, par période
# au-delà). Usage: VERIF_REPORT_TOKEN=... python3 verif_live.py [AAAA-MM-JJ de début]
# Le jeton de lecture est un secret Supabase gardé hors du dépôt.
import os, sys, json, io, csv, urllib.request, datetime as dt
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse_obs import parse

FN = 'https://mioiieshhjqpakdlsfzw.supabase.co/functions/v1/cloud-verif'
since = sys.argv[1] if len(sys.argv) > 1 else '2026-10-16'
tok = os.environ.get('VERIF_REPORT_TOKEN')
if not tok: sys.exit('VERIF_REPORT_TOKEN manquant')
req = urllib.request.Request(f'{FN}?report=1&since={since}', headers={'x-verif-token': tok})
rows = json.load(urllib.request.urlopen(req, timeout=120))['rows']
print(len(rows), 'instantanés-stations depuis', since)
if not rows: sys.exit()

# Icônes d'Environnement Canada -> couverture approximative (%): ensoleillé/dégagé, généralement ensoleillé, alternance,
# généralement nuageux, nuageux; précipitations continues = couvert; averses = généralement nuageux; brouillard = couvert.
EC = {0: 5, 30: 5, 1: 30, 31: 30, 2: 50, 32: 50, 3: 75, 33: 75, 4: 60, 34: 60, 5: 40, 35: 40, 22: 75, 10: 95,
      6: 70, 7: 70, 8: 70, 9: 70, 36: 70, 37: 70, 38: 70, 39: 70}
for c in [11, 12, 13, 14, 15, 16, 17, 18, 19, 24, 26, 27, 28]: EC[c] = 95

# Observations horaires (archives de l'Iowa Environmental Mesonet) pour les stations et la période
ids = sorted({r['station'] for r in rows})
t0 = min(dt.datetime.fromisoformat(r['issued_at'].replace('Z', '+00:00')) for r in rows)
t1 = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1)
truth = {}
for sid in ids:
    url = ('https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=%s&data=metar&year1=%d&month1=%d&day1=%d&year2=%d&month2=%d&day2=%d&tz=Etc/UTC&format=onlycomma&latlon=no&report_type=3&report_type=4'
           % (sid, t0.year, t0.month, t0.day, t1.year, t1.month, t1.day))
    txt = urllib.request.urlopen(url, timeout=120).read().decode()
    d = {}
    for row in csv.DictReader(io.StringIO(txt)):
        v, m = row['valid'], row['metar']
        if not m or m == 'M': continue
        mm = int(v[14:16])
        if mm <= 5: key = v[:10] + 'T' + v[11:13] + ':00'
        elif mm >= 50: key = (dt.datetime.strptime(v, '%Y-%m-%d %H:%M') + dt.timedelta(hours=1)).strftime('%Y-%m-%dT%H:00')
        else: continue
        p = parse(m)
        if p and p['kind'] in ('octas', 'clr') and key not in d: d[key] = p['tot'] * 12.5
    truth[sid] = d

recs = []
for r in rows:
    s = r['data']; f = s['f']; issued = pd.Timestamp(r['issued_at']); base = pd.Timestamp(f['t0'])
    ec = s.get('eccc') or {}
    ech = {h['t'][:13]: EC.get(h['icon']) for h in ec.get('hourly', []) if h.get('icon') is not None}
    for k in range(len(f['comb'])):
        t = base + pd.Timedelta(hours=k); key = t.strftime('%Y-%m-%dT%H:00')
        o = truth.get(r['station'], {}).get(key)
        if o is None: continue
        lead = (t - issued).total_seconds() / 3600
        recs.append({'station': r['station'], 'issued': issued, 't': t, 'lead': lead, 'obs': o, 'icon': f['icon'][k], 'comb': f['comb'][k],
                     'now': f['now'][k] if k < len(f['now']) else np.nan, 'nowFar': f['nowFar'][k] if k < len(f.get('nowFar') or []) else np.nan, 'eccc': ech.get(t.strftime('%Y-%m-%dT%H'), np.nan)})
D = pd.DataFrame(recs)
if D.empty: sys.exit('pas encore d\'heures observées après les instantanés')
D['bucket'] = pd.cut(D['lead'], [-1, 6, 24, 48], labels=['0 à 6 h', '6 à 24 h', '24 à 48 h'])
cat = lambda x: np.digitize(x, [26, 74])
out = []
for b, g in D.groupby('bucket', observed=True):
    for src in ['icon', 'comb', 'now', 'nowFar', 'eccc']:
        m = g[src].notna()
        if m.sum() < 20: continue
        e = g.loc[m]
        out.append({'échéance': b, 'source': {'icon': 'ICON seul', 'comb': 'MeteoShoot combiné', 'now': 'MeteoShoot + observé', 'nowFar': 'MeteoShoot + observé, sans l\'aéroport du lieu', 'eccc': 'Environnement Canada'}[src],
                    'heures': int(m.sum()), 'écart moyen': round(float(np.mean(np.abs(e[src] - e['obs']))), 1),
                    'bonne catégorie': round(float(np.mean(cat(e[src]) == cat(e['obs']))), 3),
                    'dégagé annoncé couvert': round(float(np.mean(e.loc[e['obs'] <= 25, src] >= 74)) if (e['obs'] <= 25).any() else np.nan, 3)})
print(pd.DataFrame(out).to_string(index=False))
print('\nNote: Environnement Canada ne publie pas de pourcentage; ses icônes sont converties en couverture approximative. La colonne « bonne catégorie » (dégagé, partiel, couvert) est la comparaison la plus juste.')
