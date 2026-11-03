# Banc des bâtiments voisins (vue 3D)

Outils du 3 novembre 2026 (v633.261) pour juger les empreintes et les ajouts LiDAR d'un lieu.

- `sh tools/batiments/banc.sh <dossier>`: scène de chacun des lieux de `lieux.txt` par `node api/scene3d.js --test`, deux à la fois; journal par lieu (sources des contours, part OpenStreetMap, ajouts LiDAR gardés ou retenus).
- `python3 -I tools/batiments/analyse.py scene.json`: liste des bâtiments à moins de 220 m (surface, hauteur, mesuré, empreinte LiDAR); les ajouts LiDAR sont les dernières entrées de `bld` (autant que le journal en compte).
- `python3 -I tools/batiments/overlay.py scene.json esri.jpg overlay.svg`: contours posés sur une image satellite Esri de 640 m de côté (export ArcGIS World_Imagery, bbox en 4326, image en 3857, 1280 px), blanc = Overture, bleu = empreinte LiDAR, rouge = ajout LiDAR (le script suppose 36 ajouts: adapter `nOv`).
- `python3 -I tools/batiments/zoom.py overlay.svg x y largeur sortie.svg`: zoom sur une région (en pixels du cadre de 1280).
- Rendu PNG sans PIL: `qlmanage -t -s 1280 -o dossier fichier.svg`.
