# Activité en direct « Shooting du jour » (écran verrouillé et Dynamic Island)

Le 29 septembre 2026, Stéphane a demandé de voir sur l'écran verrouillé, le jour d'un shooting, le lever et le
coucher du soleil (l'information qu'il cherche le plus souvent), la météo au lieu du shooting et le temps de
trajet depuis sa position. Une première version en widgets d'écran verrouillé a été construite puis rejetée
le 30 septembre: trop petits, monochromes, « ridiculement petit ». Elle a été remplacée le jour même par une
activité en direct, grande et en couleurs, au design de l'app, avec une barre de progression jusqu'au lever ou
au coucher (sa demande). Le code des widgets a été retiré.

## Geste dans l'app (téléphone)

Dans la liste des projets, appui long sur une carte: après 380 ms, le tapotement léger habituel (le
glisser-déposer est armé); si on relâche sans bouger, le projet devient le shooting du jour, avec un buzz
plus franc (Haptics « succès »); si on bouge, glisser-déposer comme avant. Même geste pour retirer la
marque (buzz « avertissement »), ce qui termine l'activité. Un seul projet marqué à la fois; le nom porte une
petite coche dorée (`ShootCheckIcon`). La marque est propre à l'appareil (`localStorage`,
`src/native/shootOfDay.js`), pas synchronisée.

## Ce que montre la carte

Depuis la v633.222 (21 octobre 2026), la carte de l'écran verrouillé reproduit la maquette de Stéphane
`_METEOSHOOT/_PSD/Live.psd` (4 octobre 2026, écran d'iPhone 15 Pro à 3x: les cotes en points du code sont ses
pixels divisés par 3, depuis le coin haut gauche de la carte système). Typo SF Pro, la police système, que
Stéphane veut ensuite partout dans l'app: titre en SF Pro Rounded Thin (nom du projet), le reste en SF Pro Medium.
Fond: matière translucide de l'écran verrouillé sans teinte (`activityBackgroundTint(Color.clear)`, v633.223: Stéphane
trouvait le fond par défaut trop opaque), avec le dégradé coloré et les étoiles de la maquette en images
(`MeteoShootWidget/Images/live-gradient.png`, `live-stars.png`, exportés du PSD).

v633.223 (21 octobre 2026, retours de Stéphane sur son iPhone: « tout est trop petit », « grossit encore la typo, en bas
du titre »): carte agrandie de 1,2 (titre 17,6 pt, hauteur 136 pt), textes sous le titre agrandis encore (étiquettes
10,8 pt, valeurs 18,7 pt, météo 14,3 pt), colonnes et rangées réespacées, route et étoiles à la taille de la maquette
faute de place en largeur; les cotes sont dans l'enum `Live` du widget. Comptes à rebours en chiffres partout (la
Dynamic Island écrivait « 1 h 44 min » en mots).

- Rangée 1: « Heure du départ » (lever ou coucher moins le trajet moins une heure sur place), « Arrivé dans »
  (compte à rebours jusqu'au départ plus le trajet, animé par iOS), puis « Météo au coucher du soleil » (ou au
  lever): température, nuages avec l'icône nuage, soleil direct avec l'icône soleil, et la grande icône météo de
  l'heure visée (`hourAt` dans `src/native/liveActivity.js`: l'heure du coucher, l'heure qui suit un lever).
- Rangée 2: anneau du temps restant (anneau circulaire système, animé par iOS, du début de la barre à l'événement
  visé), « Coucher dans » (ou « Lever dans », compte à rebours), tracé pointillé de la route avec le point d'étape et
  les kilomètres, « Coucher du soleil » avec l'heure (« 19h45 »), étoiles à droite.
- Les comptes à rebours affichent heures et minutes (iOS 18, `Text(.currentDate, format: .timer)` à la minute; iOS
  17 montre les secondes). Les icônes météo sont celles de l'app (`WeatherIcon.jsx`) rendues en blanc par
  `node tools/live-icons/render.mjs` (`Images/weather-<code>.png`, à relancer si les icônes de l'app changent).
- Écarts connus avec la maquette: les heures du compte à rebours ne sont pas complétées à deux chiffres (« 1:45 »
  et non « 01:45 », format système), et la petite aiguille dessinée dans l'anneau de la maquette n'existe pas
  (l'anneau est dessiné et animé par iOS).

Dynamic Island inchangée (Bebas Neue): compact (icône du soleil visé, compte à rebours), étendu (lever, coucher,
nom, barre, nuages, trajet).

Banc d'essai au simulateur, sans compte ni projet (build Debug): `SIMCTL_CHILD_MS_LIVE_SAMPLE=1 xcrun simctl launch
booted com.meteoshoot.app` démarre l'activité avec l'état de la maquette (`startSampleIfAsked` dans
`ShootActivityPlugin.swift`); verrouiller le simulateur pour voir la carte.

Événement visé (`pickSunTarget` dans `src/native/liveActivity.js`): le lever pour un projet du matin (visé
jusqu'à une heure après), le coucher pour un projet du soir, sinon le prochain des deux; aujourd'hui, puis
demain.

## Flux des données

1. `src/components/ProjectCard.jsx`: quand la carte marquée a sa météo (app iOS seulement), elle calcule le
   trajet depuis la position actuelle si la localisation est permise (`getCurrentPosition` puis
   `getTravelTime`), sinon garde le trajet planifié depuis la maison, et appelle `startShootActivity` avec
   l'état (textes déjà formatés, dates en secondes depuis 1970).
2. `ios/App/App/ShootActivityPlugin.swift` (pont Capacitor local, enregistré par `MeteoShootViewController`,
   créé par `SceneDelegate`): démarre l'activité (ActivityKit, iOS 16.2) ou met à jour celle du même projet,
   termine les autres; `end` termine tout. Date de péremption: trois heures après l'événement visé.
3. `ios/App/MeteoShootWidget/MeteoShootWidget.swift` (extension WidgetKit, iOS 17): dessine la carte et la
   Dynamic Island. Modèle partagé: `ios/App/App/ShootActivityAttributes.swift` (compilé dans les deux cibles).
   `ios/App/App/Info.plist` porte `NSSupportsLiveActivities`.

Toucher l'activité (écran verrouillé ou Dynamic Island) ouvre l'app sur la fiche du projet: lien
`meteoshoot://projet/<id>` (`widgetURL` dans le widget, schéma `meteoshoot` dans l'Info.plist de l'app), lu par
`src/components/App.jsx` au lancement (`App.getLaunchUrl`) ou pendant que l'app tourne (`appUrlOpen`).

Fin du shooting (v633.134, demande de Stéphane du 4 octobre 2026): 30 minutes après le dernier événement solaire du
shooting (le lever pour un projet du matin seulement, sinon le coucher), l'activité doit disparaître. L'heure de fin
(`endsAt`, `shootEndTime`) est fixée une seule fois, au premier démarrage, sur la marque (`ms-shoot-of-day`) et dans
l'état de l'activité (`endDate`, qui sert aussi de date de péremption). Passé cette heure, la marque s'efface (pour que
l'activité ne revienne pas le lendemain) et l'activité se termine: à l'ouverture de l'app, au retour dans l'app et
chaque minute tant qu'elle est ouverte (`src/native/shootOfDay.js`, méthode native `sweep`), et par une tâche de fond
demandée à iOS pour cette heure-là (`BGAppRefreshTask` « com.meteoshoot.app.fin-shooting », enregistrée par
`AppDelegate`). iOS exécute cette tâche quand il le juge bon: souvent à temps, sans garantie (pas en mode économie
d'énergie). Pour une disparition à la minute près app fermée, il faudrait un serveur qui envoie un « end » à l'activité
(notifications ActivityKit, clé APNs à créer dans le compte développeur).

Limites d'iOS: l'activité doit être démarrée pendant que l'app est ouverte; elle vit au plus huit heures
après sa dernière mise à jour (l'app la met à jour à chaque ouverture); les données ne changent qu'à
l'ouverture de l'app (pas de serveur de notifications pour l'instant), sauf le compte à rebours et la barre,
animés par iOS. La première fois, iOS demande d'autoriser les activités en direct de MeteoShoot.

## Projet Xcode

- Cible `MeteoShootWidget` (extension, identifiant `com.meteoshoot.app.widget`) intégrée à l'app par la
  phase « Embed Foundation Extensions », polices Bebas dans ses ressources (`UIAppFonts` de son Info.plist).
  Plus de groupe d'apps ni d'entitlements: l'état passe par ActivityKit.
- Avec Xcode 26, le code de l'app en Debug vit dans `App.app/App.debug.dylib`; `App.app/App` n'est qu'un
  lanceur (ne pas s'y fier pour chercher des symboles).
- Compilation simulateur: `xcodebuild -project ios/App/App.xcodeproj -scheme App -destination
  'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/ios-sim build`, puis `xcrun simctl
  install booted .../App.app`. iPhone réel: `tools/iphone-install.sh`.

## Reste à faire

- Validation par Stéphane sur son iPhone (installé le 30 septembre 2026), puis push sur son mot.
- Plus tard, si utile: mise à jour de l'activité sans ouvrir l'app (serveur de notifications ActivityKit),
  synchronisation de la marque entre appareils, Android à la commercialisation.
