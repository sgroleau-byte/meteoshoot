# Banc des bâtiments voisins (vue 3D)

Outils du 3 novembre 2026 (v633.261) pour juger les empreintes et les ajouts LiDAR d'un lieu.

- `sh tools/batiments/banc.sh <dossier>`: scène de chacun des lieux de `lieux.txt` par `node api/scene3d.js --test`, deux à la fois; journal par lieu (sources des contours, part OpenStreetMap, ajouts LiDAR gardés ou retenus).
- `python3 -I tools/batiments/analyse.py scene.json`: liste des bâtiments à moins de 220 m (surface, hauteur, mesuré, empreinte LiDAR); les ajouts LiDAR sont les dernières entrées de `bld` (autant que le journal en compte).
- `node api/scene3d.js --test lat lng --out f.json` écrit aussi `f.dbg.json`: `fp` = mesures de chaque toit hors empreinte (surface, hauteur, planéité `p15`, `dome`, `chute`, sol autour `gnd`, entourage `env`, `rect`) avec `why` (motif de la retenue: `osm`, `parc`, `cime`, `petite`, ou null si ajouté), `osm` = indices des tracés OpenStreetMap.
- `python3 -I tools/batiments/overlay.py scene.json esri.jpg overlay.svg [nombre d'ajouts]`: contours posés sur une image satellite Esri de 640 m de côté (export ArcGIS World_Imagery `export?bbox=...&bboxSR=4326&imageSR=3857&size=1280,1280&format=jpg&f=image`, cadre de ±320 m en degrés), blanc = Overture, bleu = empreinte LiDAR, rouge = ajout LiDAR.
- `python3 -I tools/batiments/planche.py scene.json esri.jpg nombre_d_ajouts planche.svg [côté m] [colonnes] [indices a,b,c ou -] [demi-côté de l'image m]`: planche de zooms, un par ajout (rouge), avec les autres ajouts en orange pointillé; l'image est embarquée une fois et chaque case est un `<svg>` à sa propre `viewBox`.
- `python3 -I tools/batiments/avant_apres.py avant.json nAvant apres.json nApres esri.jpg "titre" planche.svg`: les contours de deux scènes du même lieu côte à côte (planche avant / après d'une règle), rendu par `qlmanage -t -s 2580`.
- `python3 -I tools/batiments/zoom.py overlay.svg x y largeur sortie.svg`: zoom sur une région (en pixels du cadre de 1280).
- Rendu PNG sans PIL: `qlmanage -t -s 1280 -o dossier fichier.svg`.
