#!/bin/bash
# Variables réduites: total, bas et rayonnement pour tous; moyens, hauts et direct pour ICON seulement.
AUTO="CYBC CYFC CYHU CYLW CYMT CYQG CYRQ CYSC CYXS CYJT CYML"
python3 -c "import json;[print(s['id'],s['lat'],s['lon']) for s in json.load(open('stations.json'))]" | while read id lat lon; do
  case " $AUTO " in *" $id "*) continue;; esac
  for part in a b; do
    f="hist/$id.$part.json"; [ -s "$f" ] && continue; [ -s "hist/$id.json" ] && continue
    if [ $part = a ]; then M='icon_seamless,gem_seamless,gfs_seamless,ecmwf_ifs025,ecmwf_aifs025_single,ukmo_seamless'; V='cloud_cover,cloud_cover_low,shortwave_radiation';
    else M='icon_seamless'; V='cloud_cover_mid,cloud_cover_high,direct_radiation'; fi
    for k in 1 2 3 4 5 6 7 8; do
      code=$(curl -s -m 400 -o "$f.part" -w "%{http_code}" "https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=$lat&longitude=$lon&hourly=$V&models=$M&start_date=2025-10-14&end_date=2026-10-15&timezone=GMT")
      if [ "$code" = "200" ] && grep -q '"hourly"' "$f.part"; then mv "$f.part" "$f"; echo "$id $part ok $(date +%H:%M)"; break; fi
      echo "$id $part code $code $(head -c 100 $f.part)"; sleep $((20*k))
    done
  done
done
echo FIN HIST
