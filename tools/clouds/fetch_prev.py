import json, os, sys, time, urllib.request, urllib.error
S=json.load(open('stations.json'))
worker=int(sys.argv[1]); nw=int(sys.argv[2])
G=[('d1',['icon_seamless','gem_seamless','gfs_seamless','ecmwf_ifs025','ecmwf_aifs025_single','ukmo_seamless','gem_hrdps_continental','gfs_hrrr'],['cloud_cover_previous_day1']),
   ('d2',['icon_seamless','gem_seamless','gfs_seamless','ecmwf_ifs025','ecmwf_aifs025_single','ukmo_seamless'],['cloud_cover_previous_day2']),
   ('sw1',['icon_seamless'],['shortwave_radiation_previous_day1','direct_radiation_previous_day1'])]
Q=[('2025-10-15','2026-04-14'),('2026-04-15','2026-10-15')]
jobs=[(s,g,q) for g in G for s in S for q in Q]   # d1 pour toutes les stations d abord
for n,(s,(gname,models,vars_),(a,b)) in enumerate(jobs):
    if n%nw!=worker: continue
    f=f"prev/{s['id']}_{gname}_{a}.json"
    if os.path.exists(f): continue
    url=("https://previous-runs-api.open-meteo.com/v1/forecast?latitude=%s&longitude=%s&hourly=%s&models=%s&start_date=%s&end_date=%s&timezone=GMT"
         % (s['lat'],s['lon'],','.join(vars_),','.join(models),a,b))
    for k in range(10):
        try:
            t0=time.time(); d=urllib.request.urlopen(url,timeout=600).read(); j=json.loads(d)
            if 'hourly' not in j: raise Exception(str(j)[:200])
            open(f,'wb').write(d); print(s['id'],gname,a,'ok',round(time.time()-t0),'s',flush=True); break
        except urllib.error.HTTPError as e:
            print('HTTP',e.code,s['id'],gname,a,e.read()[:120],flush=True); time.sleep(20+15*k)
        except Exception as e:
            print('err',s['id'],gname,a,e,flush=True); time.sleep(20+15*k)
print('FIN PREV',worker)
