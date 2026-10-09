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
  Bâtiments en un seul tracé (murs avec fenêtres par étage, toits plats); arbres instanciés (feuillus à lobes,
  conifères en cônes étagés) avec masque de feuillage (le soleil passe entre les feuilles: ombre parsemée), mesurés
  par LiDAR depuis la v633.172 (voir plus bas). Point de vue choisi à hauteur
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

## Modèle d'architecte importé (octobre 2026)

Construit le 8 octobre 2026: le vrai modèle 3D de l'architecte remplace la forme dessinée, pour juger la lumière
sur le bâtiment tel qu'il sera. La règle « fenêtres génériques » ci-dessus vise les bâtiments générés; le modèle
importé, lui, est le fichier de l'architecte.

- **Import**: pastille MODÈLE 3D (en haut à gauche de la 3D, sous la boussole), puis un fichier .kmz. Dans SketchUp:
  Fichier, Exporter, Modèle 3D, type Google Earth (.kmz). Ne pas passer par l'export IFC de SketchUp (format des
  logiciels d'architecture): il sort vide quand les objets ne sont pas classés, ce qui est le cas courant.
- **Préparation dans le navigateur**, une fois, à l'import (« PRÉPARATION n % »), sans serveur (`modelImport.js`):
  - retrait de l'intérieur par visibilité: chaque triangle est dessiné sous des centaines de vues tout autour et à
    hauteur d'oeil; ce qui n'est jamais vu de l'extérieur (cloisons, planchers, meubles, face intérieure des murs)
    est retiré;
  - pièges de SketchUp: faces recto-verso exportées en deux triangles superposés (recto seul gardé), composants en
    miroir (sens corrigé), doublons, faces simples tournées vers l'intérieur (retournées);
  - détourages retirés (images percées: arbres, plantes, personnages) et objets égarés écartés (voiture, personnage,
    bloc oublié loin de la maison); un garage ou un deuxième bâtiment à moins de 60 m est gardé;
  - vitrages (`glazing.js`, v633.176): est du verre un matériau d'opacité inférieure à 1, ou de couleur unie bleu pâle sans
    texture (teinte 175 à 235°, clair, saturé à 15 % au moins: la convention des fenêtres de fabricants, souvent opaques
    dans SketchUp). Chaque vitre (triangles de verre qui se touchent, parallèles à 8° près) est jugée par ce qu'il y a
    derrière elle: des rayons partent de points de la vitre des deux côtés; le premier obstacle est INTÉRIEUR (surface
    jamais vue de l'extérieur, donc retirée), MUR (vue de l'extérieur, à 25 cm ou moins, pas du verre) ou EXTÉRIEUR (plus
    loin, ou le ciel). Les feuilles d'un même vitrage à moins de 8 cm (verre en boîte de 1 cm, double vitrage) sont
    traversées. Trois types:
    - **fenêtre**: intérieur ou mur d'un côté, extérieur de l'autre (ou des lattes à 25 cm au plus devant), vitre raide,
      haut pris dans le mur, le cadre ou le toit: opaque, allumée la nuit; foncée le jour seulement si le verre d'origine
      est transparent (une fenêtre bleu pâle opaque garde sa couleur);
    - **verre libre**: extérieur des deux côtés (garde-corps, clôture de piscine, auvent): transparent, jamais allumé;
    - **vitrage sombre**: intérieur derrière sans être une fenêtre sûre (haut libre, vitre couchée: puits de lumière,
      piscine): opaque, foncé, jamais allumé.
    Verre bleu pâle opaque: fenêtre seulement si la vitre fait 8 m² au plus et 20 cm de large au moins, n'est pas la face
    d'un solide (planche, volet, porte peints en bleu), et si son matériau est une fenêtre sur les deux tiers au moins de
    ses vitres raides; sinon couleur inchangée. Chaque matériau du GLB porte `userData.vitrage` (`fenetre`, `verre`,
    `vitrage` ou vide), relu par le moteur; les fichiers plus anciens gardent la règle du suffixe `-fenetre` du nom.
    Cause (8 octobre 2026, maison de Stéphane): son garde-corps est fait de 7 boîtes de verre de 1 cm dont chaque face
    était jugée « vue d'un seul côté », donc allumée, et ses fenêtres sont bleu pâle opaques (jamais reconnues comme du
    verre). Bilan de son modèle (`info.glazing`): 38 fenêtres (dont 37 opaques), 14 verres libres, 8 vitrages sombres
    (lamelles), 42 m² allumés. Banc: `node tools/glazing/scenes.mjs` (52 scènes de synthèse: bandeau sous une dalle,
    lattes, balconnet, puits de lumière, piscine, porte peinte en bleu, mur bleu pâle avec vitre au nu, fenêtre bleue en
    boîte de 1 cm, volets bleus plaqués, revêtement bleu derrière une fenêtre...). Deux types de verre ne forment une même
    vitre que s'ils sont les deux côtés d'un même triangle; une boîte de verre opaque n'est un solide (planche, volet)
    qu'à partir de 2,5 cm d'épaisseur ou plaquée sur ce qu'il y a derrière; un pan bleu opaque de plus de 8 m² derrière
    une fenêtre est un revêtement, pas un verre. Limites connues: baie bleu opaque d'une seule
    vitre de plus de 8 m² (éteinte), garde-corps de verre à 25 cm ou moins devant un mur plein plus large que lui
    (allumé), porte ou panneau bleu pâle sans épaisseur (allumé), verre opaque gris, noir ou blanc (non reconnu), lattes à
    plus de 25 cm (vitre sombre), vitre bleue opaque en boîte de 2,5 cm ou plus, ou collée sur le revêtement (éteinte). Un modèle importé avant la v633.176 garde l'ancien classement (pas de `info.glazing`):
    le réimporter;
  - simplification au centimètre et couleurs unies (moyenne de chaque texture): un GLB (fichier 3D compact)
    d'environ 150 Ko. Banc d'essai: 194 000 triangles ramenés à 6 000, 14,4 Mo à 0,15 Mo, sans différence visible.
- **Pose**: calée sur la première forme dessinée (sinon l'édifice Overture sous le point du projet), centres
  superposés et rotation qui recouvre le mieux la forme; sans forme, la position inscrite dans le .kmz si elle tombe à
  moins de 2 km, sinon le point du projet. Toujours collée au sol: le bas du modèle au point le plus bas du relief sous
  son emprise; à flanc de colline, l'arrière s'enfonce et le relief cache la partie enterrée. La maison remplace la
  forme et l'édifice Overture qu'elle recouvre; les arbres sous elle disparaissent, ceux qui la touchent sont ajustés
  (`clearance.js`). Si la position du projet est corrigée de moins d'un kilomètre, la maison reste au même endroit
  du terrain; au-delà, pose par défaut.
- **Cadenas** (v633.175, 8 octobre 2026, Stéphane: « je n'arrête pas de déplacer le modèle 3D de ma maison quand je veux
  tourner autour »): la maison est fixée par défaut chaque fois qu'un modèle déjà placé s'affiche (retour à la 3D ou au
  projet). Fixée, la pastille ne montre que MAISON et un cadenas fermé, et glisser sur la maison fait tourner la vue comme
  ailleurs (`setModelLocked`, `pickModel` ne la saisit plus). Libre juste après un import (à placer), ou d'un clic sur le
  cadenas: les réglages ci-dessous réapparaissent, avec « Glisser la maison pour la déplacer, cadenas pour la fixer ».
- **Pastille MAISON** (une fois le modèle posé, cadenas ouvert): glisser la maison dans la vue pour la déplacer (Échap annule);
  rotation en glissant la pastille des degrés à gauche ou à droite (Maj: par 15°); hauteur en glissant la pastille
  suivante vers le haut ou le bas; flèche « recoller au sol » quand la hauteur n'est pas nulle; croix pour retirer le
  modèle (la forme dessinée revient). Retirer puis réimporter le même fichier (même nom, même taille) dans la même session
  le remet à sa place réglée à la main, hauteur comprise, cadenas fermé (mémoire perdue si la page est rechargée entre les
  deux).
- **Calque SOL SAT** (`satDrape.js`): image satellite de Plans d'Apple (1280 pixels, environ 260 m de côté à Québec,
  20 cm par pixel) drapée sur le relief autour du projet, comme repère pour poser la maison (entrée, chemin,
  clairière). Éteint à chaque ouverture de la 3D. Allumé, il masque les arbres et le sous-bois, et la légende ajoute
  « Image satellite © Plans d'Apple ». L'image vient de `api/apple-snapshot.js`, qui signe l'adresse avec la clé
  privée Apple et ne répond qu'aux pages de MeteoShoot: clé, variables Vercel et règles dans `docs/sat2-plans-apple.md`.
- **Stockage**: le GLB dans le seau Supabase `project-files` (celui des fichiers des projets), ses informations et son
  placement dans la table `project_models`, une ligne par projet (`project_models_dev` pour le site de développement,
  comme `projects_dev`); le placement s'enregistre à part du fichier (déplacer la maison n'écrit que quelques octets). Copie
  dans le navigateur (IndexedDB, le stockage interne du navigateur: base `meteoshoot-modeles`, trois clés par projet:
  le modèle, `:placement` et `:retrait`) pour l'affichage immédiat et le travail hors ligne, sans retélécharger le modèle
  à chaque ouverture. La copie locale s'affiche d'abord, puis la ligne en ligne la met d'accord (le placement le plus
  récent l'emporte; un import pas encore envoyé part en ligne, sauf si un modèle plus récent a été déposé ailleurs). La
  table est créée par la migration `supabase/migrations/20261008120000_modeles_3d.sql`, à appliquer (`supabase db push`)
  avant de déployer le code: `setup.sql` n'est jamais appliqué tout seul.
- **Fichiers**: `src/scene3d/modelImport.js` (préparation, chargée seulement à l'import), `src/scene3d/modelStore.js`
  (cache dans le navigateur), `src/scene3d/modelCloud.js` (copie en ligne: seau et table), `src/lib/supabase.js`
  (`TBL_MODELS`), `src/projects/StoreProvider.jsx` (modèle effacé avec le projet), `src/scene3d/engine.js` (`setModel`, `setModelPlacement`, `autoPlaceModel`,
  `getModelPlacement`, `setSatellite`, glisser la maison), `src/scene3d/Scene3D.jsx` (pastilles MODÈLE 3D, MAISON et
  SOL SAT), `src/scene3d/satDrape.js` (image et maillage drapé), `api/apple-snapshot.js` (image Plans signée).
- **Limites**: .kmz de SketchUp seulement; textures ramenées à leur couleur moyenne (pas de motif de brique ou de
  bardeau); image satellite datée selon Apple et limitée au carré autour du projet; conditions d'Apple pour les images
  statiques à relire avant la vente, comme celles de Google pour SAT2.

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
  affiné) des lointains; arbres en trois anneaux de détail depuis la v633.172 (moins de 150 m, 150 à 250 m, au-delà).
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
- v633.159 (6 octobre 2026): **toute nouvelle forme est blanche** (« Enduit blanc », #e8e4dc, posé à la création dans
  ProjectDetail, les deux chemins de dessin). Les formes existantes gardent leur couleur; celles créées avant sans
  couleur choisie restent en brique (repli #7a3f33 dans engine.js et la pastille).
- v633.160 (6 octobre 2026), **zone d'ombre qui suit la caméra** (« un gros carré d'ombre... ça coupe net », vu au sol
  aussi): le cadre de la caméra d'ombre n'était que ±150 m autour du projet; au-delà, ni bâtiments ni nuages n'avaient
  d'ombre, et les ombres de nuages (100 à 200 m) étaient tranchées sur le bord du carré. Maintenant la demi-largeur
  SR = 0,9·Rr + 0,8·camH + 60, bornée entre 150 et 700 m, par paliers de 50 m (sinon la grille d'ombre tremble à chaque
  mouvement); la lumière est placée à 2,2·SR + 190 (520 m à 150), plage de profondeur de −1,5·SR à +1,75·SR autour
  (300 à 780 m à 150, comme avant), biais ramené au prorata de la plage, normalBias et pénombre PCSS mis à l'échelle
  (la pénombre est en texels). À hauteur d'oeil rien ne change; en vue haute, les ombres lointaines existent et la
  coupure part dans la brume, au prix d'une finesse d'ombre de 34 cm par texel à 700 m.
- v633.161 (6 octobre 2026), **ciel gris réparé** (« pourquoi le ciel est complètement gris par une belle journée
  ensoleillée? », « ça vire au noir avant de devenir bleu flashy »). Cause: dans le shader du ciel (chaîne GLSL écrite
  sur une seule ligne), un commentaire `//` ajouté le 5 octobre pour l'épaisseur bornée avalait la suite de la ligne,
  c'est-à-dire le calcul de l'extinction atmosphérique `Fex`; `Fex` (paramètre `out` jamais assigné) valait 0: plus de
  diffusion de Rayleigh, donc un ciel gris dont la clarté ne dépendait que de la hauteur du soleil (noir au lever,
  blanc sous un soleil haut), depuis la v633.147. Le soleil lui-même (couleur et force) était calculé en JS et restait
  juste. Diagnostic: lecture des pixels du cadre (`afterFrame` + `readPixels`, attention: les rangées partent du bas),
  puis shader de débogage qui affiche `Fx` (= 0), `sunE` et les uniformes. **Règle: dans les chaînes GLSL d'une
  ligne, jamais de `//`, seulement `/* */`.** En plus, calage du ciel clair: chromaticité du modèle physique adoucie
  (35 % de blanc au zénith, 70 % à l'horizon), luminance dessinée (zénith `uZen` = cible selon la hauteur du soleil,
  horizon 2,4 fois plus clair, halo de Mie borné) au lieu de la radiance brute qui saturait en blanc dès 30° à
  travers l'ACES; brouillard recalculé sur le même horizon. Mesures après correction (vue à l'opposé du soleil, haut
  du cadre): 14 octobre 10 h 55 (120,156,196), juillet midi (133,166,202), 17 h 30 (98,130,167), lever (65,93,138).
- v633.172 (8 octobre 2026), **arbres réels** (« la densité d'arbre n'est vraiment pas réaliste... une forêt presque
  dense autour des maisons alors que le 3D montre un arbre ici et là », lot de Stoneham). Cause: Overture et
  OpenStreetMap n'ont que quelques arbres isolés (147 dans la scène de Stoneham). `api/trees.js` lit le LiDAR 1 m
  (surface moins sol, ±350 m, mêmes mosaïques que les hauteurs des bâtiments) et en tire chaque cime: maximum local
  (rayon 1,5 à 4 m selon la hauteur), toits écartés (empreintes élargies de 2 m, surface lisse, et règle `roofTops`: pans
  plans, plateau, toit voisin à la même hauteur, pour les bâtiments absents d'Overture et les empreintes décalées), couronne par partage
  des eaux de la canopée (chaque pixel à la cime qu'il rejoint en montant, au-dessus du tiers de sa hauteur, 12 m au
  plus). Stoneham: 2967 arbres, hauteur médiane 18,7 m; Limoilou: 1404. Conifère ou feuillu: inventaire des arbres
  publics de la Ville de Québec (appariement à 3,5 m), sinon carte écoforestière du Québec (WFS du ministère, part de
  résineux attendue: R 85 %, M 62 ou 35 % selon l'essence dominante, F 8 %), corrigée par la forme de la cime
  (régression calibrée sur 2499 cimes de l'inventaire, juste 7 fois sur 10 seule), tirage fixe par cime. Repli:
  arbres d'Overture (format [x, n]) là où le LiDAR ne voit pas et au-delà de 350 m. Format v6: `[x, n, h, r, k]`, et
  près d'un bâtiment `[x, n, h, r, k, dx, dn, o]` (centre mesuré de la couronne, feuillage mesuré au-dessus du toit),
  `treesSrc`, `canopy`. Hauteur maximale d'un arbre 38 m (100 m à l'ouest de -114°): au-delà, pylône, fil ou toit de
  tour (43 à 84 m mesurés à Ottawa, Outremont, Limoilou), retiré avec ses pixels.
  **Sous-bois** (idée de Stéphane: « illustrer une forêt sans faire un 3D de chacun des arbres »): dans les
  peuplements de la carte écoforestière seulement (en ville, les arbres de rue qui se touchent n'en ont pas), une
  grille de canopée de 3 m (ouverture morphologique de 6 m: ni arbre isolé ni haie) donne une nappe sombre à 60 % de
  la hauteur des cimes, rentrée de 3 m, plus une lisière trouée sous son bord: plus de gazon ni de
  troncs entre les arbres d'une forêt fermée. Elle ne porte pas d'ombre (bloc), la lisière oui (trouée).
  Rendu: rayon de couronne mesuré plus 15 % (les cimes se touchent), couronne sur environ la moitié de la hauteur,
  jamais en galette (au moins 4/5 ronde); conifères en 3 étages (2 au loin), base des branches à 12 à 25 % de la
  hauteur, rayon d'environ un cinquième de la hauteur, vert foncé toute l'année. Feuillus proches: ombre portée par
  une doublure simplifiée qui n'écrit rien à l'image (three.js choisit les objets de la carte d'ombre avec les
  couches de la caméra principale: une couche à part n'y entrerait jamais). 1500 arbres au plus au toucher.
  Point de vue: une couronne ne compte comme obstacle que si la ligne de visée la traverse; sous les arbres ou vue
  bouchée, caméra au-dessus des cimes voisines. Mesure (Mac Studio, cadre 2122 × 1600): scène et ombres à Stoneham
  1,6 ms sans arbres, 4,1 ms avec à hauteur d'oeil, 2,2 et 6,0 ms en vue de drone; 60 images/s en rotation.
  Limites: relevé LiDAR daté (arbres coupés ou plantés depuis), arbres de moins de 3 m absents, cimes urbaines qui se
  touchent comptées en moins d'arbres plus gros, mélèze (jaunit en octobre) non reconnu, couleurs toujours d'automne.
  **Arbres et bâtiments** (« il ne faut pas que les arbres entrent en conflit avec les bâtiments »): avant, 0,4 % des
  arbres à Stoneham et 9 à 21 % en ville (Limoilou, Sillery, Montcalm, Outremont, Toronto) traversaient un mur ou un
  toit, surtout par leur couronne (cercle dessiné trop large du côté de la maison, ou couronne qui descend sous le toit
  qu'elle surplombe). `src/scene3d/clearance.js` (fonctions pures) teste la forme dessinée de chaque arbre contre les
  prismes des bâtiments (formes du projet et voisins, comme `blocks()` les extrude) et l'ajuste: tronc dans une
  empreinte, arbre retiré; couronne qui touche: remontée au-dessus du toit (d'abord quand le relevé montre du feuillage
  au-dessus de ce toit, `o` dans la scène), décalée à l'opposé du mur (au plus 0,7 fois son rayon depuis le tronc) ou
  réduite jusqu'à 60 %, sinon retirée; marge de 0,3 m. Le serveur envoie, pour les arbres près d'un bâtiment, le centre
  réel de la couronne (partage des eaux) et l'indice de surplomb. Formes du projet absentes d'Overture (bâtiment neuf):
  pas de surplomb, « arbres » LiDAR au plus 1,5 m au-dessus de leur toit retirés (c'est le toit), clairière de 4 m dans
  le sous-bois. Sous-bois: cases à moins de 0,6 m d'un bâtiment retirées, bord ramené au centre de sa case s'il frôle un
  mur. Vérifié sur les instances three.js réelles (chaque sommet contre chaque prisme): 0 sommet dans un bâtiment à
  Montcalm, Outremont, Limoilou et Stoneham (avec une forme dessinée en plein boisé). Lisière ramenée à une bande de
  feuillage du tiers de sa hauteur à la nappe (on voit les troncs dessous), nappe vue du dessus seulement, sans pente
  au bord: vue de près, la lisière pleine faisait un mur de haie.
- v633.174 (8 octobre 2026), **orage et percées de soleil** (« quand c'est orageux, les nuages sont souvent très foncés;
  mélangés à des percées de soleil, ça donne des photos vraiment cool », avec une photo d'orage d'automne). Diagnostic:
  la base des cumulus avait une couleur fixe et claire, la lumière d'ambiance montait avec les nuages, et au-delà de 53 %
  de nuages bas les ombres de nuages (60 groupes tirés une fois) couvraient 98 % du terrain autour du projet: aucune
  percée possible, alors que la légende disait « soleil entre les averses ».
  - Données: la requête ICON demande aussi `convective_cloud_base` et `convective_cloud_top` (insérés avant
    `cloudcover_low`, pour que le repère `cloudcover_high&daily=` des champs du brouillard de GFS reste intact); la rangée
    horaire porte `wc` (code météo brut), `direct` (rayonnement direct, W/m²), `convBase` et `convDepth` (base et épaisseur
    du nuage convectif, 0 sans nuage convectif). GFS n'a pas ces champs ici; les rangées anciennes du cache donnent 0
    (ni orage ni percée).
  - Signal `storm` (0 à 1): code 95 à 99 (orage) = 1, 82 = 0,9, 81 = 0,75, 80 = 0,6, sinon l'épaisseur convective (de 3000
    à 8000 m, atténuée sans pluie), fois la couverture de la couche qui porte la base (25 à 70 %). Été 2025 à Québec: 0,89 en
    moyenne pour les heures d'orage, 0,03 pour la pluie ordinaire, 0,02 pour le couvert.
  - Percée: part de l'heure au soleil `pSun` = direct normal moyen (direct / sinus de la hauteur au milieu de l'heure
    précédente) rapporté au ciel clair `dniClear(h) = 950 - 710 exp(-h / 20,2)` (ICON, Québec, été 2025). Dès 0,2 (`SUN_ON`), si le voile
    laisse passer assez de lumière (`iv` au moins 0,3), les groupes d'ombre de nuage qui toucheraient le projet ou un disque de rayon `brkR` autour de lui (60 à 120 m, fixé par
    le point de vue de départ, ne suit pas le zoom) sont retirés; les autres restent (le lointain reste à l'ombre). Le ciel
    cohérent avec la caméra (`uSunGap`): à l'ombre d'un nuage, un nuage est toujours devant le soleil (disque, flare et disque
    dans la fumée éteints, `sunVis`); pendant une percée, caméra au soleil, trouée autour du soleil au bord irrégulier, ouverte
    selon le soleil direct; sinon, le ciel d'avant. Les flaques reflètent ce même ciel. Cela vaut aussi hors orage
    (éclaircies): le projet passe au soleil quand la prévision en donne, comme la légende le disait déjà. Orage sans percée
    (soleil moins du cinquième de l'heure): tous les groupes d'ombre, le projet est à l'ombre des nuages.
  - Ciel (`uStorm`): base des cumulus gris ardoise (0,30, 0,34, 0,39), plus sombre vers le coeur, relief éclairé gardé en
    bordure; couverture apparente plus forte vers l'horizon (tours de plusieurs km vues de côté); couche moyenne plus opaque
    et ardoise; bande plus claire à l'horizon sous la base quand la cellule est locale (nuages bas sous 70 à 95 %); le
    brouillard du lointain suit. Mesuré à 17 h 11 le 8 octobre (Stoneham): base du ciel à environ 100 sur 255, comme la photo.
  - Lumière: ambiance hémisphérique réduite de 55 % à pleine force (`AMB_CUT`) et teintée ardoise; carte d'environnement
    capturée sur le ciel assombri; soleil direct inchangé (déjà entier dans une percée); exposition pour le projet: au soleil
    s'il y est, pour l'ombre si un nuage d'orage le couvre. Pendant une percée, 85 % de gouttes en moins (`RAIN_BRK`), sol
    mouillé et flaques inchangés.
  - Légende: « Orage : nuages très sombres, percées de soleil par moments · Pluie faible, 1,2 mm en une heure » (« base
    sombre des nuages » pour les averses; « soleil souvent », « la plupart du temps » selon `pSun`; « projet à l'ombre des
    nuages » quand c'est le cas).
  - Non-régression vérifiée au pixel près (même vue, avant/après): ciel clair à midi et à 17 h, cumulus épars, couvert, voile
    d'altitude, heure bleue, nuit et brouillard identiques; seules changent les éclaircies (projet au soleil), l'orage, et un
    détail infime sous la pluie ordinaire (soleil caché derrière les nuages).
- v633.174 (8 octobre 2026), **arbres moins présents** (« trop présents, trop gros, ce qui rend la visualisation plus
  difficile sur des projets de un ou deux étages; les arbres foncent tout le temps dans la caméra », puis « moins larges, un
  peu plus écrasés »).
  - Forme des feuillus (`crownY`, `treeShape`): rayon mesuré sans le gonflement de 15 %, surface vue du ciel ramenée à celle
    de la couronne mesurée (`AREA_K`) puis à 85 % (`CROWN_NARROW`, le partage des eaux réunit souvent deux ou trois
    couronnes); couronne moins profonde: environ 38 % de la hauteur dans un peuplement de la carte écoforestière, 45 % pour
    un arbre isolé, jamais plus écrasée qu'aux 3/4 (échelle verticale au moins 0,75 fois l'horizontale, au plus 1,8 fois;
    la règle « jamais en galette », 0,8 avant, est assouplie à la demande de Stéphane); bas jamais sous 2,5 m (35 % de la hauteur d'un petit arbre). Arbre médian de Stoneham (18,7 m): couronne
    d'environ 9 × 7 m, du haut du tronc à 11,6 m, au lieu de 11 × 11 m dès 7,6 m. Conifères plus étroits (rayon d'environ un
    septième de la hauteur). Troncs plus fins (21 cm de rayon au pied pour 18,7 m).
  - Couronnes vues d'un seul côté (`crownMat` en `FrontSide`, `shadowSide` en `DoubleSide`): par les trous, on voit le ciel
    et non l'intérieur sombre des lobes; l'ombre garde la même densité. La doublure d'ombre des feuillus proches n'est plus
    dessinée dans la passe principale (`count = 0` le temps de cette passe).
  - Effacement près de l'objectif (`nearFade`): feuillage effacé par ses propres trous de 10 m à 3 m de la caméra (rang de
    chaque pixel de feuille dans le canal rouge du masque; three ne lit que le vert pour la transparence et l'ombre), troncs
    de 4 m à 1 m en trame. La carte d'ombre ne voit pas ce retrait: les ombres sur la façade et au sol restent. Le flare et le
    disque du soleil perdent les trois quarts de leur force quand un arbre ainsi effacé est entre l'objectif et le soleil
    (`treeSun`). Pas d'effacement automatique des arbres entre la caméra et la maison (à proposer en option si besoin).
  - Point de vue de départ cohérent: distance de l'oeil à l'enveloppe des couronnes (la même que l'effacement), six visées
    (centre, haut du toit dessiné, quatre coins au pied), tronc devant la façade pénalisé; la caméra monte au-dessus des
    cimes quand trois couronnes ou plus coupent la ligne du centre (comme avant); arbres loin de toutes les visées écartés
    d'emblée (même résultat, environ 4 fois plus rapide). Flare inchangé quand le calque SOL SAT cache les arbres.
  - Sous-bois: la nappe est montée à 72 % de la hauteur des cimes, dans le tiers bas des couronnes de peuplement, et la
    lisière va du bas des couronnes à la nappe. La nappe ne se dessine que vue nettement de son dessus (plus de 7 à 13° de sa
    surface, la caméra 2 à 6 m au-dessus d'elle plus 15 % de la distance, pentes de moins de 53°, effacée de près): en vue de
    drone, elle comble les trous entre les couronnes; à hauteur d'oeil ou à 6 m, elle faisait des planches sombres en l'air
    (déjà visibles en v633.173 à 6 m de haut).
  - Mesuré sur un tour complet à 36 m de la maison de test de Stoneham (18 angles): à hauteur d'oeil, arbres de 58 % à 43 %
    du cadre (pire angle de 74 % à 58 %), ciel de 4 % à 11 %; à 6 m de haut, arbres de 80 % à 56 % (pire angle de 99 % à
    74 %). Temps de rendu inchangé.
- v633.177 (9 octobre 2026), **pastille MÉTÉO / SOLEIL** (« pouvoir désactiver l'effet météo sur le 3D, comme quand on
  avance la date de plusieurs jours »): sous SOL SAT dans la colonne de gauche (tracé Lucide sun). SOLEIL coupe la prévision:
  `sceneWeatherRow` devient nul (exactement le cas au-delà de 36 h), donc journée ensoleillée, pas d'icône météo près du
  curseur, légende « Ciel dégagé : soleil franc, ombres nettes »; MÉTÉO remet la prévision de l'heure. Choix gardé pour la
  session (`sessionStorage` `scene3d-sunny`), état dans ProjectDetail (`sceneSunny`), pastille dans Scene3D (`sunny`,
  `onToggleSunny`).
- v633.178 (9 octobre 2026), **empreintes réelles des bâtiments et entrées en gravier** (« les autres bâtiments autour ne sont
  pas très proches de la réalité, pas bien orientés, pas la bonne forme ou carrément inexistants; les entrées ne sont pas
  présentes non plus », avec le calque SOL SAT; « entrée en gravier, pas en terre »). Environs **version 7** (`SCENE_V = 7`,
  les entrées v6 du cache sont recalculées à la prochaine ouverture).
  - **Cause:** hors des villes, les empreintes d'Overture sont des tracés automatiques Microsoft (« Microsoft ML Buildings »,
    618 sur 663 même à Limoilou): des carrés de 4 sommets, taille et orientation approximatives, ailes et annexes perdues,
    beaucoup de bâtiments absents (la maison de Stéphane à Stoneham n'y était pas). L'analyse de l'imagerie ne cherchait
    que l'asphalte et le béton, et son ouverture de 3 m effaçait toute bande de moins de 6 m: aucune entrée.
  - **Empreintes LiDAR** (`api/footprints.js`, même fenêtre de hauteur de canopée que les arbres, lue une fois par
    `readCanopy` dans `api/trees.js`): pans plans (plan 3 × 3 à moins de 0,3 m, pente continue), plaques fermées d'un
    pixel et trous comblés, puis un toit = plaque de 16 m² et plus, aux côtés droits (rectangle englobant rempli aux 3/5),
    à chute nette en bordure (sol ou toit plus bas de 2 m dans les 3 m) et à surface fine (plan à 0,15 m sur plus du
    tiers); pour un toit absent d'Overture, 14 m au plus et un entourage qui tranche (du sol dans l'anneau de 6 à 14 m,
    ou des arbres bien plus hauts). Contour mis au net (`ring.js`, lissage à 2 m, Douglas-Peucker 0,8 m, directions
    dominantes), ramené au rectangle quand il le remplit à 87 %. Un toit reconnu dans une empreinte Overture la remplace
    (sauf un tracé OpenStreetMap, fait à la main, jamais remplacé: Overture donne la source; et sauf un coin de toit de
    moins de 40 % de l'empreinte); un toit hors de toute empreinte devient un bâtiment (remise sous 45 m²); une empreinte
    sans toit reconnu (sous les arbres, bâti après le relevé) est gardée. Hauteur par `pickHeight`; champs `bld[i][4] = 1`
    (mesuré) et `bld[i][5] = 1` (empreinte LiDAR), `lidarFp` en compte. `lidarHeights` ne relit pas ces bâtiments.
    Stoneham (relevé 2024, 1 m, 0,7 s): 50 empreintes remplacées, 50 bâtiments ajoutés, aucune cime acceptée; Limoilou:
    172 remplacées, 53 ajoutées, 45 tracés OpenStreetMap intacts. Piste écartée: le filtre de planéité par pan (un toit à
    deux versants ou en arc le ratait) et le score de dôme (un toit en arc est un dôme): remplacés par la chute en
    bordure, la finesse de surface et l'entourage.
  - **Calage de l'imagerie** (`api/paved.js`): l'imagerie Esri est décalée de quelques mètres par rapport au LiDAR et à
    Overture (Stoneham: 5 m est, 8 m nord; Limoilou: 10 m est); mesuré en superposant les pixels sombres (clarté sous le
    25e centile, les toits) aux empreintes sur une grille au mètre (±12 m), gardé s'il fait 1,5 fois mieux que sans
    décalage; appliqué aux polygones tirés de l'image (pavé et gravier), `imgShift` dans la scène. Une partie de l'écart
    que Stéphane voyait avec SOL SAT (Plans d'Apple) est un décalage d'imagerie du même ordre, non corrigé pour l'image
    drapée.
  - **Entrées en gravier** (`gravel`, même forme que `paved`): dans l'image, le gravier est ce qu'il y a de plus clair et
    de moins saturé; seuils relatifs à l'image (saturation sous son 15e centile, clarté au-dessus de son 70e), parce que
    la dominante varie (à Stoneham, prise sans feuilles, même l'asphalte est « vert »). Demi-résolution, moins bâtiments
    (1 m) et rues (largeur + 1 m), fermeture 1,2 m, ouverture 1 m; une composante de 12 à 1500 m² n'est une entrée que si
    elle touche une rue (à 2,5 m) et un bâtiment (à 3 m). Hors ville seulement (sol bâti sous 10 % dans 300 m et 15e
    centile de saturation à 0,2 au moins: en ville, trottoirs, toits clairs et stationnements passeraient pour du
    gravier; Limoilou: 14 % bâti, saturation 16 sur 255, rien). Stoneham: 37 entrées et cours. Rendu `flatMats.gravel`
    (#7a756b, gris chaud entre l'asphalte et le trottoir), contours mis au net (`regularizeRing(o, 1, 15)`), un cran sous
    le pavé; mouillé: assombri, peu de flaques. Légende: « Entrées en gravier d'après l'imagerie satellite (Esri),
    approximatives » et « formes et hauteurs des bâtiments LiDAR ».
  - **Limites:** relevé LiDAR daté (un bâtiment plus récent garde son carré d'Overture ou manque); toit sous les arbres
    gardé en carré; contour au mètre; gravier clair seulement (une entrée en terre ou en asphalte sombre n'est pas une
    entrée en gravier); une cour de gravier qui touche la rue et une remise passe pour une entrée; imagerie Esri datée
    autrement que le LiDAR.
- **v633.179 (9 octobre 2026): toits en pente, empreintes d'équerre, entrées en bandes, SOL SAT recalé.** Demandes de
  Stéphane: « beaucoup de maisons un peu rondes », « les entrées ne sont pas très précises », l'image Plans d'Apple décalée
  d'un bâtiment en biseau, « il faut que ça ne soit pas juste calibré pour Stoneham », puis « si tu peux simuler les
  pentes des toits ça serait encore mieux ». Banc de dix lieux (Stoneham, Limoilou, Sillery, Valcartier, Outremont,
  Ottawa, Toronto, Sainte-Adèle, Gaspé, Calgary): scène complète de chacun, image de contrôle sur l'imagerie Esri
  recalée (empreintes, toits, gravier), rien n'est réglé sur un seul lieu.
  - **Mise d'équerre des empreintes** (`orthogonalizeRing`, `src/scene3d/ring.js`, appelée par `api/footprints.js`): le
    contour tracé sur la grille LiDAR fait des escaliers et des coins coupés que la mise au net prenait pour des côtés
    (octogones, pentagones). L'axe est la direction (modulo 90°) qui porte le plus de longueur de côtés (le rectangle
    englobant minimal s'alignait parfois sur la diagonale d'un coin coupé); les côtés sont ramenés à cet axe et à sa
    perpendiculaire, un coin rogné (biais de moins de 6 m) devient un coin droit, un décalage entre deux côtés
    parallèles devient une marche, les côtés de moins de 1 m sont retirés; seul un pan coupé de 6 m et plus à plus de
    35° des axes reste en biais (en dessous de 35°, c'est l'escalier d'une rangée de maisons décalées). Rectangle si
    rempli à 86 %. Renonce (mise au net ordinaire gardée) si moins de 4 sommets ou aire à plus de 30 % du contour.
    Stoneham: 54 rectangles sur 101 empreintes (15 avant), 4 pentagones (31 heptagones avant); Limoilou 174 sur 289;
    Sainte-Adèle 109 sur 204.
  - **Pentes des toits** (`api/roofs.js`, géométrie partagée `src/scene3d/roof.js`, 7e champ `bld[i][6]`, environs
    version 8): la surface LiDAR (altitude, `dsm` et `dtm` ajoutés à la fenêtre de `readCanopy`) lue dans chaque
    empreinte (pixels à 0,7 m au moins du bord) est ajustée aile par aile. Une aile est un rectangle maximal de
    l'empreinte dans son repère; le toit d'une aile a un faîte parallèle à l'un des côtés, deux versants (faîte à 0, 20,
    30, 40, 50, 60, 70, 80 ou 100 % de la largeur; 0 ou 100 = un seul versant), des bouts en pignon ou en croupe, au
    besoin un sommet plat (70 % de la montée). Chaque variante est une régression linéaire (égout, montée) sur une forme
    normalisée, pixels à plus de 1 m écartés (cheminées, lucarnes, branches) et modèle refait; pénalités de complexité
    (sommet plat 0,06, faîte décentré 0,03, un seul versant 0,02, bouts mixtes 0,02, croupes 0,01, faîte le long du
    petit côté 0,04) pour que le modèle simple l'emporte; le toit plat (médiane) ne cède que si le toit en pente
    explique 10 points de plus des pixels à 0,5 m près (erreur réduite d'un dixième) ou réduit l'erreur de 40 %; montée
    d'au moins 1 m, égout à 2 m au moins du sol moyen, pentes de 4,5° à 70°. Ailes retenues par couverture (au plus
    quatre); une aile secondaire qui croise le faîte d'une aile plus haute s'arrête à ce faîte (bout caché). Hauteurs
    rapportées au sol moyen de l'empreinte (sol nu aux sommets et au centre), le repère de `groundOf` dans le moteur.
    Le moteur monte les murs à l'égout (`roof.he`), garde le plat à l'égout, pose les faces (versants dans la couleur du
    toit, pignons dans celle des murs, bandeau d'égout d'une aile plus haute dessiné comme un mur avec ses fenêtres s'il
    fait 2,4 m et plus); un côté en biais de l'empreinte (pan coupé) rogne les faces de l'aile dont il coupe le coin.
    Le dégagement des arbres (`prisms`) et la visée du sujet utilisent le faîte (`hTop`, `roofTop`). Empreintes de plus
    de 12 sommets ou de plus de 40 rectangles: toit plat (immeubles complexes). Stoneham: 93 toits en pente sur 122 (43 à
    deux versants, 9 à croupes, 21 à un versant, 20 mixtes, 10 à sommet plat), la maison du projet en appentis à 7°
    comme le relevé le montre; Limoilou 197, Sillery 179, Toronto 484, Gaspé 93; 65 à 100 ms. Pièges: à 1 m, le faîte
    est arrondi, un sommet plat ajustait mieux presque partout (d'où la pénalité); un terrain en pente (2,6 m sous une
    maison à Stoneham) fausse les pentes si on lit la hauteur de canopée au lieu de l'altitude; la croupe a la pente du
    côté le plus raide. Légende: « formes, toits et hauteurs des bâtiments LiDAR ».
  - **Entrées en bandes** (`driveBands`, `api/paved.js`): la tache de gravier est redessinée comme une bande de largeur
    constante (médiane de la largeur mesurée en travers, 2,5 à 7 m) le long du plus court chemin dans la tache depuis la
    rue jusqu'au pixel le plus éloigné qui touche un bâtiment (segments droits, prolongée de 3 m côté bâtiment et de
    1 m côté rue), plus le rectangle de ce qui déborde (stationnement, 25 m² et plus, rempli à 45 % au moins, hors des
    bâtiments). Stoneham: 44 entrées.
  - **SOL SAT recalé** (`satShift`, `src/scene3d/satDrape.js`): même méthode que le calage de l'imagerie Esri côté
    serveur, côté client: pixels sombres de l'image Plans d'Apple (clarté sous son 25e centile) contre les empreintes
    sur une grille au mètre, ±12 m, gardé s'il fait 1,5 fois mieux que sans décalage et couvre 50 pixels; l'image drapée
    recule d'autant, une fois par image. En ville (toits clairs), rien ne change. Stoneham: l'image Plans d'Apple
    était 10 m trop au nord (recul de 2 m est et 10 m sud; vérifié hors ligne sur la même image: 950 pixels sombres
    sous les empreintes contre 340 sans décalage, les empreintes LiDAR tombent sur les toits). Test local: l'API
    `meteoshoot-api` n'a pas les identifiants Plans d'Apple; lancer `scripts/scene3d-dev.mjs` avec les variables
    `APPLE_MAPS_TEAM_ID`, `APPLE_MAPS_KEY_ID` et `APPLE_MAPS_PRIVATE_KEY_PATH` (le sandbox des aperçus refuse de lire
    le dossier des clés), et l'appel doit porter une origine localhost (`origine non autorisée` sinon).
- **v633.180 (9 octobre 2026): chargement en traits fins, bouquets d'arbres plus pris pour des bâtiments.**
  - **Chargement** (`WireLines`, `Scene3D.jsx`): à la place de l'anneau, un réseau de traits blancs fins qui se tracent
    par-dessus la scène en construction (demande de Stéphane: « comme quand un mandat est confirmé dans BudgetShoot »):
    26 points dispersés dans un cadre 1100 × 800 (recadré en `slice`), un trait entre deux points à moins de 360, au
    plus 70 traits, chacun avec son épaisseur (0,4 à 1,2), son opacité (0,18 à 0,5), son délai (0,02 s par trait) et sa
    durée (0,4 à 0,8 s), tracé par `stroke-dashoffset` (`scene3dWireDraw`), ombre légère pour rester lisible sur le
    ciel. Un nouveau réseau toutes les 3 s tant que `status.busy` (deux couches à la fois, l'ancienne s'efface par
    `scene3dWireOut` à 2,4 s). Le mot CHARGEMENT reste; les petits anneaux des pastilles aussi (`scene3dSpin`).
  - **Faux bâtiments** (`api/footprints.js`, environs version 9): trois « bâtiments » de 11 à 14 m à Stoneham (et 30 à
    Limoilou, tous des arbres de rue) étaient des bouquets d'arbres isolés sur une pelouse: ils passent la chute en
    bordure, la finesse et le sol autour. Règle: un toit absent d'Overture ne dépasse pas 3 m plus la racine de sa
    surface (64 m²: 11 m), sauf toit net et plat d'au moins 100 m² (surface fine sur la moitié des pixels et dôme à
    0,2 au plus: un immeuble étroit de 13 m à toit plat reste accepté). Mesuré: Stoneham 50 → 45 ajoutés (les 4
    bouquets et une plaque de 27 m² à 7 m), Limoilou 65 → 35 (30 arbres de rue, vérifiés sur l'imagerie), Outremont,
    Toronto, Ottawa, Sillery: arbres de rue retirés. Piège rencontré: un `git checkout` du fichier pour retirer une
    sonde de débogage a aussi effacé la règle non commise; relire les comptes avant de commettre.
- **v633.181 (9 octobre 2026): la scène pousse, courbes de niveau pendant l'attente.** Stéphane sur les traits fins:
  « boff, donne l'impression d'une vitre cassée; une suggestion de loading au look plus organique qui n'est pas juste une
  loop? », puis « a et b ».
  - **La scène pousse** (`growU`, `growVertex`, `treeGrowStep`, `startGrow` dans `engine.js`): à la reconstruction qui
    suit l'arrivée des environs (`setData`, `growNext`), 2,5 s: les murs et les toits montent du sol (sommet rapporté à
    la base du bâtiment, attribut `aGrow` = [départ, base], départ 0,15 s + 0,9 s selon la distance au sujet sur 400 m,
    durée 0,7 s, `smoothstep`), avec leurs ombres (`growDepthMat`, un `MeshDepthMaterial` à la même transformation, en
    `customDepthMaterial` des murs et des toits); les arbres grandissent depuis leur pied par leurs matrices d'instance
    (matrices finales gardées dans `userData.grow`, bloc 3 × 3 et translation ramenés vers le pied, troncs 0,15 s avant
    les couronnes, départ 0,35 s + distance + 0,25 s de hasard, durée 0,8 s, échelle jamais sous 0,01); les surfaces et
    les rues drapées se tracent du sujet vers l'extérieur (attribut `aDist` posé dans `drapedMesh`, `discard` au-delà de
    `uReveal`, 650 m atteints en 1,1 s). Le relief, l'eau, le sous-bois et les lampadaires ne bougent pas. Une
    reconstruction pendant la pousse (relief arrivé après les environs) la relance; une reconstruction du modèle seul
    (`modelOnly`) ne la déclenche pas. Vu dans Chrome sans fenêtre (captures `caps/pousse_*.png`).
  - **Courbes de niveau** (`ContourLines`, `Scene3D.jsx`): un champ de bruit lissé à trois octaves qui dérive lentement;
    ses isolignes (8 niveaux, marching squares sur 56 × 40 cellules, segments chaînés en polylignes) sont redessinées
    30 fois par seconde dans un SVG par-dessus la scène: des courbes comme sur une carte topographique, jamais les mêmes.
    À l'ouverture elles se tracent une à une (`stroke-dashoffset`, niveaux décalés de 0,22 s), puis glissent; elles
    s'effacent en 0,7 s quand la scène apparaît. Montées après 0,5 s d'attente seulement (un chargement en cache ne les
    montre pas, ou à peine). Les traits fins de la v633.180 sont retirés.
- **v633.182 (9 octobre 2026): retours de Stéphane sur la v633.181.** « Loading des courbes de niveau on enlève »,
  « enlève le genre de drap vert, pas très utile ni très beau », régressions SOL SAT, « ombre terrain possible » et
  « on a perdu le sapin entre nos deux maisons ».
  - **Courbes de niveau retirées**, l'anneau d'attente d'avant revient (le mot CHARGEMENT reste); la pousse de la scène
    (v633.181) reste.
  - **Nappe du sous-bois et lisière retirées** (`canopyFill` supprimé; les peuplements de la carte écoforestière servent
    encore à la forme des couronnes). `fillMat` et `edgeMat` restent déclarés (listes des matériaux), sans maillage.
  - **SOL SAT:** le calage (`satShift`) se refait quand les environs changent (`sat.shiftFor`): allumé avant leur
    arrivée, il valait zéro et restait en mémoire sur l'image mise en cache (depuis la v633.179). Vérifié: image allumée
    pendant le chargement, calage 2 m est et 10 m sud une fois les environs arrivés.
  - **Sapins près des maisons:** le dégagement des arbres (`prisms`, clearance.js) reprend la hauteur des murs (`b.h`),
    pas le faîte (`hTop`, v633.179): avec le faîte, un sapin collé à une maison ne trouvait plus de place et disparaissait.
    Les couronnes peuvent de nouveau frôler un toit en pente.
  - **Ombre du terrain (barre rouge de la bande horaire):** pas une régression de la 3D. Le profil d'horizon de la
    fiche venait d'open-elevation (`src/weather/elevation.js`, 36 directions, échantillons dès 15 m sur un relevé de
    30 m), mis en cache le 1er mars 2026: à Stoneham il donne 29 à 35° vers l'est, contre 14 à 20° au relief LiDAR (à
    250 à 340 m); en octobre, le soleil passe sous 35° jusqu'à midi, d'où le rouge jusqu'à 12 h 34 alors que la 3D (relief
    LiDAR) montre la maison au soleil. Désormais, quand la 3D a chargé son relief, `engine.horizonProfile()` (36
    directions, 10 m à 5 km, vu de 1,6 m au-dessus du sol; mesuré: 14 à 20° vers l'est à Stoneham) remonte par
    `onHorizon` à la fiche, qui s'en sert à la place du profil d'open-elevation (`lidarHorizonRef`). Le cache Supabase
    n'est pas réécrit (le client n'a pas le droit d'écraser une entrée): sans la 3D ouverte, l'ancien profil reste.
- **v633.183 (9 octobre 2026): calage de l'image Plans d'Apple fait par le serveur.** Stéphane, SOL SAT allumé:
  « l'image au sol est ultra décalée, c'est toutes les maisons » (gros plans: chaque bloc à une maison de son toit),
  alors que le même build de production en local plaçait les blocs sur leurs toits et que la scène servie par
  www.meteoshoot.com est identique à la scène locale (96 empreintes LiDAR, même `imgShift`). Le calage dans le
  navigateur (`satShift`, canvas et ImageBitmap) ne s'appliquait donc pas chez lui, sans cause trouvée (navigateur,
  ordre des chargements). Désormais `api/satshift.js` (`appleShift`) refait la même mesure côté serveur, avec la clé
  Apple de Vercel (`snapshotRequest` exporté par `api/apple-snapshot.js`): même image que celle du navigateur (même
  centre, même zoom 18), ramenée au mètre (rangée 0 au sud), pixels sombres contre empreintes, ±12 m, gardé à 1,5 fois
  mieux et 50 pixels; résultat `appleShift` dans la scène (environs version 10), appliqué tel quel par `placeSat`
  (le calage du navigateur ne sert plus que sans valeur serveur: développement local sans clé). Stoneham: 2 m est,
  10 m sud (823 contre 331). La légende dit maintenant « Image satellite © Plans d'Apple (recalée de 2 m est et 10 m
  sud) » ou « (non recalée) »: on voit ce qui s'applique. Vérifié dans le build de production local avec la clé:
  légende « recalée de 2 m est et 10 m sud », blocs sur leurs toits.
- **v633.184 (9 octobre 2026): calage de l'image Plans d'Apple par contraste.** Stéphane, légende à l'appui:
  « recalée de 8 m est et 12 m nord », « rues, maisons, tout est décalé ». Son projet est à 47.01031, -71.37338 (trouvé
  dans `scene3d_cache`), 30 m du centre de test; là, le compte de pixels sombres sous les empreintes a deux pics à 1 %
  l'un de l'autre: le vrai (2 m est, 10 m sud) et un faux en bord de fenêtre (8 m est, 12 m nord: les empreintes
  tombent sur des ombres et des stationnements), qui gagnait de peu. Nouveau critère (`contrastShift`,
  `api/satshift.js`; même chose côté client dans `satDrape.js` pour le secours sans clé): part de pixels sombres
  dedans moins celle de l'anneau de 2 à 4 m autour (un toit est sombre et son pourtour clair, une ombre est sombre
  partout), recherche à ±16 m, accepté si le contraste atteint 0,08, fait 1,3 fois le 2e pic (à 4 m et plus) et n'est
  pas en bord de fenêtre. Mesuré: Stoneham (les deux centres) 2 m est 10 m sud (0,126 contre 0,07 à 0,09), Limoilou
  3 m est 12 m sud, Gaspé 4 m est 12 m sud, les sept autres lieux « pas assez net »: pas de recalage (prudent).
  Environs version 11 (la scène de Stéphane gardait le mauvais calage en cache).
- **v633.185 (9 octobre 2026): Option + glisser déplace la caméra.** Demande de Stéphane (« me déplacer en cliquant
  sur option »). Le glisser ordinaire tourne et monte comme avant; avec la touche Option enfoncée, le point visé (`ct`,
  `engine.js`, `panView`) glisse au sol dans le sens du geste (le décor suit le pointeur) et la caméra suit, à l'échelle
  de la distance de visée (distance divisée par la focale en pixels, comme le glisser de la maison). La hauteur de
  visée reste la même au-dessus du sol (on suit la pente), 80 pixels au plus par événement (pas de saut), et le point
  visé ne s'éloigne pas à plus de 500 m du projet (limite des environs chargés: bâtiments 450 m, rues 500 m). La touche
  peut être prise ou lâchée en plein geste; curseur « move » dès qu'elle est enfoncée (écouteurs keydown et keyup
  sur la fenêtre), « grab » et « grabbing » sinon. Option prime sur la maison importée: avec la touche, on déplace
  la vue même en saisissant la maison (cadenas ouvert). `setView` accepte `ct` pour les tests. Vérifié en local
  par des événements de pointeur synthétiques: 200 px vers la droite = 48 m vers la gauche de la caméra, azimut,
  hauteur et distance inchangés; rotation et pincement intacts.
- Idée notée par Stéphane (5 octobre 2026): les saisons (feuillage l'hiver, neige au sol et sur les toits,
  idéalement d'après la hauteur de neige d'Open-Meteo).
- iPhone et iPad: la 3D fonctionne dans la vue web; le survol n'existe pas au doigt (à valider).
