# Banc des nuages

Vérification des prévisions de couverture nuageuse contre les observations d'aéroports, et entraînement de la couverture combinée de l'app (`src/weather/blendModel.json`). Méthode et résultats : `docs/nuages-verification.md`.

Dans un dossier de travail hors du dépôt (les données pèsent quelques centaines de Mo) :

1. Copier ces fichiers dans le dossier de travail.
2. Préparer Python : `python3 -m venv venv && ./venv/bin/pip install numpy pandas scipy scikit-learn`.
3. Télécharger les observations : `python3 fetch_obs.py` (archives METAR de l'Iowa Environmental Mesonet, dans `obs/`).
4. Télécharger les prévisions archivées d'Open-Meteo, l'une après l'autre (l'offre gratuite refuse plus de 2 ou 3 requêtes simultanées) :
   - échéance courte : `./fetch_hist2.sh` puis `./fetch_hist3.sh` ;
   - veille et avant-veille : `python3 fetch_prev.py 0 1` ;
   - NBM et ECMWF 9 km : `./fetch_extra.sh`.

   Les scripts attendent parfois la fin du précédent : lire leurs premières lignes. Régler les dates de début et de fin dans chaque script.
5. Décoder les observations : `./venv/bin/python parse_obs.py` (produit `truth.json`).
6. Lancer les analyses :
   - `./venv/bin/python analysis2.py` : modèles et combinaisons, une valeur par fenêtre de tournage ;
   - `./venv/bin/python nowcast2.py` : correction par le ciel observé.
   - correction par le ciel observé recalée (16 octobre 2026) : satellite `mkdir goes_samples && python3 fetch_goes.py` (GOES-19 heure par heure, environ 10 h), puis `cvpred.py` (prédictions combinées hors échantillon `cvpred_d0.csv`, `cvpred_d1.csv`), `nowcast_data.py` (tableau commun `nowcast_H.pkl`), `nowcast_fit.py` (tables de poids `nowcast_tables.json`; avec `pair` ou `impair`, calage sur une semaine sur deux), `nowcast_export.py` puis `node nowcast_replay.mjs <src/weather/nowcast.js> bench_rows.csv` (le code de l'app rejoué, ancienne correction comprise). Les tables vont dans `NOWCAST_TABLES` de `src/weather/nowcast.js`.
7. Entraîner et exporter : `DEPTH=3 ITER=150 ./venv/bin/python train_blend.py blendModel.json`, puis copier le fichier dans `src/weather/`.

Le script contrôle que la prédiction recalculée comme dans l'app (`src/weather/blend.js`) égale celle de scikit-learn.

## Vérification privée en continu (depuis le 16 octobre 2026)

- Toutes les 6 h, pg_cron appelle la fonction Supabase `cloud-verif`. Elle demande à `api/verif-snapshot.js` un instantané des prévisions pour les 33 aéroports et le range dans la table privée `cloud_verif`. L'instantané contient ICON, la couverture combinée, le ciel observé des premières heures (avec l'aéroport lui-même, et sans lui depuis la v633.215 : le cas d'un projet loin de l'aéroport) et les prévisions publiées par Environnement Canada pour la ville voisine.
- Comparaison au ciel réel : `VERIF_REPORT_TOKEN=... python3 verif_live.py 2026-10-16`. Le jeton de lecture est un secret Supabase, gardé hors du dépôt.
- But : savoir, chiffres à l'appui, si MeteoShoot prévoit les nuages mieux qu'Environnement Canada, avant de l'affirmer publiquement.
