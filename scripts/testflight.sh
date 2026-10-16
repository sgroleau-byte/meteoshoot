#!/bin/sh
# Envoie la version courante de l'app iPhone et iPad à TestFlight (16 octobre 2026).
# Numéro de build tiré de la version du splash (index.html): v633.217 donne 633217, toujours croissant.
# Signature automatique avec le compte Apple connecté dans Xcode (équipe 89HN379C53), sans clé à saisir.
# Usage: sh scripts/testflight.sh   (depuis la racine du dépôt)
set -e
cd "$(dirname "$0")/.."
V=$(grep -o 'splash-version-num">v633\.[0-9]*' index.html | sed 's/.*v633\.//')
BUILD="633$V"
echo "Version v633.$V, build $BUILD"
sed -i '' "s/CURRENT_PROJECT_VERSION = [0-9]*;/CURRENT_PROJECT_VERSION = $BUILD;/" ios/App/App.xcodeproj/project.pbxproj
npm run cap:sync
OUT="${TMPDIR:-/tmp}/meteoshoot-testflight"
rm -rf "$OUT" && mkdir -p "$OUT"
cat > "$OUT/ExportOptions.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>signingStyle</key><string>automatic</string>
  <key>teamID</key><string>89HN379C53</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>testFlightInternalTestingOnly</key><true/>
</dict>
</plist>
EOF
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$OUT/MeteoShoot.xcarchive" -allowProvisioningUpdates archive -quiet
xcodebuild -exportArchive -archivePath "$OUT/MeteoShoot.xcarchive" -exportOptionsPlist "$OUT/ExportOptions.plist" \
  -exportPath "$OUT/export" -allowProvisioningUpdates
echo "Envoyé à TestFlight (build $BUILD). Apple le traite en 5 à 30 minutes."
