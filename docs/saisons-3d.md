# Saisons du feuillage dans la vue 3D

Étape 1 du dossier « saisons » (23 octobre 2026): couleur des feuillus selon la date et le lieu, d'après un calendrier
moyen. Les étapes suivantes, non faites: chute des feuilles et arbres nus (couronnes qui s'éclaircissent, squelette),
puis l'hiver (neige au sol, sur les toits et les conifères, image satellite d'été à recouvrir).

## Ce que ça change

- Avant: les feuillus portaient une palette d'automne fixe toute l'année, la même à Toronto et à Stoneham.
- Maintenant: vert d'été, montée de la couleur sur trois semaines, pic, puis brunissement vers le gris brun des
  branches à la date moyenne de la chute; au printemps, vert tendre du débourrement à la feuillaison.
- Seule la couleur change. Positions, hauteurs, cimes et formes des arbres LiDAR sont intactes (`trees()` du moteur ne
  touche qu'à `setColorAt`); la forêt du relief lointain suit la même teinte.
- Les dates sont une MOYENNE (pas l'année en cours): une saison précoce ou tardive décale tout d'une à deux semaines.

## Calendrier moyen

Source: satellite MODIS, produit de phénologie MCD12Q2 (pixels de 500 m, un cycle par an), moyenne 2012 à 2021, lu par
le service public de l'ORNL DAAC (sans compte). Pour chaque point d'une grille (Canada et États-Unis, resserrée sur le
Québec, l'Ontario, les Maritimes et la Nouvelle-Angleterre), médiane des pixels valides d'une fenêtre de 4 km:

- milieu du brunissement (perte de la moitié de la verdure): Stoneham vers le 17 septembre, Québec le 5 octobre,
  Toronto le 12;
- feuilles tombées, environ cinq semaines plus tard;
- débourrement et feuillaison du printemps.

Le pic de couleur visible suit le milieu du brunissement de 30 % de l'intervalle jusqu'à la chute au nord du 46e
parallèle, davantage vers le sud (6 % par degré, 70 % au plus): plus la saison est douce, plus le satellite devance
l'oeil (calé sur la webcam de Toronto du 23 octobre 2026, ville encore à moitié verte, Québec vers le 12 octobre, New
York début novembre). La chute se termine cinq jours avant la dormance satellite (Tremblant nu le 23 octobre 2026).
Chaque arbre décale son calendrier de plus ou moins 9 jours. Références: `_METEOSHOOT/references_arbres/`.

Scripts: `tools/phenology-harvest.py` (récolte, cache des réponses brutes dans `raw/`), puis `tools/phenology-fit.py
points.json src/scene3d/phenology.js` (altitudes par Open-Meteo, régression latitude + altitude sur la forêt de l'Est,
points conservés). À l'exécution, `src/scene3d/season.js` corrige la régression par les écarts des points voisins
(inverse du carré de la distance, 30 km de lissage, 700 km de portée). Les points de cultures, de prairies et des
hivers verts de Californie sont écartés par des bornes de plausibilité.

## Essences

`api/trees.js` donne à chaque arbre un code k: 0 feuillu quelconque, 1 conifère, 2 érable (rouge et orangé, 4 jours
plus tôt), 3 feuillu jaune (orme, tilleul, frêne, bouleau, peuplier, érable de Norvège et argenté), 4 chêne et hêtre
(brun roux, une à deux semaines plus tard, garde ses feuilles), 5 mélèze (conifère qui jaunit tard puis se dénude),
6 érable pourpre. Sources: l'inventaire de la Ville de Québec (nom français de chaque arbre public) et, dans les
peuplements, le premier groupe feuillu du code `gr_ess` de la carte écoforestière (répartition tirée au sort par arbre,
fixe pour une même cime). Ailleurs: feuillu quelconque, dont la palette mélange déjà orangés, jaunes et olives.

Les scènes déjà en cache (Supabase `scene3d_cache`, version 11) gardent leurs codes 0 et 1: pas de rafraîchissement
forcé (le LiDAR coûte cher); les essences apparaissent sur les scènes recalculées.

## Vérification

Banc: `tools/sky/shoot.mjs` avec `harness.html?lat=&lng=` et une liste de dates (ciel peu nuageux, 13 h). Planche
du 23 octobre 2026: Stoneham, Québec, Montréal, Toronto et Burlington les 25 septembre, 10 et 25 octobre; Québec du
15 juillet au 10 novembre.
