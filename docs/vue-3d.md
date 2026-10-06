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
- Les fenêtres gardent un rythme générique sobre (une rangée par étage de 3,6 m, une travée par 8 m sur
  l'édifice photographié, par 6,5 m chez les voisins): elles ne prétendent pas reproduire le vrai bâtiment.
- Le point de vue vise la première forme dessinée; sans forme, l'édifice Overture sous le point du projet
  (ou le plus proche à moins de 60 m).
- Une analyse automatique des images du client par Claude (couleurs, volumes, façades) a été construite et
  essayée le 5 octobre 2026 (école Saint-Paul-Apôtre, 8 façades sur 12 trouvées, 17 à 21 cents et 70 à 110 s
  par analyse), puis retirée le soir même avec Stéphane: résultat « un peu cheese » et pas assez précis pour
  valoir la clé API, le coût et le risque de façades erronées. Le réglage manuel suffit pour juger la lumière.
  Nettoyage complet le soir même (v633.151): colonne `style3d` supprimée des tables `projects` et `projects_dev`
  (migration 20261005230000), variable `ANTHROPIC_API_KEY` retirée de Vercel, dépendances retirées. Reste à
  Stéphane: révoquer la clé « Meteoshoot-3D » dans la Console Anthropic. Le code vit dans l'historique git
  (commit 1a81033) si l'idée revient.

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
  `20261005150000_style_3d_projet.sql` (colonne `style3d`, supprimée par `20261005230000_retrait_style_3d.sql`),
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
- v633.149, **ombres PCSS** (percentage-closer soft shadows), « vraiment mieux » selon Stéphane: `engine.js`
  greffe sa propre fonction `getShadow` dans le chunk `shadowmap_pars_fragment` de three (branche du mode
  `BasicShadowMap`, carte de profondeur 24 bits lue directement, plus de demi-flottants ni de fuites de
  lumière): recherche des occulteurs (16 échantillons, disque de Vogel tourné par un bruit par pixel), largeur de
  pénombre proportionnelle à la distance occulteur-récepteur (constante 0,0149 = plage de profondeur 480 m x
  2 tan 0,25° / cadre 300 m, multipliée par `shadow.radius`), puis filtrage à 24 échantillons. `shadow.radius`
  vaut 1 au soleil franc (vraie taille du soleil) et monte jusqu'à 8 sous le voile et les nuages (pénombre
  élargie). Si le chunk de three change de forme, le code retombe sur les ombres PCF de three avec un
  avertissement. Caméra d'ombre: lumière à 520 m, plage 300 à 780 m, cadre 300 m, 4096 px, biais -0,0006,
  normalBias 0,5.
- v633.150, fenêtres la nuit (demande de Stéphane): toutes les fenêtres de l'édifice photographié sont allumées
  (graine `aSeed` négative dans le shader des murs; les voisins gardent une fenêtre sur deux au hasard), lueur
  douce (carte d'émission avec halo 40 px, seuil de l'éclat 0,3, flou 1,8 px au quart de résolution, éclat
  0,55, émission 0,62 pour des fenêtres chaudes plutôt que blanches; une première version plus forte « bavait
  trop » pour Stéphane), et la lumière des fenêtres éclaire
  les alentours: une lumière surfacique (`RectAreaLight`, `RectAreaLightUniformsLib`) par façade du projet
  (les 12 plus longues, 6 au toucher), devant le mur à mi-hauteur, dirigée vers l'extérieur, intensité 0,32 ×
  l'émission des fenêtres: sol, arbres et voisins proches reçoivent une lueur chaude. Le rendu affiné le fait
  physiquement (fenêtres émissives) et n'utilise pas ces lumières.
- v633.152, **surfaces pavées d'après l'imagerie satellite** (`api/paved.js`, environs version 3), demandées par
  Stéphane pour les stationnements et les aires que les cartes ignorent (essai sur l'héliport de Valcartier:
  aire, plateformes, voies de circulation, stationnements). Tuiles Esri World Imagery (zoom 19, 0,2 m par
  pixel, 196 tuiles sur 640 m, attribution « Esri, Maxar, Earthstar Geographics » en légende), classification par
  couleur (béton clair: luminosité > 0,70 et saturation < 0,22; asphalte neutre: saturation < 0,12; asphalte
  bleuté: teinte 165 à 275° et saturation < 0,22; jamais sous 0,23 de luminosité), moins les bâtiments
  (dilatés de 2,5 m) et les rues (largeur + 2 m), morphologie à 0,4 m (fermer 3,5 m, ouvrir 3 m, fermer 2 m),
  composantes de 200 m² et plus, contour extérieur (et trous depuis la v4) suivi puis simplifié au mètre. Désactivé quand plus de 18 %
  du sol est bâti dans 300 m (centre-ville: tout est gris). Environ 3 s de plus par lieu, une fois (cache).
  Rendu: même gris que l'asphalte, légende « surfaces pavées d'après l'imagerie satellite, approximatives ».
  Limites: bords au mètre près, gravier et sols nus parfois pris pour du pavé, toits non répertoriés aussi.
  Prototype Python (OpenCV) dans le scratchpad de la session du 6 octobre; la version serveur est en pur JS.
- v633.153 (6 octobre 2026): gris plus foncés au sol (rues #383b3e, asphalte et pavé #3a3d40, trottoirs #9b978d);
  une rangée de fenêtres par étage de 3,6 m, moins de fenêtres (travée de 8 m sur le projet, 6,5 m chez les
  voisins); sans forme dessinée, la caméra vise l'édifice Overture sous le point du projet. **Scintillement des
  zones grises** (« une forme par-dessus l'autre qui entre en conflit », vu par Stéphane à 100 m de haut):
  deux causes, les surfaces au sol empilées à quelques millimètres (pavé de l'imagerie à 4,5 cm sous l'asphalte
  à 5 cm, même matériau) et le sol en un seul quad de 60 km dont la profondeur interpolée n'est pas assez
  précise pour départager des surfaces à 3 cm au-dessus. Correction: les surfaces au sol n'écrivent plus la
  profondeur et se dessinent dans un ordre fixe (gazon 1, asphalte 2, pavé 3, rails 4, rues 5, trottoirs 6,
  `renderOrder`), décalage de polygone sans pente (facteur -1 seulement, le facteur par couche faisait baver
  les surfaces lointaines sur le pied des bâtiments aux angles rasants), et sol en deux pièces: carré de 3 km
  maillé en 60 × 60 (triangles de 50 m) à y = 0, plaine de 60 km à y = -0,3 m. Contours pavés adoucis à
  l'affichage (`smoothRing`: rééchantillonnage au mètre, moyenne sur ±3 m, simplification à 25 cm) pour
  enlever l'effet « Minecraft » des marches de 2 à 3 m issues de la morphologie carrée; le cache (version 3)
  n'a pas changé. Méthode de mesure (sans la voir à l'oeil): en développement, `window.__scene3dCore`
  expose le rendu, la scène et la caméra, et `__scene3dCore.afterFrame(PW, PH)` est appelé à la fin de chaque
  image: lire les pixels (`gl.readPixels`), comparer deux images dont la caméra n'a bougé que de 0,0004 rad;
  contours en mouvement = 500 à 5 000 pixels changés sur 2,9 M, conflit de profondeur = 100 000 à 850 000.
  Attention: après une modification de `engine.js`, Vite ne recrée pas la scène ouverte (le composant
  `Scene3D` accepte la mise à jour sans relancer l'effet): fermer et rouvrir la 3D ou recharger la page.
- v633.154 (6 octobre 2026), **formes pavées nettes** (« des formes de stationnement plus précises, moins organiques »,
  avec la capture du Y de l'héliport). Trois changements. Serveur (environs **version 4**, `SCENE_V = 4`, les entrées v3
  du cache sont recalculées à la prochaine ouverture): les composantes gardent leurs **trous** (fond enclavé de 150 m²
  et plus: l'herbe au milieu du Y était avalée, le contour extérieur seul donnait un triangle plein), format
  `paved: [{ o, h }]`; asphalte neutre admis jusqu'à 0,16 de saturation au lieu de 0,12 (stationnement sud de
  Valcartier capté à 79 % au lieu de 47 %, herbe sèche toujours sous 3 %, mesuré sur l'imagerie Esri). Client
  (`regularizeRing` dans engine.js, remplace le simple lissage de la veille): lissage ±4 m, Douglas-Peucker 1,2 m,
  directions dominantes (histogramme des angles pondéré par la longueur, pics ≥ 10 % du périmètre, perpendiculaire
  de la principale ajoutée), côtés alignés à ±12°, côtés consécutifs à moins de 15° fusionnés, sommets aux
  intersections (jonction par projection si l'intersection s'éloigne de plus de 6 m ou 75 % du côté). Résultat:
  côtés droits et coins francs, aires conservées à 84 à 100 %. Banc d'essai hors application dans le scratchpad de
  la session (`regul/`: prototype `regularize.mjs`, `run4.mjs` + `draw4.py` → `compare4.png`, `engine_fns.mjs`
  qui exécute les fonctions extraites d'engine.js et vérifie qu'elles donnent la même chose que le prototype).
- v633.155 (6 octobre 2026), **zoom** (« on peut activer le zoom, quitte à le limiter si ça cause problème »):
  pincement à deux doigts (iPhone, iPad), molette ou trackpad, et les boutons + et - de la fenêtre agissent sur la 3D
  quand elle est affichée (`zoomRef` passé par ProjectDetail à Scene3D, `engine.zoom(f)`, un cran = × 1,4). Le doigt
  restant après un pincement continue à tourner. Distance bornée par `clampR`: au moins la demi-diagonale de
  l'emprise du bâtiment visé + 8 m (la caméra n'entre jamais dedans, calculé dans `pickView`), au plus 450 m.
- v633.156 (6 octobre 2026), **attente épurée**: pendant le chargement du moteur puis des environs (jusqu'à 20 s la
  première fois pour un lieu), un anneau fin (arc clair qui tourne, 34 px, `scene3dSpin` dans app.css) au-dessus
  d'un mot court en Bebas (« Chargement », « Environs en préparation »), centré, fondu à l'apparition; les
  messages d'erreur restent en texte seul (`status = { text, busy }` dans Scene3D).
- v633.157 (6 octobre 2026), **page restée ouverte pendant un déploiement**: Stéphane a vu « La 3D ne peut pas
  s'afficher ici » dans l'app Mac après les mises en production 155 et 156. Cause: l'ancienne page demandait le
  morceau `engine-<hachage>.js` d'un déploiement précédent, qui n'existe plus sur le domaine (chaque déploiement
  Vercel a ses propres fichiers). La version compilée elle-même fonctionnait (vérifié sur `meteoshoot-dist`).
  Correction: `src/shared/updateReload.js` (`reloadForUpdate`, une fois par minute, garde-fou en sessionStorage;
  `isChunkLoadError`), écouteur `vite:preloadError` dans main.jsx, et dans Scene3D le message « Mise à jour de
  l'application » avec rechargement, sinon « Nouvelle version disponible : recharger la page » si on vient déjà de
  recharger. Test: retirer `dist/assets/engine-*.js`, servir dist, ouvrir la 3D: un rechargement, puis le message,
  pas de boucle. Après le rechargement l'app revient à la liste (pas de lien profond vers la fiche au chargement).
- v633.158 (6 octobre 2026), **rendu affiné retiré** (« l'option rendu affiné fait buguer le Mac, l'ordi devient
  saccadé », Mac Studio M1 Ultra; « cette option ne sert à rien »): bouton, état `rt`, `setRayTracing`, tout le code
  du traceur dans engine.js (ptEnable/ptBuild/ptEnvRender, scène partagée, cube d'environnement physique uPhys/uSunL,
  compositing du traceur) et les dépendances `three-gpu-pathtracer` et `three-mesh-bvh` supprimés. La dernière
  version qui l'avait est étiquetée `rendu-affine` (4f899e6, v633.157) si l'idée revient un jour; la cause probable
  du saccadé était deux échantillons plein cadre par image à la densité 2 sans découpage en tuiles. Le partage
  proche/lointain (`userData.pt`, NEAR 230 m) reste: il sert au détail des arbres. **Boussole** (le « rond à côté » que
  Stéphane ne reconnaissait pas): la lettre N est posée à la pointe de l'aiguille et reste droite quand l'aiguille
  tourne. **Échelle de la carte** cachée en 3D (elle chevauchait la boussole; la perspective n'a pas d'échelle fixe).
- Idée notée par Stéphane (5 octobre 2026): les saisons (feuillage l'hiver, neige au sol et sur les toits,
  idéalement d'après la hauteur de neige d'Open-Meteo).
- iPhone et iPad: la 3D fonctionne dans la vue web; le survol n'existe pas au doigt (à valider).
