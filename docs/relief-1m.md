# Relief à 1 m autour du bâtiment (v633.237, 24 octobre 2026)

Demande de Stéphane: « sol autour de la maison », « bien, fais-le juste autour d'un bâtiment ».

- Grille locale (`api/terrain.js`, `buildAxis`): 1 m jusqu'à 128 m du lieu (le LiDAR brut), 2 m jusqu'à 256 m,
  puis pas croissant comme avant. Nouvelle couche LiDAR lue au niveau 1 m sur ±200 m. TERRAIN_V 3: chaque lieu
  recalcule son relief une fois à la prochaine ouverture (serveur et cache Supabase).
- Mesuré à Stoneham: temps serveur inchangé (environ 3 s), données du relief de 1,04 à 1,37 Mo, grille de 543 noeuds
  par axe (295 000 au lieu de 142 000). Fluidité iPhone et iPad non vérifiée.
- Gain à l'oeil: subtil à hauteur d'oeil (planche `_METEOSHOOT/references_arbres/planche-relief-1m-2026-10-24.png`),
  un peu plus lisible de haut sur un terrain en pente (bordures, talus, fossé le long de la rue).
- Non fait: collines proches (32 m entre 1,3 et 6 km), LiDAR américain 3DEP, forêt lointaine avec ses vraies
  trouées (pistes de ski, champs): voir la discussion du 24 octobre 2026.
