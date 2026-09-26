#!/bin/bash
# Mesure du démarrage dans le simulateur iOS: lance l'app et capture l'écran toutes les ~150 ms
# pendant N secondes. L'analyse (sim-startup-analyse.py) trouve la première image où la liste est affichée.
UDID=${1:?udid}; BUNDLE=${2:-com.meteoshoot.app}; OUT=${3:-/tmp/sim-startup}; DUR=${4:-8}
rm -rf "$OUT"; mkdir -p "$OUT"
xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null
sleep 1
START=$(python3 -c 'import time; print(int(time.time()*1000))')
xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null
END=$((START + DUR * 1000))
while :; do
  NOW=$(python3 -c 'import time; print(int(time.time()*1000))')
  [ "$NOW" -ge "$END" ] && break
  xcrun simctl io "$UDID" screenshot --type=png "$OUT/$((NOW - START)).png" >/dev/null 2>&1
done
ls "$OUT" | wc -l
