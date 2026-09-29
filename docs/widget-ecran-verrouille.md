# Widget iPhone « Shooting du jour » (écran verrouillé)

Décidé avec Stéphane le 29 septembre 2026, construit et testé dans le simulateur le même jour. But: le jour
d'un shooting, voir sans ouvrir l'app le lever et le coucher du soleil (en gros, c'est l'information la
plus consultée), la météo au lieu du shooting et le temps de trajet depuis la position actuelle.

## Geste dans l'app (téléphone)

Dans la liste des projets, appui long sur une carte: après 380 ms, le tapotement léger habituel (le
glisser-déposer est armé); si on relâche sans bouger, le projet devient le shooting du jour, avec un buzz
plus franc (Haptics « succès »); si on bouge, glisser-déposer comme avant. Même geste pour retirer la
marque (buzz « avertissement »). Un seul projet marqué à la fois; le nom porte une petite coche dorée.
La marque est propre à l'appareil (`localStorage`, `src/native/shootOfDay.js`), pas synchronisée.

## Flux des données

1. `src/components/ProjectCard.jsx`: quand la carte marquée a sa météo, elle construit un instantané
   (projet, coordonnées, orientation AM/PM, trajet planifié depuis la maison, trois jours: lever et coucher
   formatés, icône choisie par `iconsLogic.dayIcon`, nuages, créneaux AM/PM bons, heures de départ) et la
   clé Google Maps native, puis appelle `pushWidgetSnapshot` (`src/native/widget.js`).
2. `ios/App/App/WidgetBridgePlugin.swift` (pont Capacitor local, enregistré par
   `MeteoShootViewController`, lui-même créé par `SceneDelegate`): écrit le JSON dans le groupe d'apps
   `group.com.meteoshoot.app` (UserDefaults) et demande à WidgetKit de recharger.
3. `ios/App/MeteoShootWidget/MeteoShootWidget.swift` (extension WidgetKit, iOS 17, SwiftUI): lit le JSON,
   choisit le jour courant, demande la position (une lecture, `NSWidgetWantsLocation`) et interroge Google
   Distance Matrix en REST (clé native, en-tête `X-Ios-Bundle-Identifier: com.meteoshoot.app`) pour le
   trajet en direct; sinon le trajet planifié. Rafraîchissement demandé toutes les 15 minutes (iOS décide).

Formats: ligne au-dessus de l'heure (« 06:41 · 18:28 · 98% · 0H26 »), rond (lever ou coucher selon
l'orientation du projet, sinon le prochain), rectangle (soleil en gros, nom, nuages et trajet), et en
bonus petit et moyen sur l'écran d'accueil. Sans projet marqué: « Aucun shooting marqué ».

## Projet Xcode

- Cible `MeteoShootWidget` (extension, identifiant `com.meteoshoot.app.widget`) intégrée à l'app par la
  phase « Embed Foundation Extensions »; droits de groupe d'apps sur l'app (`App/App.entitlements`) et sur
  l'extension. Ajoutée par script (gem `xcodeproj`), sans ouvrir Xcode.
- Avec Xcode 26, le code de l'app en Debug vit dans `App.app/App.debug.dylib`; `App.app/App` n'est qu'un
  lanceur (ne pas s'y fier pour chercher des symboles).
- Compilation simulateur: `xcodebuild -project ios/App/App.xcodeproj -scheme App -destination
  'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/ios-sim build`, puis `xcrun simctl
  install booted .../App.app`. iPhone réel: `tools/iphone-install.sh`.
- Vérifier l'instantané dans le simulateur: `xcrun simctl get_app_container booted com.meteoshoot.app
  groups`, puis le fichier `Library/Preferences/group.com.meteoshoot.app.plist` du conteneur.

## Reste à faire

- Installer sur l'iPhone de Stéphane (câble) et tester le geste, le buzz, les trois formats sur l'écran
  verrouillé et le trajet en direct (position: l'app doit avoir la permission « Lorsque l'app est active »
  et avoir été utilisée récemment pour que le widget y ait droit).
- Décider si le nom du projet reste dans le rectangle ou si on l'enlève pour agrandir encore les heures.
- Console Google: restreindre la clé « MeteoShoot natif » à l'identifiant d'app iOS `com.meteoshoot.app`
  (elle est appelée en REST par le widget avec cet en-tête).
- Plus tard: activité en direct (Dynamic Island) le jour du shooting; synchronisation de la marque entre
  appareils; Android à la commercialisation.
