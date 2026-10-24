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
