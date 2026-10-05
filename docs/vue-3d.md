# Vue 3D de la fiche projet (bascule SAT / 3D / MAP)

Ajoutée le 5 octobre 2026. Dans la fenêtre de la carte, le bouton 3D remplace la carte par une scène 3D
du projet: les bâtiments dessinés (contour et hauteur), les bâtiments voisins avec leur hauteur, les rues,
les trottoirs, les arbres, les parcs et l'eau, sous le ciel et la lumière de l'instant du curseur. Le
curseur du haut (date et heure) pilote la scène et les ombres de la carte; la météo horaire la plus proche
de cet instant (nuages bas, moyens, hauts, soleil direct) fait le ciel. Le survol de la météo horaire ne
déplace plus le curseur (retiré le 5 octobre 2026 à la demande de Stéphane: la 3D basculait en nuit au
passage de la souris). À droite de la pastille du curseur, l'icône météo de l'heure avec les nuages et le
soleil direct en pour cent rappelle ce que la scène simule.

## Ce qui est sûr et ce qui est interprété

Règle posée avec Stéphane le 5 octobre 2026: la 3D ne doit jamais tromper.

- Ce qui est physique reste physique: position du soleil (astronomie), nuages bas, moyens et hauts et
  soleil direct (prévision horaire), ombres portées. L'analyse des images n'y touche jamais.
- Les volumes et façades tirés des images du client sont une interprétation: la légende dit toujours, pour
  le côté que l'on regarde, d'où vient la façade (« d'après les images du client », « probable », « pas vue
  dans les images, rythme générique ») et d'où vient la hauteur du volume (« lue sur les plans »,
  « estimée d'après les images », « réglée dans le projet », « mesurée (Overture) », « par défaut »).
- Le bouton « Sans le style » montre le modèle neutre (boîtes et couleurs par défaut).
- Une façade qu'aucune image ne montre reste générique; rien n'est inventé. Si les formes dessinées
  changent après l'analyse (signature des sommets), volumes et façades analysés sont ignorés jusqu'à la
  prochaine analyse et la légende le dit.

## Fichiers

- `src/scene3d/engine.js`: moteur (three.js, chargé à la demande par import dynamique). Ciel procédural
  (nuages bas en cumulus, moyens en couche, hauts en voile, soleil visible selon le soleil direct), capturé
  en carte d'environnement pour éclairer la scène; soleil (SunCalc) avec ombres douces (VSM); ombres de
  nuages qui passent; passes d'image: occlusion ambiante (recoins), tonalité ACES, lissage FXAA.
  Bâtiments en un seul tracé (murs avec fenêtres par étage, toits plats); arbres instanciés à lobes avec
  masque de feuillage (le soleil passe entre les feuilles: ombre parsemée). Point de vue choisi à hauteur
  d'oeil du côté du créneau (AM ou PM), dans l'espace libre, vue dégagée sur le bâtiment principal.
  Façades détaillées: une planche de textures par scène (couleur, rugosité, émission), un rectangle par mur
  à l'échelle (14 px par mètre, moins si la planche dépasse 2048 px), fenêtres (cadre, verre réfléchissant,
  meneaux), portes, vitrages quadrillés, garages, une fenêtre sur deux allumée la nuit. Les murs détaillés
  remplacent le mur générique du même côté (ensemble `skip` dans `blocks` et `band`).
- `src/scene3d/footprint.js`: empreintes dessinées en mètres, lettres des volumes (A = le plus grand au
  sol), numéros des côtés (Ak du sommet k au sommet k+1, contour antihoraire: vu de l'extérieur, le
  sommet k est à gauche), orientation de chaque côté, signature des formes. Partagé par le moteur et
  l'analyse pour que les deux parlent des mêmes murs.
- `src/scene3d/Scene3D.jsx`: composant React (légende avec façade et hauteur, boussole, boutons
  « Analyser les images » et « Sans le style », états de chargement). Garde-fou: une analyse par projet
  toutes les 10 minutes.
- `src/scene3d/data.js`: environs d'un lieu: cache partagé Supabase `scene3d_cache`, sinon fonction
  serveur `/api/scene3d?lat&lng&v=2`, puis insertion (ou remplacement d'une version périmée) dans le cache.
  Le `v` dans l'adresse évite de retomber sur une réponse gardée 24 h par le navigateur.
- `src/scene3d/style.js`: analyse des images. Réduit les images (8 au plus, 1200 px), dessine le croquis
  de l'empreinte (vue du ciel, nord en haut, volumes lettrés, côtés numérotés avec leur orientation, sommets
  marqués, voisins en gris, rues nommées, nord, échelle) et envoie le tout à `/api/scene3d-style`.
  `window.__scene3dStyle` (développement) expose `analyzeBlobs`, `footprintFor`, `drawSchematic`.
- `api/scene3d.js`: fonction Vercel (Node, paquet `duckdb`). Lit Overture Maps (données ouvertes:
  empreintes Microsoft et OpenStreetMap, hauteurs estimées) en HTTPS direct dans les fichiers Parquet
  publiés sur S3 (pas en s3://: sur Vercel, les identifiants AWS ambiants faussaient les requêtes), cinq
  requêtes en parallèle (bâtiments, rues avec leur nom, terrain, usage du sol, eau), découpées par un cadre
  autour du lieu, converties en mètres. Environ 80 Ko, 12 secondes avec l'index, 2 minutes sans. Version 2
  depuis le 5 octobre 2026 (noms de rues).
- `api/overture-index.json`: cadre géographique de chaque fichier Parquet d'Overture, par type. À régénérer
  quand on change de version d'Overture (constante `RELEASE`): `python3 scripts/overture-index.py
  2026-09-23.1` (une minute; demande `pip install pyarrow`).
- `api/scene3d-style.js`: fonction Vercel. Claude (modèle `claude-opus-5-5`, réflexion adaptative, réponse
  structurée par un schéma zod) reçoit le croquis puis les documents du client et renvoie: couleurs et
  matériau; orientation (documents reliés à l'empreinte, confiance, indices); un volume par lettre (rôle
  existant ou agrandissement, étages, hauteur avec sa source: cote lue ou estimation, couleurs propres);
  une façade par côté (images où elle se voit, confiance, ouvertures de gauche à droite en fraction de la
  longueur et en mètres du sol, type fenêtre, porte, vitrage ou garage, couleur des cadres). Le serveur
  nettoie les ouvertures (bornes, tailles minimales, 80 par côté au plus) et ajoute `shapes.sig`.
- `scripts/scene3d-dev.mjs`: les deux fonctions en local, port 3999 (`npm run api`). L'analyse répond 503
  en local sans `ANTHROPIC_API_KEY`: pour l'essayer, pointer le proxy Vite sur un déploiement d'aperçu
  (`MS_API_PROXY=https://...vercel.app` dans `.env.local`, ignoré par git).
- `supabase/migrations/20261005120000_cache_scene_3d.sql` (table `scene3d_cache`),
  `20261005150000_style_3d_projet.sql` (colonne `style3d` sur `projects` et `projects_dev`),
  `20261005200000_cache_scene_3d_mise_a_jour.sql` (mise à jour d'une entrée périmée par un compte connecté).
- `src/weather/api.js`: l'horaire porte `cloudMid` et `cloudHigh` (nuages moyens et hauts).
- `vercel.json`: durées maximales des fonctions (`api/scene3d.js` 90 s, `api/scene3d-style.js` 300 s).
  `.vercelignore` exclut les dossiers natifs et de compilation (sans lui, le client Vercel envoyait 15 000
  fichiers).

## Hauteur d'un volume dessiné (ordre de confiance)

1. Cote lue par Claude sur une élévation ou une coupe (`heightSource: cote`).
2. Estimation d'après les images (étages comptés sur les rendus).
3. Valeur réglée dans le projet (Stéphane ne connaît pas la vraie hauteur: valeur de secours seulement).
4. Hauteur mesurée Overture du même édifice (parfois fausse: 3 m pour une école de deux étages).
5. 9 m par défaut.

## Règles de rendu (validées avec Stéphane)

- Le ciel occupe plus de la moitié du cadre: c'est lui qui montre le rapport entre nuages et soleil direct.
- Nuages figés (pas d'animation) pour une heure donnée.
- Pas d'effet de style non demandé (grain, vignettage).
- Les arbres devant une façade donnent une lumière en taches, pas un bloc d'ombre.
- Heure bleue (20 à 50 minutes après le coucher): ciel bleu profond, façade côté couchant plus claire,
  lumière très diffuse sans ombre, quelques fenêtres allumées avec une lueur douce.
- Toutes les façades visibles dans les documents du client reçoivent leurs ouvertures; les autres restent
  génériques et la légende le dit.

## Coûts et garde-fous

- Analyse complète de l'école (croquis + 8 images, toutes les façades): environ 15 000 jetons en entrée et
  5 500 en sortie, soit environ 17 cents US avec Opus 5.5 (4 $ et 20 $ le million), 70 à 90 secondes.
- Clé `ANTHROPIC_API_KEY` dans Vercel (projet meteoshoot, Production et Preview, type Secret), créée le
  5 octobre 2026 dans la Console Anthropic (clé « Meteoshoot-3D », espace de travail par défaut). Jamais dans
  le dépôt ni dans une conversation.
- Plafonds à poser par Stéphane: limite de dépense mensuelle dans la Console Anthropic (Settings, Limits) et
  Spend Management dans l'équipe Vercel (Billing), avec mise en pause des projets au plafond.
- Dans l'app: une analyse par projet toutes les 10 minutes, 8 images, réponse plafonnée à 16 000 jetons,
  fonction coupée à 300 s; le résultat est gardé dans le projet.
- Vercel: Fluid compute activé le 5 octobre 2026 (sans lui, les fonctions étaient coupées à 15 s, la durée
  déclarée dans le code n'étant pas prise; l'attente de Claude n'est pas facturée comme du calcul).

## Banc d'essai (développement)

- Faux compte et projet École semés dans le localStorage (voir la mémoire « test local sans login »),
  images du client servies par un petit serveur avec CORS depuis le scratchpad, Vite avec `MS_API_PROXY`
  vers un déploiement d'aperçu (`npx vercel deploy --yes --archive=tgz`, projet lié par `npx vercel link`).
- Ouvrir une fiche depuis la console: `history.pushState({ projectId, view: 'todo' }, '', '#project/' + id)`
  puis `dispatchEvent(new PopStateEvent('popstate', { state: { projectId, view: 'todo' } }))` (le simple
  changement de hash ne suffit pas).
- L'onglet doit rester visible pour que le moteur dessine (requestAnimationFrame).
