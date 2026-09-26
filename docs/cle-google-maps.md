# Clé Google Maps: restrictions à appliquer avant publication

État au 26 septembre 2026: une seule clé, non restreinte, visible dans la page (comme toute clé
Maps JavaScript). Elle sert au site et aux apps natives. La carte fonctionne dans l'app iOS parce que
rien n'est restreint.

## Objectif

Deux clés dans `google-maps-keys.json` (à la racine du dépôt, valeurs publiques):
- `web`: injectée par `npm run build` et `npm run dev` (site).
- `native`: injectée par `npm run build:native`, `npm run cap:sync`, `npm run ios`, `npm run android`.
Tant que les deux valeurs sont identiques, rien ne change.

## À faire dans la console Google Cloud (par Stéphane)

1. Créer une seconde clé « MeteoShoot natif » (ou dupliquer l'actuelle), la coller dans `native`.
2. Clé `web`, restriction « Référents HTTP »: `https://meteoshoot.com/*`, `https://www.meteoshoot.com/*`,
   `https://meteoshoot.vercel.app/*`, `https://*.vercel.app/*` (aperçus), `http://localhost:*/*` (développement).
3. Clé `native`, restriction « Référents HTTP »: `capacitor://localhost/*` (iOS) et `https://localhost/*` (Android).
4. Les deux clés, restriction d'API: Maps JavaScript API, Places API, Geocoding API, Directions API,
   Distance Matrix API (les cinq services utilisés).
5. Après application: vérifier la carte d'une fiche, la carte de route, l'autocomplétion d'adresse
   (nouveau projet, adresse de départ), le géocodage d'une adresse tapée et le temps de trajet,
   sur le site puis dans l'app iOS (simulateur suffit) et Android.

Note: une restriction par « référents » protège contre l'usage depuis d'autres sites; elle n'empêche pas
un usage depuis une autre app native imitant l'origine `capacitor://localhost`. Surveiller les quotas dans
la console et fixer des plafonds journaliers par API.
