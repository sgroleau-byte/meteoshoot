# Entrées par le fossé LiDAR (v633.238, 24 octobre 2026)

Demande de Stéphane: « augmenter la précision des entrées, stationnement, chemin de gravier autour des bâtiments »,
puis « va avec la 1 » (croiser la couleur de l'image avec le relief LiDAR).

## Ce qui a changé

- **Points d'entrée lus dans le relief** (`api/driveways.js`, `ditchEntries`): hors des villes, un fossé longe la rue
  de chaque côté et s'interrompt à chaque entrée (ponceau). Le terrain LiDAR à 1 m est déroulé le long de chaque rue
  d'asphalte: pour chaque mètre et chaque côté, le creux du fossé entre le bord de la rue et 6 m au-delà; une médiane
  glissante sur 60 m dit s'il y a un fossé (0,2 m et plus); une entrée est une interruption de 2,5 à 20 m où le creux
  remonte à plus de la moitié. Deux interruptions à moins de 10 m sont fusionnées (apron large).
- **Bande droite jusqu'à la maison** (`api/paved.js`): du point d'entrée au point le plus proche du bâtiment choisi
  devant (dans 70 m, à moins de 60 degrés de la perpendiculaire, la maison plutôt que la remise, soutien de la tache
  de couleur le long du segment, sans traverser une rue ni un autre bâtiment); largeur 0,6 fois l'interruption, de
  3 à 7 m. Le reste de la tache de couleur touchée au bout devient le rectangle du stationnement, comme avant.
- **La couleur seule reste** là où le fossé ne dit rien (courbes, culs-de-sac, rues avec bordures): à moins de 20 m
  d'une entrée du fossé, les entrées tirées de la couleur sont abandonnées; ailleurs, inchangé.
- **Classe LiDAR par pixel** (`bareMask`): sol nu et lisse (hauteur sous 0,4 m, écart au plan local sous 0,12 m),
  volume bas ou terrain irrégulier (rejeté), canopée (3 m et plus: la couleur décide seule, comme avant). Sur le sol
  nu, la clarté exigée descend du 70e au 40e centile (ombres). Les petits volumes (voitures, bacs, haies de moins de
  25 m² et moins de 3 m) comptent comme du sol. Les plans d'eau sont retirés des candidats.
- **Image grise ou zone semi-urbaine**: la couleur n'est plus utilisée (comme avant), mais les entrées par le fossé
  restent (Gaspé, Sainte-Adèle, Saint-Ferréol en obtiennent, aucune avant).
- Version de scène 12 (`SCENE_V`): chaque lieu recalcule ses environs une fois à la prochaine ouverture.

## Banc (`_METEOSHOOT/verification_entrees_fosse/bench`)

`node run.mjs [lieu]` (avant/après, `ctrl_<lieu>.png`), `node zoom.mjs <lieu> dx dy demi-côté` (pleine résolution,
`MODE=before|after`), `node ditch.mjs <lieu>` (profil déroulé du fossé). Les appels réseau sont mis en cache sur disque.
Scènes de huit lieux ruraux dans `scenes/` (`build.sh` les refait par `node api/scene3d.js --test`).

| Lieu | Avant (couleur) | Après | dont fossé |
|---|---|---|---|
| Stoneham (maison de Stéphane) | 39 | 76 | 70 |
| Shannon | 52 | 66 | 41 |
| Sainte-Brigitte-de-Laval | 12 | 21 | 11 |
| Sainte-Adèle | 0 | 19 | 19 |
| Gaspé (sans imagerie Esri) | 0 | 32 | 32 |

Planche de contrôle: `planche_entrees_fosse_stoneham.png` (220 m autour de la maison). Temps serveur: environ
0,4 s de plus par scène.

## Limites connues

- Pas de fossé: bordures de béton, rues sans fossé, côté extérieur des courbes serrées et culs-de-sac: la couleur
  seule continue d'y décider.
- Une entrée sans bâtiment devant à 70 m (champ, lot vide, maison trop loin) est ignorée (une vingtaine à Stoneham).
- Le tracé est droit: une entrée courbe ou en L n'est rendue que par sa corde.
- Le calage de l'imagerie Esri bute parfois sur sa limite de 12 m (Valcartier): la couleur y est décalée, les
  entrées par le fossé ne le sont pas (elles ne lisent que le LiDAR).

## v633.239 et v633.240 (24 octobre 2026)

- **v633.239**, retour de Stéphane sur sa maison (« pas beaucoup mieux »): en 3D, le lissage à 15 m rognait les deux
  bouts de la bande (ni la rue ni la maison atteintes, coins en biseau); les polygones de 6 points au plus ne sont
  plus lissés. Largeur 0,45 fois l'interruption (3 à 6 m; mesuré 4 m pour 10 m d'interruption chez lui). La cible est
  échantillonnée le long du contour du bâtiment (distance, angle, soutien de la couleur), plus seulement le point le
  plus proche. En prod et TestFlight (build 633239).
- **v633.240, outil de stationnement** (« ajoute un outil de dessin de stationnement qui change la couleur du terrain
  en gris », « le plus simple »): dans le menu de la carte, à côté du crayon, un bouton (icône P de Lucide) dessine
  une forme de sorte `ground` dans `project.buildings` (même stockage que les bâtiments, pas de migration). Sur la
  carte: surface grise pleine, sans halo ni ombre, pastille « STAT. N » (gris, sans hauteur ni couleur de murs,
  sommets déplaçables quand elle est sélectionnée). En 3D (`engine.js`): drapée au sol avec le gris du gravier, sans
  volume, ignorée pour le cadrage et la pose du modèle; les arbres dedans sont retirés. Au plus 5 stationnements par
  projet, en plus des 5 bâtiments. `localRings` renvoie `kind`.
- **v633.241, formes dessinées recalées sur le LiDAR** (« pourquoi un si gros décalage? »): l'image satellite Google
  de la carte SAT est mal calée de quelques mètres en terrain accidenté (environ 7 m vers le nord-ouest chez Stéphane,
  vérifié en superposant empreintes LiDAR et axes OpenStreetMap sur les tuiles Google), alors que la 3D est en vraies
  coordonnées. `drawnShift` (`engine.js`): chaque forme de bâtiment dessinée est comparée à l'empreinte LiDAR la plus
  proche (centre à moins de 15 m, aire du simple au double); la moyenne des écarts de centre est retranchée à toutes
  les formes dessinées (bâtiments et stationnements), dans `rebuild` et dans le placement par défaut du modèle. Sans
  forme de bâtiment ou sans empreinte LiDAR correspondante, rien ne bouge. Trace console « formes dessinées recalées
  sur le LiDAR: X m est, Y m nord ». La maison importée n'est pas touchée (placée à la main sur l'image Apple recalée).
- **v633.242**: la légende 3D dit si les formes dessinées ont été recalées sur le LiDAR et de combien (diagnostic).

## v633.243 (25 octobre 2026): image Plans d'Apple calée sur les toits

Stéphane, stationnement dessiné collé à sa maison sur la carte mais à plusieurs mètres de la maison importée dans la
3D: « pourquoi un si gros décalage? ». La forme de bâtiment dessinée sur Google tombait à 1 m de l'empreinte LiDAR
(l'image Google est bonne chez lui; mon premier diagnostic, 7 m pour Google, était faux: j'avais pris l'ombre pour le
toit). C'est l'image Apple du sol (SOL SAT) qui était mal calée, et la maison importée, posée dessus, avec elle.

- **Cause:** le calage serveur (api/satshift.js, v633.184) cherchait le décalage qui met le plus de pixels sombres dans
  les empreintes. La masse sombre, c'est le toit plus son ombre portée, toujours du même côté: biais constant de 7 à
  10 m vers le sud là où ce critère concluait (Stoneham 10 m au lieu de 2,5; Limoilou 12 m au lieu d'environ 2; Gaspé
  12 m). Planche: `_METEOSHOOT/verification_entrees_fosse/calage/planche_calage_apple_maison.png`.
- **Nouveau critère** (`src/scene3d/roofShift.js`, partagé serveur et navigateur): pixels de toit gris (saturation
  sous 0,22, valeur de 0,12 à 0,55), empreinte par empreinte LiDAR (60 m² et plus), part de toit dedans moins
  l'anneau de 1,5 à 4 m, pic net exigé; médiane pondérée vers le projet, accord d'au moins deux bâtiments et de la
  moitié du poids. Faux pics écartés: le toit du voisin le long d'une rue régulière. Pas d'accord (villes, toits pâles
  ou colorés, peu d'empreintes LiDAR): pas de recalage, plus juste que l'ancien critère.
- **Banc** (`verification_entrees_fosse/calage/bench_calage.mjs`, quatorze lieux): concluent Stoneham (2 E, 2,5 S;
  5 bâtiments sur 6) et Shannon (2 E, 4 S); ailleurs pas d'accord, donc pas de recalage (Limoilou et Gaspé y gagnent:
  l'ancien les poussait de 12 m). L'image Esri (api/paved.js) garde l'ancien critère: sa photo de printemps à
  dominante verte ne se laisse pas mesurer par ce critère des toits (piste ouverte).
- **La maison importée suit l'image** (`followSat`, engine.js): la pose garde `sat`, le calage de l'image quand elle
  a été glissée avec SOL SAT allumé (null: posée sans l'image, pose par défaut comprise, elle ne bouge pas). Une pose
  sans ce champ (d'avant la v633.243) est supposée faite sur l'ancien calage (`appleShiftOld` dans la scène): elle se
  déplace une fois de la différence (chez Stéphane: 7,5 m vers le nord) et la nouvelle pose est enregistrée, pour
  son projet même si la fiche en montre un autre. Vérifié en local avec le modèle de test et une pose simulée.
- Version de scène 13: chaque lieu recalcule ses environs une fois.
