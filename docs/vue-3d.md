# Vue 3D de la fiche projet (bascule SAT / 3D / MAP)

Ajoutée le 5 octobre 2026. Dans la fenêtre de la carte, le bouton 3D remplace la carte par une scène 3D
du projet: les bâtiments dessinés (contour, hauteur, couleur des murs), les bâtiments voisins avec leur
hauteur, les rues, les trottoirs, les arbres, les parcs et l'eau, sous le ciel et la lumière de l'instant du
curseur. Le curseur du haut (date et heure) pilote la scène et les ombres de la carte; la météo horaire la
plus proche de cet instant (nuages bas, moyens, hauts, soleil direct) fait le ciel. Le survol de la météo
horaire ne déplace plus le curseur (retiré le 5 octobre 2026 à la demande de Stéphane: la 3D basculait en
nuit au passage de la souris). À droite de la pastille du curseur, l'icône météo de l'heure avec les nuages
et le soleil direct en pour cent rappelle ce que la scène simule.

## Ce qui est sûr et ce qui est réglé à la main

Règle posée avec Stéphane le 5 octobre 2026: la 3D ne doit jamais tromper.

- Ce qui est physique reste physique: position du soleil (astronomie), nuages bas, moyens et hauts et
  soleil direct (prévision horaire), ombres portées.
- La hauteur et la couleur des murs d'une forme sont réglées à la main dans sa pastille FORME (hauteur par
  glissement, couleur par la petite pastille ronde visible quand la 3D est ouverte: palette de huit teintes
  sobres, brique rouge par défaut). La légende dit, pour la forme que l'on regarde, d'où vient sa hauteur:
  « réglée dans le projet », « mesurée (Overture) » (forme laissée à 30 m, la valeur par défaut du dessin,
  et édifice existant mesuré) ou « par défaut » (9 m).
- Les fenêtres gardent un rythme générique sobre (deux rangées jusqu'à 16 m, puis 4,5 m par étage, une
  fenêtre par 6 m): elles ne prétendent pas reproduire le vrai bâtiment.
- Une analyse automatique des images du client par Claude (couleurs, volumes, façades) a été construite et
  essayée le 5 octobre 2026 (école Saint-Paul-Apôtre, 8 façades sur 12 trouvées, 17 à 21 cents et 70 à 110 s
  par analyse), puis retirée le soir même avec Stéphane: résultat « un peu cheese » et pas assez précis pour
  valoir la clé API, le coût et le risque de façades erronées. Le réglage manuel suffit pour juger la lumière.
  Restes: la colonne `style3d` des tables `projects` et `projects_dev` (inutilisée, à laisser), la variable
  `ANTHROPIC_API_KEY` dans Vercel (révocable dans la Console Anthropic, clé « Meteoshoot-3D »), et le code
  dans l'historique git (commit 1a81033, v633.144 avant retrait) si l'idée revient.

## Fichiers

- `src/scene3d/engine.js`: moteur (three.js, chargé à la demande par import dynamique). Ciel clair physique
  (modèle de Preetham, le même que `Sky.js` de three: diffusion de Rayleigh pour le bleu, de Mie pour le halo
  du soleil et la brume, extinction le long du rayon; turbidité un peu plus forte sous le voile), avec par-dessus
  les nuages bas en cumulus, moyens en couche, hauts en voile, soleil visible selon le soleil direct; le ciel
  est capturé en carte d'environnement pour éclairer la scène. Couleur et force du soleil direct tirées de la
  même extinction (blanc chaud haut dans le ciel, orangé puis rougeoyant au ras de l'horizon, adouci).
  Appoint hémisphérique: ciel bleuté ou gris par le haut, lumière renvoyée par le sol (teinte herbe et
  asphalte, plus forte au soleil) par le bas. Ombres douces (VSM) dont la pénombre s'élargit avec le voile et
  les nuages; ombres de nuages qui passent; passes d'image: occlusion ambiante (recoins), tonalité ACES,
  lissage FXAA. Heure bleue et nuit traitées à part (dégradé bleu profond, lueur à l'horizon côté soleil).
  Bâtiments en un seul tracé (murs avec fenêtres par étage, toits plats); arbres instanciés à lobes avec
  masque de feuillage (le soleil passe entre les feuilles: ombre parsemée). Point de vue choisi à hauteur
  d'oeil du côté du créneau (AM ou PM), dans l'espace libre, vue dégagée sur le bâtiment principal.
- `src/scene3d/footprint.js`: empreintes dessinées en mètres (contour antihoraire, hauteur réglée ou défaut)
  et côtés de chaque forme avec leur orientation (légende « Forme 1, côté sud-ouest »).
- `src/scene3d/Scene3D.jsx`: composant React (légende: condition de lumière, parts de nuages, soleil, forme
  en face et source de sa hauteur; boussole; états de chargement).
- `src/scene3d/data.js`: environs d'un lieu: cache partagé Supabase `scene3d_cache`, sinon fonction
  serveur `/api/scene3d?lat&lng&v=2`, puis insertion (ou remplacement d'une version périmée) dans le cache.
  Le `v` dans l'adresse évite de retomber sur une réponse gardée 24 h par le navigateur.
- `api/scene3d.js`: fonction Vercel (Node, paquet `duckdb`). Lit Overture Maps (données ouvertes:
  empreintes Microsoft et OpenStreetMap, hauteurs estimées) en HTTPS direct dans les fichiers Parquet
  publiés sur S3 (pas en s3://: sur Vercel, les identifiants AWS ambiants faussaient les requêtes), cinq
  requêtes en parallèle (bâtiments, rues avec leur nom, terrain, usage du sol, eau), découpées par un cadre
  autour du lieu, converties en mètres. Environ 80 Ko, 12 secondes avec l'index, 2 minutes sans. Version 2
  depuis le 5 octobre 2026 (noms de rues, gardés pour un usage futur).
- `api/overture-index.json`: cadre géographique de chaque fichier Parquet d'Overture, par type. À régénérer
  quand on change de version d'Overture (constante `RELEASE`): `python3 scripts/overture-index.py
  2026-09-23.1` (une minute; demande `pip install pyarrow`).
- `scripts/scene3d-dev.mjs`: la fonction en local, port 3999 (`npm run api`); le proxy Vite envoie `/api`
  dessus, ou sur un déploiement d'aperçu si `MS_API_PROXY` est donné (`.env.local`, ignoré par git).
- `supabase/migrations/20261005120000_cache_scene_3d.sql` (table `scene3d_cache`),
  `20261005150000_style_3d_projet.sql` (colonne `style3d`, inutilisée),
  `20261005200000_cache_scene_3d_mise_a_jour.sql` (mise à jour d'une entrée périmée par un compte connecté).
- `src/weather/api.js`: l'horaire porte `cloudMid` et `cloudHigh` (nuages moyens et hauts).
- `vercel.json`: durée maximale de `api/scene3d.js` (90 s). `.vercelignore` exclut les dossiers natifs et de
  compilation (sans lui, le client Vercel envoyait 15 000 fichiers).
- Données du projet: chaque forme de `buildings` porte `polygon`, `height`, `name` et, depuis la v633.144,
  `wallColor` (hexadécimal, facultatif). Pas de migration: `buildings` est une colonne jsonb.

## Règles de rendu (validées avec Stéphane)

- Le ciel occupe plus de la moitié du cadre: c'est lui qui montre le rapport entre nuages et soleil direct.
- Nuages figés (pas d'animation) pour une heure donnée.
- Pas d'effet de style non demandé (grain, vignettage).
- Les arbres devant une façade donnent une lumière en taches, pas un bloc d'ombre.
- Heure bleue (20 à 50 minutes après le coucher): ciel bleu profond, façade côté couchant plus claire,
  lumière très diffuse sans ombre, quelques fenêtres allumées avec une lueur douce.
- Fenêtres sobres et génériques; pas de reproduction du vrai bâtiment.

## Vercel

- Fluid compute activé le 5 octobre 2026 sur le projet meteoshoot: sans lui, les fonctions étaient coupées à
  15 s (durée par défaut du projet) et ni `export const maxDuration` ni le bloc `functions` ne la relevaient;
  un centre-ville dense (plus de 15 s de DuckDB) aurait donné une erreur. Facturation au temps de calcul
  réel; quotas du forfait Pro largement suffisants.
- Déploiement d'aperçu sans pousser: `npx vercel link --yes --project meteoshoot --scope sgroleaus-projects`
  puis `npx vercel deploy --yes --archive=tgz` (voir la mémoire « variables Vercel »).

## Lumière (5 octobre 2026, v633.145)

- Option 1 faite: ciel physique de Preetham, couleur du soleil par extinction, rebond du sol (lumière
  hémisphérique), pénombre selon le voile. Vérifié en local à midi, 16 h 36, 17 h 56 (soleil à 3°, face au
  soleil et dos au soleil), heure bleue et ciel couvert. Réglages: `uTurb` 2,3 + 2 × voile haut + 0,8 × voile
  moyen, `uRay` 1,5, `uSkyK` 0,2 (échelle vers notre exposition), épaule douce 1/(1 + 0,22 × luminance) à
  l'horizon, soleil = 0,85 × (Fex/max)^0,45 + 0,15.
- Option 2 faite (v633.146): **rendu affiné** à la demande, bouton « Rendu affiné » en bas à droite de la 3D
  (ordinateurs seulement, caché au toucher). Lancer de rayons progressif avec three-gpu-pathtracer
  (`WebGLPathTracer`, 4 rebonds): dès que caméra, heure et météo sont immobiles depuis 350 ms, le traceur
  accumule 2 échantillons par image jusqu'à 200, puis s'arrête (la carte graphique se repose); pause si
  l'onglet est caché; tout mouvement rend la vue directe et remet l'accumulation à zéro. La scène du traceur
  partage géométries et matériaux avec la vue directe, limitée à la zone proche (230 m): murs, toits,
  soubassement, surfaces et rues proches, sol, arbres fusionnés en un maillage (couronnes simplifiées,
  couleur par sommet). Toute la lumière vient du ciel capturé en cube 512 (puissance de deux obligatoire pour
  la conversion en équirectangulaire du traceur) avec un disque solaire physique de 0,8° dont la radiance vaut
  l'irradiance du soleil de la scène (uniformes `uPhys`, `uSunL`): ombres douces vraies, lumière indirecte,
  ciel et nuages de la prévision, fenêtres allumées qui éclairent la nuit. Le résultat passe par la même
  exposition et la même tonalité (ACES) que la vue directe.
  Limites connues: pas de brouillard de distance (la zone lointaine n'est pas dans le traceur), pas d'ombres
  de nuages qui passent, toutes les fenêtres allumées la nuit (le hasard une sur deux est un détail de shader
  que le traceur ignore), 20 à 40 s pour 200 échantillons sur un Mac récent. Le 5 octobre 2026, une première
  version sans plafond (600 échantillons, pleine zone) a saturé le Mac de Stéphane: garder le plafond.
- Zones et détail: `NEAR = 230 m` autour du projet (origine) sépare les maillages proches (userData.pt, rendu
  affiné) des lointains; arbres détaillés jusqu'à 160 m, couronnes simplifiées au-delà (deux lots instanciés).
  Acné d'ombre (bandes en escalier sur les murs frôlés par le soleil) corrigée par `shadow.normalBias = 0.7`.
- Retouches du 5 octobre au soir (v633.147), après les retours de Stéphane (« lumière pas mal du tout »):
  bande blanche entre ciel et terre supprimée (épaisseur d'atmosphère bornée à 7° d'élévation dans le modèle,
  épaule 1/(1 + 0,5 × luminance), niveau du zénith calé par `zenTarget = 0,035 + 0,14 × (sin el / 0,45)^0,55`
  via `uSkyK`, brouillard teinté avec l'horizon du même ciel dans la direction regardée mais 0,45 fois plus sombre, le sol lointain étant plus sombre que le ciel, sinon « brume blanche »; sous un ciel couvert, les cumulus lointains se rejoignent jusqu'au sol dans le shader (`hz`, `hzc`) et le brouillard prend la base grise des nuages); ombres en escalier
  sur les façades corrigées (carte d'ombre resserrée à 300 m autour du projet, soit 7 cm par pixel, flou à 24
  échantillons, normalBias 0,5); fenêtres modernes (grande baie plus large que haute, cadre fin anthracite, un
  meneau décalé, appui discret, plus de filet entre les étages) et nombre entier de travées par mur, centrées,
  pour qu'aucune fenêtre ne soit coupée dans un coin.
- v633.148: rayures diagonales d'acné d'ombre au soleil bas (la carte VSM garde la profondeur en demi-flottants:
  sur une plage de plus d'un kilomètre, les quanta dépassaient le décalage) corrigées en serrant la caméra
  d'ombre en profondeur: lumière à 520 m du projet, plage 300 à 780 m, biais -0,0008, normalBias 0,6. Vérifié
  le 24 novembre à 14 h 30 (soleil à 12°). Au-delà de 36 h de prévision ou dans le passé, la scène suppose
  une journée ensoleillée et l'icône météo près du curseur disparaît (`sceneWeatherRow` nul).
- Idée notée par Stéphane (5 octobre 2026): les saisons (feuillage l'hiver, neige au sol et sur les toits,
  idéalement d'après la hauteur de neige d'Open-Meteo).
- iPhone et iPad: la 3D fonctionne dans la vue web; le survol n'existe pas au doigt (à valider).
