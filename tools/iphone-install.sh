#!/bin/bash
# Compile l'app iOS pour un iPhone ou un iPad branché et l'installe dessus (signature automatique, équipe 89HN379C53).
# Usage: tools/iphone-install.sh [identifiant devicectl]   (sans argument: premier iPhone ou iPad disponible)
set -e
cd "$(dirname "$0")/.."
# Identifiant devicectl (UUID) lu par motif: la colonne du modèle contient des espaces (« iPhone 15 Pro (iPhone16,1) »).
DEV=${1:-$(xcrun devicectl list devices 2>/dev/null | awk '/available|connected/ && /iPhone|iPad/' | grep -oE '[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}' | head -1)}
[ -z "$DEV" ] && { echo "Aucun iPhone ni iPad disponible: brancher et déverrouiller l'appareil, accepter « Se fier à cet ordinateur »."; xcrun devicectl list devices; exit 1; }
# Identifiant matériel (celui qu'attend xcodebuild) et vrai nom de l'appareil, lus dans la sortie JSON: le tableau de
# devicectl retire les accents (« iPad Pro de Stephane ») et xcodebuild ne trouvait pas l'appareil par ce nom.
JSON=$(mktemp)
xcrun devicectl list devices --json-output "$JSON" >/dev/null 2>&1
read -r UDID NAME < <(python3 -c 'import json, sys
for d in json.load(open(sys.argv[1]))["result"]["devices"]:
    if d["identifier"] == sys.argv[2]: print(d["hardwareProperties"]["udid"], d["deviceProperties"]["name"])' "$JSON" "$DEV")
rm -f "$JSON"
[ -z "$UDID" ] && { echo "Appareil $DEV introuvable dans la liste de devicectl."; exit 1; }
echo "Appareil: $NAME ($DEV)"
npm run build:native >/dev/null && npx cap sync ios >/dev/null
# Ancienne compilation retirée, et arrêt si xcodebuild échoue: sinon le script installait la compilation d'un autre
# appareil, refusée par l'iPad (profil de signature sans cet appareil).
rm -rf build/ios-device/Build/Products/Debug-iphoneos/App.app
set +e
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination "id=$UDID" -derivedDataPath build/ios-device -allowProvisioningUpdates -allowProvisioningDeviceRegistration -quiet build 2>&1 | grep -vE "Duplicate \"data-|^\s*[0-9]+ \||^\s*\|"
BUILD=${PIPESTATUS[0]}
set -e
[ "$BUILD" -eq 0 ] || { echo "Compilation échouée (erreurs ci-dessus): rien n'a été installé."; exit 1; }
APP=$(find build/ios-device/Build/Products/Debug-iphoneos -maxdepth 1 -name "App.app" | head -1)
xcrun devicectl device install app --device "$DEV" "$APP"
xcrun devicectl device process launch --device "$DEV" com.meteoshoot.app
echo "Installée et lancée sur l'appareil."
