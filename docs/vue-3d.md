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

- `src/scene3d/engine.js`: moteur (three.js, chargé à la demande par import dynamique). Ciel procédural
  (nuages bas en cumulus, moyens en couche, hauts en voile, soleil visible selon le soleil direct), capturé
  en carte d'environnement pour éclairer la scène; soleil (SunCalc) avec ombres douces (VSM); ombres de
  nuages qui passent; passes d'image: occlusion ambiante (recoins), tonalité ACES, lissage FXAA.
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

## Pistes notées (non commencées)

- Lumière plus fine: ciel physique (Hosek-Wilkie), pénombre selon la couverture nuageuse, rebond du sol et
  des voisins; ou rendu affiné à la demande par lancer de rayons progressif (three-gpu-pathtracer) quand la
  caméra est immobile, bon sur Mac, lent sur iPhone. Stéphane y réfléchit (5 octobre 2026).
- iPhone et iPad: la 3D fonctionne dans la vue web; le survol n'existe pas au doigt (à valider).
