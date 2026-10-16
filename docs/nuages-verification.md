# Nuages : banc de vérification, couverture combinée et ciel observé

15 octobre 2026. Déclencheur : deux soirs (11 et 15 octobre) où ICON annonçait 34 à 60 % de nuages bas en fin de journée, alors que le satellite et l'aéroport de Québec voyaient un ciel presque dégagé depuis des heures. Le 15, la vue 3D dessinait un plafond gris foncé à 17 h 34. Stéphane : « mets toutes les efforts possibles pour rendre les prévisions nuageuses et les visualisations 3D météo les plus précises possible ». Il a levé la règle « ICON seul » quand les chiffres le justifient, et demandé de combiner avec les observations des aéroports.

## 1. Banc de vérification

- **Vérité** : observations horaires de 44 aéroports canadiens (archives de l'Iowa Environmental Mesonet), dont 33 avec observateur humain. Les remarques canadiennes donnent les huitièmes de chaque couche (`RMK SC1AC1CI1`). Total borné par la catégorie du corps du message (FEW, SCT, BKN, OVC), traces (`SC TR`) à 0, nuages bas = couches sous 6 500 pieds. Les stations automatiques ne servent qu'aux nuages bas.
- **Prévisions** : archives d'Open-Meteo, du 15 octobre 2025 au 15 octobre 2026.
  - `historical-forecast` : échéance courte (0 à 5 h pour ICON).
  - `previous-runs` : même heure, exécutions de la veille (24 à 29 h) et de l'avant-veille.
  - `cloud_cover_low` n'existe qu'en échéance courte.
- **Modèles** : ICON, GEM (`gem_seamless`, qui vaut HRDPS aux courtes échéances), GFS (`gfs_seamless`, qui vaut HRRR là où il couvre), ECMWF IFS 0,25°, AIFS (IA d'ECMWF), UKMO, NBM (mélange américain, sud du Canada), ECMWF IFS 9 km.
- **Méthode** :
  - échéance principale : la veille ;
  - validation croisée par semaines entrelacées, et aussi en laissant une région entière de côté ;
  - écarts testés par bootstrap par jour (toutes stations ensemble).
- **Scripts** : `tools/clouds/` (téléchargement, décodage METAR, analyses, entraînement et export du modèle combiné).

## 2. Résultats (écart absolu moyen entre la couverture prévue et observée, en points de %)

33 aéroports avec observateur, environ 270 000 heures par échéance.

| Prévision de la veille (24 à 29 h) | Toutes heures | Fenêtres de lever et de coucher |
|---|---|---|
| ICON | 18,8 | 18,5 |
| AIFS (IA d'ECMWF) | 16,5 | 15,8 |
| ECMWF IFS 0,25° | 19,7 | 19,7 |
| ECMWF IFS 9 km | 20,1 | 20,0 |
| UKMO | 21,1 | 21,3 |
| NBM | 22,2 | 20,6 |
| GEM / HRDPS | 28,6 (biais -22) | 29,0 |
| **Combinaison apprise** | **14,0** | **13,3** |

- Échéance courte (0 à 5 h) : ICON 17,1, combinaison 12,4 (fenêtres : 16,9 contre 11,8). Avant-veille : ICON 20,5, combinaison 15,5.
- Gain de la combinaison sur ICON la veille : 4,8 points (intervalle 4,5 à 5,1). Aux fenêtres de lever et de coucher : 5,2 points (4,9 à 5,6).
- Fausses alarmes, la veille (ciel réel au plus 2/8, annoncé à 50 % ou plus) : 32 % avec ICON, 25 % avec la combinaison.
- Ciels manqués (ciel réel couvert, annoncé à 30 % ou moins) : 4,4 % avec ICON, 1,8 % avec la combinaison.
- Les 8 régions gagnent, avec des résultats identiques quand la région est exclue de l'apprentissage. La veille (ICON, puis combinaison) :

| Région | ICON | Combinaison |
|---|---|---|
| Atlantique | 17,0 | 12,6 |
| Colombie-Britannique | 19,1 | 14,3 |
| Est du Québec | 18,4 | 14,0 |
| Ontario | 19,1 | 14,1 |
| Ouest du Québec | 16,7 | 13,0 |
| Prairies | 22,4 | 16,5 |
| Québec-Saguenay | 17,8 | 13,0 |
| Sud du Québec | 18,9 | 14,0 |

- La part de soleil direct prévue par ICON est une entrée clé : quand elle dépasse la part du ciel libre de nuages bas, les nuages d'ICON sont minces. Son schéma de couverture sous la maille produit des nuages partiels qui ne portent presque pas d'eau.

**Deuxième année (octobre 2024 à octobre 2025), téléchargée le 16 octobre 2026.**
- En apprenant sur une année et en testant sur l'autre (le test le plus dur : aucune semaine commune), le gain sur ICON tient. La veille, l'écart passe de 19,1 à 15,3 points (de 19,1 à 14,7 aux fenêtres de lever et de coucher). À courte échéance, il passe de 17,4 à 12,8 ; à deux jours, de 20,7 à 16,6.
- Ce test est prudent : AIFS n'existe chez Open-Meteo qu'à partir du printemps 2025, et UKMO la veille qu'à partir d'octobre 2025.
- Ce qui n'apporte rien de mesurable : apprendre sur les deux années (gain sur ICON de 4,75 points contre 4,83 sur une année), ajouter la saison et l'heure solaire, ou donner trois fois plus de poids aux heures de lever et de coucher (13,76 contre 13,80 aux fenêtres).
- Le modèle de l'app reste celui de la dernière année : il reflète les versions actuelles des modèles (AIFS 2 depuis mai 2026). Script : `tools/clouds/train2.py`.

**Nuages bas combinés (v633.213).** Une deuxième combinaison prédit les nuages bas à partir de la couverture basse et totale de chaque modèle (cible : couches observées sous 6 500 pieds). À courte échéance, sur 12 mois, l'écart moyen avec les nuages bas observés est de 18,3 points avec ICON seul, 16,9 avec la méthode précédente de l'app (bas d'ICON mis à l'échelle du total combiné) et 13,5 combinés (13,7 région exclue). Les fausses alarmes (nuages bas réels au plus 2/8, annoncés à 40 % ou plus) passent de 24 % à 9 %. La veille et l'avant-veille suivront : seule l'archive des calculs complets (depuis avril 2026, `tools/clouds/fetch_runs.py`) garde la couverture basse à ces échéances. Script : `tools/clouds/train_low.py`.

**Ciel observé pour les heures suivantes** (fond : la combinaison de la veille). La correction qui gagne est `w·observé + (1 - w)·prévision`, avec `w = e^(-h/tau)` : tau de 2,5 h pour le total, 3 h pour les nuages bas. Elle bat l'écart additif et le rapport. Avec ICON seul comme fond, tau montait à 4 ou 5 h.

| Heures après l'observation | 1 | 2 | 3 | 4 | 6 |
|---|---|---|---|---|---|
| Combinaison seule | 12,4 | 12,4 | 12,4 | 12,3 | 12,4 |
| Corrigée par l'observé | 8,4 | 10,9 | 11,7 | 12,1 | 12,3 |

Fausses alarmes à +1 h (ciel réel au plus 2/8, annoncé à 40 % ou plus) : 30 % sans correction, environ 14 % avec.

## 3. Dans l'app

1. **Couverture combinée** (`src/weather/blend.js`, `blendModel.json`).
   - Sur les 72 premières heures d'ICON, la couverture totale vient d'arbres de décision appris sur le banc (150 arbres de profondeur 3 par échéance : moins de 10 h, 10 à 44 h, 44 à 72 h ; 160 Ko, chargés à part).
   - Il faut au moins trois autres modèles à l'heure ; sinon, ICON reste tel quel. La requête des autres modèles est attendue au plus 6 s.
   - Les nuages bas d'ICON, et les moyens et hauts de la 3D, suivent en proportion (`blendK`).
   - Les valeurs d'ICON restent dans `cloudcoverIcon`.
   - Les autres modèles arrivent par une requête de plus à Open-Meteo : couverture totale seulement, poids 1. On passe de 3,0 à 4,0 appels par lieu.
2. **Ciel observé** (`src/weather/nowcast.js`).
   - Sources : `api/goes.js` (satellite GOES-19, produit des couches nuageuses CCL, toutes les 5 minutes, cellules d'environ 10 km, jusqu'à 50,7° N) et `api/metar.js` (aéroports dans un rayon de 90 km).
   - `api/metar.js` lit le fichier de toutes les stations d'aviationweather.gov (mis à jour chaque minute) plutôt que son API, limitée à 100 requêtes par minute. Seul l'historique de 4 h de l'aéroport le plus proche passe par l'API.
   - Les deux sources sont fusionnées avec leur poids (distance, jour et nuit, voile d'altitude qui cache les nuages bas au satellite).
   - La correction s'applique aux nuages et au direct (part de l'heure au soleil), avant les statistiques du jour et l'indice AM/PM. L'heure passée prend l'historique de l'aéroport.
3. **Vue 3D** (`src/scene3d/sky.js`, `engine.js`).
   - Les couches observées à l'aéroport donnent le type et la base des nuages bas, moyens et hauts.
   - Un profil ICON sec dans un air stable donne une couche mince de stratocumulus au lieu de 900 m de cumulus.
   - Les nuages bas que le soleil d'ICON traverse sont dessinés plus minces et plus clairs (`uLay0b.z`).
   - Les traces de nuages moyens (moins de 8 %) ne sont pas dessinées.
   - La légende affiche une ligne « Observé ... ».

## 4. Pièges

- Le profil vertical des nuages qu'Open-Meteo donne pour ICON est calculé à partir de l'humidité (méthode de Sundqvist), pas par le schéma nuageux du modèle.
- AIFS n'a qu'une valeur aux 6 h chez Open-Meteo ; les heures intermédiaires sont interpolées.
- GEM n'a presque pas de nuages hauts chez Open-Meteo.
- La limite de concurrence de l'offre gratuite d'Open-Meteo est très basse (« Too many concurrent requests » dès 2 ou 3 requêtes de la même adresse) : un forfait payant donnerait de la marge.
- Dans la 3D, un champ stratiforme à faible couverture, ou un amincissement trop fort, donne un voile laiteux et granuleux. Garder des bancs détachés sous 30 %.
- À refaire après le 30 novembre 2026 (ICON passe sur sa grille native chez Open-Meteo) : réentraîner le modèle combiné avec les archives de la nouvelle grille.
