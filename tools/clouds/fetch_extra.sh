#!/bin/bash
# NBM (mélange statistique américain, déjà calibré) et ECMWF IFS 9 km horaire: échéance courte puis veille.
until grep -q "FIN PREV" prev0.log; do sleep 30; done
AUTO="CYBC CYFC CYHU CYLW CYMT CYQG CYRQ CYSC CYXS CYJT CYML"
python3 -c "import json;[print(s['id'],s['lat'],s['lon']) for s in json.load(open('stations.json'))]" | while read id lat lon; do
  case " $AUTO " in *" $id "*) continue;; esac
  for part in x y; do
    f="hist/$id.$part.json"; [ "$part" = y ] && f="prev/${id}_x1.json"; [ -s "$f" ] && continue
    if [ $part = x ]; then U="https://historical-forecast-api.open-meteo.com/v1/forecast?hourly=cloud_cover,cloud_cover_low"; 
    else U="https://previous-runs-api.open-meteo.com/v1/forecast?hourly=cloud_cover_previous_day1"; fi
    for k in 1 2 3 4 5 6; do
      code=$(curl -s -m 400 -o "$f.part" -w "%{http_code}" "$U&models=ncep_nbm_conus,ecmwf_ifs&latitude=$lat&longitude=$lon&start_date=2025-10-14&end_date=2026-10-15&timezone=GMT")
      if [ "$code" = "200" ] && grep -q '"hourly"' "$f.part"; then mv "$f.part" "$f"; echo "$id $part ok $(date +%H:%M)"; break; fi
      echo "$id $part code $code $(head -c 100 $f.part)"; sleep $((20*k))
    done
  done
done
echo FIN EXTRA
