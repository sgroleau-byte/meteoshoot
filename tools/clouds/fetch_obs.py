import json, os, time, urllib.request
S=json.load(open('stations.json'))
for s in S:
    f=f"obs/{s['id']}.csv"
    if os.path.exists(f) and os.path.getsize(f)>1000: continue
    url=("https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=%s&data=metar"
         "&year1=2025&month1=10&day1=14&year2=2026&month2=10&day2=16&tz=Etc/UTC&format=onlycomma&latlon=no&report_type=3&report_type=4") % s['id']
    for k in range(5):
        try:
            data=urllib.request.urlopen(url,timeout=180).read()
            open(f,'wb').write(data); print(s['id'], len(data), flush=True); break
        except Exception as e:
            print('retry',s['id'],e,flush=True); time.sleep(20*(k+1))
    time.sleep(3)
print('FIN OBS')
