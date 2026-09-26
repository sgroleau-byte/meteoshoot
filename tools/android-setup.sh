#!/bin/bash
# Prépare l'environnement Android sur ce Mac (JDK 21 et outils en ligne de commande déjà installés par Homebrew),
# puis compile l'app de débogage. L'acceptation des licences du SDK Android est une action de Stéphane:
# lancer ce script dans le Terminal et répondre « y » aux licences.
set -e
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$JAVA_HOME/bin:/opt/homebrew/share/android-commandlinetools/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
mkdir -p "$ANDROID_HOME"
echo "1) Licences du SDK Android (répondre y):"
sdkmanager --sdk_root="$ANDROID_HOME" --licenses
echo "2) Installation des composants (plateforme 36, outils de compilation, émulateur facultatif):"
sdkmanager --sdk_root="$ANDROID_HOME" "platform-tools" "platforms;android-36" "build-tools;36.0.0"
echo "sdk.dir=$ANDROID_HOME" > "$(dirname "$0")/../android/local.properties"
echo "3) Compilation de débogage:"
cd "$(dirname "$0")/../android" && ./gradlew assembleDebug
echo "APK: android/app/build/outputs/apk/debug/app-debug.apk"
