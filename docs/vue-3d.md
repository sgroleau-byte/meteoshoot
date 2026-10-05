# Vue 3D de la fiche projet (bascule SAT / 3D / MAP)

Ajoutée le 5 octobre 2026. Dans la fenêtre de la carte, le bouton 3D remplace la carte par une scène 3D
du projet: les bâtiments dessinés (contour et hauteur), les bâtiments voisins avec leur hauteur, les rues,
les trottoirs, les arbres, les parcs et l'eau, sous le ciel et la lumière de l'instant du curseur. Le
curseur du haut (date et heure) et la météo horaire pilotent la scène; survoler une heure de la météo
horaire déplace le curseur (date comprise), donc les ombres de la carte et la 3D suivent.

## Fichiers

- `src/scene3d/engine.js`: moteur (three.js, chargé à la demande par import dynamique). Ciel procédural
  (nuages bas en cumulus, moyens en couche, hauts en voile, soleil visible selon le soleil direct), capturé
  en carte d'environnement pour éclairer la scène; soleil (SunCalc) avec ombres douces (VSM); ombres de
  nuages qui passent; passes d'image: occlusion ambiante (recoins), tonalité ACES, lissage FXAA.
  Bâtiments en un seul tracé (murs avec fenêtres par étage, toits plats); arbres instanciés à lobes avec
  masque de feuillage (le soleil passe entre les feuilles: ombre parsemée). Point de vue choisi à hauteur
  d'oeil du côté du créneau (AM ou PM), dans l'espace libre, vue dégagée sur le bâtiment principal.
- `src/scene3d/Scene3D.jsx`: composant React (légende, boussole, états de chargement).
- `src/scene3d/data.js`: environs d'un lieu: cache partagé Supabase `scene3d_cache`, sinon fonction
  serveur `/api/scene3d`, puis insertion dans le cache (comptes connectés).
- `api/scene3d.js`: fonction Vercel (Node, paquet `duckdb`). Lit Overture Maps (données ouvertes:
  empreintes Microsoft et OpenStreetMap, hauteurs estimées) directement dans les fichiers Parquet publiés sur
  S3, cinq requêtes en parallèle (bâtiments, rues, terrain, usage du sol, eau), découpées par un cadre
  autour du lieu, converties en mètres. Environ 80 Ko, 12 secondes avec l'index, 2 minutes sans.
- `api/overture-index.json`: cadre géographique de chaque fichier Parquet d'Overture, par type. Sans lui la
  fonction devait lire l'en-tête de centaines de fichiers. À régénérer quand on change de version
  d'Overture (constante `RELEASE` dans `api/scene3d.js`): `python3 scripts/overture-index.py 2026-09-23.1`
  (une minute; demande `pip install pyarrow`).
- `scripts/scene3d-dev.mjs`: la fonction en local, port 3999 (`npm run api`); le proxy Vite envoie `/api`
  dessus. En production, Vercel sert `api/scene3d.js` (dossier `api/` détecté automatiquement).
- `supabase/migrations/20261005120000_cache_scene_3d.sql`: table `scene3d_cache` (clé = latitude et
  longitude à 5 décimales, lecture pour tous, insertion pour les comptes connectés, validation 600 Ko).
- `src/weather/api.js`: l'horaire porte maintenant `cloudMid` et `cloudHigh` (nuages moyens et hauts).
- `api/scene3d-style.js` et `src/scene3d/style.js`: bouton « Analyser les images » dans la vue 3D. Les images du
  projet (fichiers) sont réduites puis envoyées à Claude (modèle claude-opus-5-5, réponse structurée), qui en tire
  couleur des murs, du soubassement, du toit, accent, matériau, rythme des fenêtres, étages et hauteur estimée.
  Résultat gardé dans le projet (`style3d`, migration `20261005150000_style_3d_projet.sql`) et appliqué aux formes
  dessinées (couleurs, bandeau de soubassement, rangées de fenêtres; hauteur si les formes sont restées à 30 m).
  Demande la variable `ANTHROPIC_API_KEY` sur Vercel (réglages du projet, puis redéploiement); sans elle, le bouton
  affiche « clé API Claude absente ». Quelques cents par analyse.
- Les fichiers Overture sont lus en HTTPS direct (pas en s3://): sur Vercel, les identifiants AWS ambiants de la
  fonction et sa région us-east-1 faussaient les requêtes vers ce seau public d'us-west-2 (erreur 301).

## Règles de rendu (validées avec Stéphane)

- Le ciel occupe plus de la moitié du cadre: c'est lui qui montre le rapport entre nuages et soleil direct.
- Nuages figés (pas d'animation) pour une heure donnée.
- Pas d'effet de style non demandé (grain, vignettage).
- Les arbres devant une façade donnent une lumière en taches, pas un bloc d'ombre.
- Hauteur d'une forme laissée à 30 m (défaut jamais réglé): la scène prend la hauteur mesurée du même
  édifice dans Overture, si elle existe.

## Déploiement (à vérifier au premier push)

- Le paquet `duckdb` pèse environ 70 Mo (binaire natif); la fonction reste sous la limite de 250 Mo de Vercel.
  Les extensions DuckDB (httpfs) se téléchargent dans `/tmp` au premier appel.
- `maxDuration = 60` dans la fonction; vérifier la version de Node du projet Vercel (22 recommandé).
- iPhone et iPad: la 3D fonctionne dans la vue web; le survol n'existe pas au doigt (à valider).
- Idée notée: tirer des images du client (fichiers du projet) la couleur et le rythme des fenêtres du
  bâtiment, sans aller dans le détail.
