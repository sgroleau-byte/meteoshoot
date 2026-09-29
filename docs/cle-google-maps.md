# Clé Google Maps: état, restrictions et emplacement

## Historique (29 septembre 2026)

- L'ancienne clé unique « Maps Platform API Key » (3 février 2026), sans restriction de site, a été publiée
  dans le dépôt GitHub public depuis février 2026 (dans la page, puis dans `google-maps-keys.json` à partir
  du 26 septembre). Signalée par GitGuardian et par GitHub (Sécurité > Secret scanning, alerte 1) le
  28 septembre.
- Le 29 septembre: fichier sorti du dépôt (v633.123), deux nouvelles clés créées et vérifiées, ancienne clé
  supprimée dans la console (confirmée expirée par Google), alerte GitHub fermée en « revoked ».
- Réécriture de l'historique git écartée (décision de Stéphane): la valeur restée dans les anciens commits
  est inerte.

## Où vivent les clés

- Site (Vercel, projets `meteoshoot` et `meteoshoot-dev`): variable d'environnement `GOOGLE_MAPS_KEY_WEB`
  (production, aperçus, développement). Après un changement de valeur: redéployer (Deployments > Redeploy
  sur le dernier déploiement, ou un push).
- En local: `google-maps-keys.json` à la racine, ignoré par git (modèle: `google-maps-keys.example.json`),
  champs `web` et `native`. `vite.config.js` lit d'abord `GOOGLE_MAPS_KEY_WEB` ou `GOOGLE_MAPS_KEY_NATIVE`,
  sinon le fichier; sans l'un ni l'autre, `npm run build` échoue avec un message clair.
- Apps natives: `npm run build:native`, `cap:sync`, `ios`, `android` injectent le champ `native`.

Une clé Maps JavaScript est visible dans la page servie (le navigateur en a besoin pour charger la carte).
Sa protection n'est pas le secret mais les restrictions dans la console Google Cloud (sites autorisés,
API autorisées) et les plafonds de quota.

## Clés en place (console Google Cloud, projet « My First Project », APIs et services > Identifiants)

- « MeteoShoot web »: limitée aux cinq API utilisées (Maps JavaScript, Places, Geocoding, Directions,
  Distance Matrix) et aux sites `https://meteoshoot.com/*`, `https://www.meteoshoot.com/*`,
  `https://meteoshoot-dev.vercel.app/*`, `https://*.vercel.app/*` (aperçus), `http://localhost:5173/*`
  (développement). Vérifiée le 29 septembre depuis www.meteoshoot.com et depuis localhost:5173: carte,
  géocodage, itinéraire, temps de trajet, autocomplétion.
- « MeteoShoot natif »: mêmes cinq API, sans restriction d'application. Aussi appelée en REST (Distance Matrix) par
  le widget iPhone, avec l'en-tête `X-Ios-Bundle-Identifier: com.meteoshoot.app`: à restreindre un jour à cet
  identifiant d'app iOS. Les apps passent par une origine
  locale (`capacitor://localhost` sur iOS, `https://localhost` sur Android) que la restriction par sites ne
  filtre pas de façon fiable; la protection est la limitation aux cinq API et les plafonds de quota.

## Garde-fous en place (29 septembre 2026)

- Facturation: 0 $ de septembre 2025 à septembre 2026, aucun abus de l'ancienne clé. Alerte budgétaire
  « Alerte 10$ » (mensuelle, courriels à 50 %, 90 % et 100 %) sur le compte de facturation.
- Plafonds journaliers (Google Maps Platform > Quotas): Directions 500, Distance Matrix 500 éléments,
  Geocoding (v3) 500, Maps JavaScript 1 000 chargements de carte, Places 1 000. À relever si l'usage grandit.
- GitGuardian: incident laissé ouvert volontairement (installation de leur application GitHub refusée; la
  détection de secrets de GitHub couvre déjà le dépôt). Sans conséquence, la clé étant révoquée.

## Reste à faire

- Recompiler les apps de test (`npm run ios`, `npm run android`): les paquets installés avant le
  29 septembre contiennent l'ancienne clé, désormais refusée. Les projets iOS et Android sont déjà
  synchronisés avec la clé native.

## Si une clé doit changer à nouveau

1. Créer la nouvelle clé dans la console (mêmes cinq API; pour la clé web, mêmes sites), avant de
   supprimer l'ancienne.
2. Site: mettre à jour `GOOGLE_MAPS_KEY_WEB` sur les deux projets Vercel et redéployer. Local: mettre à jour
   `google-maps-keys.json`. Apps: `npm run cap:sync`, puis recompiler.
3. Vérifier (carte, autocomplétion, géocodage, trajet), puis supprimer l'ancienne clé.
