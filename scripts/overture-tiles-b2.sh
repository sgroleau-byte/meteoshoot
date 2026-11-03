#!/bin/sh
# Envoi des tuiles Overture (scripts/overture-tiles.mjs, dossier _METEOSHOOT/overture-tuiles/<release>) dans le seau
# public Backblaze B2 « meteoshoot-overture » (région ca-east-006, compte Backblaze de Stéphane; créé le 3 novembre 2026).
# Le serveur (api/overture-tiles.js) les lit à https://f006.backblazeb2.com/file/meteoshoot-overture/<release>/...
# (variable Vercel OVERTURE_TILES_URL). Clé d'application limitée au seau, dans le trousseau du Mac
# (meteoshoot-overture-b2-key-id et meteoshoot-overture-b2-key), jamais affichée. rclone (brew install rclone) fait
# l'envoi: les tuiles d'abord, le manifeste en dernier (un manifeste sans ses tuiles ferait des environs vides).
#
#   sh scripts/overture-tiles-b2.sh                 release de api/scene3d.js
#   sh scripts/overture-tiles-b2.sh 2026-09-23.1    autre release
#   sh scripts/overture-tiles-b2.sh --check         compare seulement (rclone check), sans envoyer
set -e
cd "$(dirname "$0")/.."
REL="${1:-$(grep -o "const RELEASE = '[^']*'" api/scene3d.js | sed "s/.*'\(.*\)'/\1/")}"
CHECK=""; [ "$1" = "--check" ] && { CHECK=1; REL="$(grep -o "const RELEASE = '[^']*'" api/scene3d.js | sed "s/.*'\(.*\)'/\1/")"; }
DIR="$(cd .. && pwd)/overture-tuiles/$REL"
[ -f "$DIR/manifest.json" ] || { echo "pas de manifeste dans $DIR: générer d'abord (node scripts/overture-tiles.mjs)"; exit 1; }
export RCLONE_CONFIG_MSB2_TYPE=b2
RCLONE_CONFIG_MSB2_ACCOUNT="$(security find-generic-password -s meteoshoot-overture-b2-key-id -w)"; export RCLONE_CONFIG_MSB2_ACCOUNT
RCLONE_CONFIG_MSB2_KEY="$(security find-generic-password -s meteoshoot-overture-b2-key -w)"; export RCLONE_CONFIG_MSB2_KEY
DEST="msb2:meteoshoot-overture/$REL"
if [ -n "$CHECK" ]; then rclone check "$DIR" "$DEST" --exclude avancement.json --one-way; exit; fi
echo "envoi de $DIR vers $DEST (tuiles d'abord, manifeste en dernier)"
rclone copy "$DIR" "$DEST" --exclude avancement.json --exclude manifest.json --transfers 24 --checkers 16 --fast-list --stats 60s --stats-one-line
rclone copyto "$DIR/manifest.json" "$DEST/manifest.json"
echo "terminé: $(rclone size "$DEST" --fast-list | tr '\n' ' ')"
