#!/bin/sh
# Banc: scène de chaque lieu par la fonction serveur, journal gardé (sources, ajouts LiDAR). Usage: sh run.sh <dossier de sortie>
OUT="$1"; mkdir -p "$OUT"
cd /Users/sgroleau/Documents/_METEOSHOOT/repo
while read name lat lng; do
  [ -z "$name" ] && continue
  node api/scene3d.js --test "$lat" "$lng" --out "$OUT/$name.json" > "$OUT/$name.log" 2>&1 &
  # deux lieux à la fois (serveurs LiDAR et Overture)
  if [ $(( $(jobs -p | wc -l) )) -ge 2 ]; then wait -n 2>/dev/null || wait; fi
done < $(dirname "$0")/lieux.txt
wait
for f in "$OUT"/*.log; do n=$(basename "$f" .log); echo "== $n"; grep -h "sources des bâtiments\|empreintes LiDAR\|zone dense\|ajouts" "$f"; done
