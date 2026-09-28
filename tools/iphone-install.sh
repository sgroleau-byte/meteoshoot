#!/bin/bash
# Compile l'app iOS pour un iPhone branché et l'installe dessus (signature automatique, équipe 89HN379C53).
# Usage: tools/iphone-install.sh [identifiant devicectl]   (sans argument: premier iPhone disponible)
set -e
cd "$(dirname "$0")/.."
DEV=${1:-$(xcrun devicectl list devices 2>/dev/null | awk '/available|connected/ && /iPhone/ {print $(NF-3); exit}')}
[ -z "$DEV" ] && { echo "Aucun iPhone disponible: brancher et déverrouiller l'iPhone, accepter « Se fier à cet ordinateur »."; xcrun devicectl list devices; exit 1; }
NAME=$(xcrun devicectl list devices 2>/dev/null | awk -v d="$DEV" 'index($0, d) {sub(/ +[A-Za-z0-9.-]+\.coredevice\.local.*/, ""); print; exit}')
echo "Appareil: $NAME ($DEV)"
npm run build:native >/dev/null && npx cap sync ios >/dev/null
# xcodebuild identifie l'appareil par son nom (son identifiant diffère de celui de devicectl)
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination "platform=iOS,name=$NAME" -derivedDataPath build/ios-device -allowProvisioningUpdates -quiet build 2>&1 | grep -vE "Duplicate \"data-|^\s*[0-9]+ \||^\s*\|" || true
APP=$(find build/ios-device/Build/Products/Debug-iphoneos -maxdepth 1 -name "App.app" | head -1)
xcrun devicectl device install app --device "$DEV" "$APP"
xcrun devicectl device process launch --device "$DEV" com.meteoshoot.app
echo "Installée et lancée sur l'iPhone."
