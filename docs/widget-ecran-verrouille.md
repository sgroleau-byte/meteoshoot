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

Formats (version du 29 septembre, après le retour de Stéphane « moins d'informations, plus gros »): deux
widgets dans le lot. « Soleil du shooting »: la ligne au-dessus de l'heure porte le nom du projet, le rectangle
montre le lever et le coucher sur deux lignes en gros (30 pt), le rond montre le lever ou le coucher selon
l'orientation du projet (sinon le prochain). « Météo et trajet »: rectangle avec les nuages sur une ligne et le
temps de trajet sur l'autre, en gros; rond avec les nuages. Sur l'écran verrouillé, on met les deux rectangles
côte à côte (la rangée est pleine). En bonus, petit et moyen sur l'écran d'accueil (vue complète). Sans projet
marqué: « Aucun shooting marqué ». Apple limite un rectangle à 160 par 72 points, en monochrome teinté; une
surface plus grande et en couleurs demanderait une activité en direct (étape suivante possible).

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

- (Fait le 30 septembre 2026) Installé sur l'iPhone de Stéphane par `tools/iphone-install.sh`; il a donné son
  feu vert (« tu peux pousser »): v633.126 en production. Rappel pour le trajet en direct: l'app doit avoir
  la permission de position « Lorsque l'app est active » et avoir été utilisée récemment.
- Console Google: restreindre la clé « MeteoShoot natif » à l'identifiant d'app iOS `com.meteoshoot.app`
  (elle est appelée en REST par le widget avec cet en-tête).
- Plus tard: activité en direct (Dynamic Island) le jour du shooting; synchronisation de la marque entre
  appareils; Android à la commercialisation.
