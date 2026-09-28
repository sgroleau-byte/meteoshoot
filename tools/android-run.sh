#!/bin/bash
# Démarre l'émulateur Android « meteoshoot » (créé le 28 septembre 2026), installe et lance l'app de débogage.
# Prérequis: tools/android-setup.sh déjà exécuté (SDK, licences), APK compilé (npm run android ou gradlew assembleDebug).
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
cd "$(dirname "$0")/.."
APK=android/app/build/outputs/apk/debug/app-debug.apk
[ -f "$APK" ] || { echo "APK absent: lancer d'abord (cd android && ./gradlew assembleDebug)"; exit 1; }
if ! adb shell getprop sys.boot_completed 2>/dev/null | grep -q 1; then
  echo "Démarrage de l'émulateur (fenêtre visible)..."
  nohup emulator -avd meteoshoot -no-boot-anim -gpu swiftshader_indirect >/dev/null 2>&1 &
  until adb shell getprop sys.boot_completed 2>/dev/null | grep -q 1; do sleep 3; done
fi
adb emu geo fix -71.2080 46.8139 >/dev/null 2>&1
adb install -r "$APK" && adb shell am start -n com.meteoshoot.app/.MainActivity
echo "App lancée dans l'émulateur. Note: l'écran de l'émulateur peut afficher des colonnes fantômes (artefact de l'émulateur, pas de l'app)."
