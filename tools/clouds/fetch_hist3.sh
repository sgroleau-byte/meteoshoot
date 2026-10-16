#!/bin/bash
# Partie c (ICON): humidité près du sol et en altitude, pour reconnaître les nuages bas « secs » (fausses alarmes).
until grep -q "FIN HIST" hist2.log; do sleep 30; done
AUTO="CYBC CYFC CYHU CYLW CYMT CYQG CYRQ CYSC CYXS CYJT CYML"
V='temperature_2m,dew_point_2m,relative_humidity_925hPa,relative_humidity_850hPa,relative_humidity_700hPa,cape'
python3 -c "import json;[print(s['id'],s['lat'],s['lon']) for s in json.load(open('stations.json'))]" | while read id lat lon; do
  case " $AUTO " in *" $id "*) continue;; esac
  f="hist/$id.c.json"; [ -s "$f" ] && continue
  for k in 1 2 3 4 5 6 7 8; do
    code=$(curl -s -m 400 -o "$f.part" -w "%{http_code}" "https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=$lat&longitude=$lon&hourly=$V&models=icon_seamless&start_date=2025-10-14&end_date=2026-10-15&timezone=GMT")
    if [ "$code" = "200" ] && grep -q '"hourly"' "$f.part"; then mv "$f.part" "$f"; echo "$id c ok $(date +%H:%M)"; break; fi
    echo "$id c code $code $(head -c 100 $f.part)"; sleep $((20*k))
  done
done
echo FIN HIST3
