# Calculs complets (exécution de 12 h UTC chaque jour, 2 avril au 14 octobre 2026) des modèles pour les 33 aéroports avec
# observateur: couverture totale et basse à toutes les échéances (l'archive des exécutions précédentes ne garde la basse
# qu'à courte échéance). Rythme: moins de 5 000 appels pondérés par heure et 9 300 par jour (offre gratuite).
import json, os, time, datetime as dt, urllib.request, urllib.error
AUTO = set('CYBC CYFC CYHU CYLW CYMT CYQG CYRQ CYSC CYXS CYJT CYML'.split())
S = [s for s in json.load(open('stations.json')) if s['id'] not in AUTO]
lat = ','.join(str(s['lat']) for s in S); lon = ','.join(str(s['lon']) for s in S)
MODELS = 'icon_global,ecmwf_ifs025,ecmwf_aifs025_single,ukmo_global_deterministic_10km,gfs_global,gfs_hrrr,gem_hrdps_continental,gem_regional'
VARS = 'cloud_cover,cloud_cover_low,direct_radiation'
# Les archives exigent le forfait Professional: clé seulement si elle est donnée exprès (le forfait Standard ne les ouvre pas)
KEY = os.environ.get('OPEN_METEO_KEY_PRO')  # forfait payant (facultatif): lu dans l'environnement, jamais affiché
BASE = 'https://customer-single-runs-api.open-meteo.com/v1/forecast' if KEY else 'https://single-runs-api.open-meteo.com/v1/forecast'
WEIGHT = len(S) * max(1, (3 * 8) / 10)  # 3 variables x 8 modèles par lieu
used = {}
os.makedirs('data', exist_ok=True)
d = dt.date(2026, 4, 2)
while d <= dt.date(2026, 10, 14):
    f = f'data/{d.isoformat()}T12.json'
    if os.path.exists(f) and os.path.getsize(f) > 1000: d += dt.timedelta(days=1); continue
    day = dt.datetime.now(dt.timezone.utc).date().isoformat()
    if not KEY and used.get(day, 0) + WEIGHT > 9300:
        nxt = dt.datetime.combine(dt.datetime.now(dt.timezone.utc).date() + dt.timedelta(days=1), dt.time(0, 5), dt.timezone.utc)
        print('quota du jour atteint, reprise à', nxt.isoformat(), flush=True); time.sleep(max(60, (nxt - dt.datetime.now(dt.timezone.utc)).total_seconds())); continue
    models = MODELS.split(',')
    INTERNAL = {'cmc_gem_hrdps': 'gem_hrdps_continental', 'cmc_gem_rdps': 'gem_regional', 'ncep_hrrr_conus': 'gfs_hrrr', 'ukmo_global_deterministic_10km': 'ukmo_global_deterministic_10km'}
    t0 = time.time(); ok_try = True
    for k in range(10):
        url = f'{BASE}?latitude={lat}&longitude={lon}&run={d.isoformat()}T12:00&models={",".join(models)}&hourly={VARS}&forecast_days=3&timezone=GMT' + (f'&apikey={KEY}' if KEY else '')
        try:
            data = urllib.request.urlopen(url, timeout=300).read(); j = json.loads(data)
            if isinstance(j, dict) and j.get('error'): raise Exception(j.get('reason'))
            open(f, 'wb').write(data); used[day] = used.get(day, 0) + WEIGHT
            print(d, 'ok', round(time.time() - t0), 's, appels du jour', round(used[day]), flush=True); break
        except urllib.error.HTTPError as e:
            body = e.read()[:300].decode('utf8', 'replace')
            # un modèle sans cette exécution: on le retire et on redemande tout de suite
            import re
            mm = re.search(r'not available\. Model: ([a-z0-9_]+)', body)
            if e.code == 400 and mm:
                raw = mm.group(1)
                name = next((v for k2, v in [('hrdps', 'gem_hrdps_continental'), ('rdps', 'gem_regional'), ('hrrr', 'gfs_hrrr'), ('ukmo', 'ukmo_global_deterministic_10km'), ('aifs', 'ecmwf_aifs025_single'), ('ifs', 'ecmwf_ifs025'), ('icon', 'icon_global'), ('gfs', 'gfs_global')] if k2 in raw), None)
                if name in models: models.remove(name); print(d, 'sans', name, flush=True); continue
            if 'Daily API request limit' in body and not KEY:
                nxt = dt.datetime.combine(dt.datetime.now(dt.timezone.utc).date() + dt.timedelta(days=1), dt.time(0, 10), dt.timezone.utc)
                print('quota quotidien épuisé, reprise à', nxt.isoformat(), flush=True); time.sleep(max(60, (nxt - dt.datetime.now(dt.timezone.utc)).total_seconds())); continue
            print('HTTP', e.code, d, body[:150], flush=True); time.sleep(60 * (k + 1))
        except Exception as e:
            print('err', d, str(e)[:200], flush=True); time.sleep(30 * (k + 1))
    else:
        ok_try = False; print('jour manqué', d, flush=True)
    if os.path.exists(f) or not ok_try: d += dt.timedelta(days=1)  # jour définitivement en échec: noté, on passe
    if not KEY: time.sleep(max(0, 3600 * WEIGHT / 4800 - (time.time() - t0)))  # rythme horaire
print('FIN RUNS', flush=True)
