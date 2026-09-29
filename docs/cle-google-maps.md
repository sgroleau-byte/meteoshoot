# Clé Google Maps: régénération, restrictions et emplacement

## État au 29 septembre 2026

- Une seule clé Maps JavaScript, non restreinte, sert au site et aux apps natives.
- Cette clé a été publiée dans le dépôt GitHub public depuis février 2026 (dans la page, puis dans
  `google-maps-keys.json` à partir du 26 septembre). GitGuardian et GitHub (Sécurité > Secret scanning,
  alerte 1) l'ont signalée le 28 septembre.
- Depuis la v633.123, `google-maps-keys.json` n'est plus suivi par git (`.gitignore`). La compilation lit
  d'abord les variables d'environnement `GOOGLE_MAPS_KEY_WEB` (site) et `GOOGLE_MAPS_KEY_NATIVE`
  (apps), puis le fichier local en secours; sans l'un ni l'autre, `npm run build` échoue avec un message
  clair. Modèle du fichier: `google-maps-keys.example.json`.
- Sur Vercel (projets `meteoshoot` et `meteoshoot-dev`), `GOOGLE_MAPS_KEY_WEB` est définie pour la
  production, les aperçus et le développement. Les apps natives se compilent en local, avec le fichier.

Une clé Maps JavaScript est de toute façon visible dans la page servie (le navigateur en a besoin pour
charger la carte). Sa protection n'est pas le secret mais les restrictions appliquées dans la console
Google Cloud: référents autorisés, API autorisées, plafonds de quota. La clé exposée n'étant pas
restreinte, elle doit être régénérée.

## À faire dans la console Google Cloud (par Stéphane)

Console: https://console.cloud.google.com/apis/credentials (choisir le projet qui porte la clé).

1. Ouvrir la clé actuelle, bouton « Régénérer la clé ». Google fournit une nouvelle valeur; l'ancienne
   reste acceptée 24 heures, ou peut être coupée tout de suite par « Supprimer l'ancienne clé » (à faire
   dès que le site et le fichier local sont à jour, étape 3).
2. Coller la nouvelle valeur dans `google-maps-keys.json` (champs `web` et, pour l'instant, `native`) et
   dans la variable `GOOGLE_MAPS_KEY_WEB` des deux projets Vercel (Settings > Environment Variables),
   puis redéployer (Deployments > Redeploy sur le dernier déploiement, ou un push).
3. Vérifier le site (carte d'une fiche, carte de route, autocomplétion d'adresse, géocodage d'une adresse
   tapée, temps de trajet), puis « Supprimer l'ancienne clé » dans la console.
4. Créer une seconde clé « MeteoShoot natif » et la coller dans le champ `native` du fichier local; les
   apps se recompilent avec `npm run ios` et `npm run android`.
5. Clé web, restriction « Sites web » (référents HTTP): `https://meteoshoot.com/*`,
   `https://www.meteoshoot.com/*`, `https://meteoshoot.vercel.app/*`, `https://*.vercel.app/*` (aperçus),
   `http://localhost:5173/*` (développement).
6. Clé native, restriction « Sites web »: `capacitor://localhost/*` (iOS) et `https://localhost/*` (Android).
7. Les deux clés, « Restreindre la clé » aux API utilisées: Maps JavaScript API, Places API, Geocoding
   API, Directions API, Distance Matrix API.
8. Facturation > Rapports, filtré sur Maps: vérifier qu'aucun usage anormal n'a eu lieu depuis
   février 2026. APIs et services > Quotas: fixer un plafond journalier par API.
9. Revérifier dans l'app iOS (simulateur suffit) et Android: carte, autocomplétion, géocodage, trajet.
10. Une fois l'ancienne clé supprimée: fermer l'alerte GitHub (Sécurité > Secret scanning, alerte 1,
    « Close as: Revoked ») et l'incident GitGuardian (« Revoked »).

Note: une restriction par référents protège contre l'usage depuis d'autres sites; elle n'empêche pas
un usage depuis une autre app native imitant l'origine `capacitor://localhost`. D'où les plafonds.

## Historique git

L'ancienne clé reste dans l'historique des commits (février à septembre 2026). Réécrire l'historique
(git filter-repo, push forcé, purge par le support GitHub) est lourd et ne retire pas les copies déjà
faites ailleurs; la régénération rend cette valeur inerte, ce qui suffit. Décision de Stéphane le
29 septembre 2026.
