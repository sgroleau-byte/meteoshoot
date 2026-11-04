# À prévoir: cache régional de la vue 3D

Note écrite le 4 novembre 2026, à la demande de Stéphane, après la mise en place du LiDAR américain (v633.274).
Rien de ce qui suit n'est commencé.

## Ce qui existe aujourd'hui

- Le résultat d'une scène (environs: bâtiments, arbres, surfaces) et son relief sont gardés dans la table partagée
  Supabase `scene3d_cache`, commune à tous les comptes, et dans le réseau de Vercel pendant 30 jours. Un autre
  utilisateur qui ouvre exactement le même lieu reçoit le résultat sans attendre.
- La clé du cache est la position du projet au cent-millième de degré (environ 1 m). Un autre bâtiment à 300 m dans le
  même quartier a une autre clé: tout est recalculé de zéro (Overture, LiDAR, imagerie Esri, calage Plans d'Apple,
  couverture du sol), 20 à 30 s hors du Québec, même si le voisin vient d'être calculé.
- La seule chose réutilisée d'une scène à l'autre: les tuiles Overture pré-découpées du sud du Québec (cadre -80 à -57
  de longitude, 44,9 à 50,5 de latitude, seau Backblaze, voir `docs/vue-3d.md`), lues en 0,2 à 0,8 s au lieu de 13 à
  20 s par DuckDB. C'est ce qui rend le Québec rapide et le reste du monde lent à la première ouverture.
- Le préchauffage (`node scripts/scene3d-warm.mjs`) calcule d'avance les lieux des projets existants, pas les lieux
  futurs.

## Ce qui est lent hors Québec, mesuré le 4 novembre 2026

| Étape | Québec | États-Unis (Sedona, Cambridge) |
| --- | --- | --- |
| Couche Overture | 0,2 à 0,8 s (tuiles) | 14 à 20 s (DuckDB dans les Parquet) |
| Relief LiDAR | 2 à 3 s (RNCan, 1 m) | 6 à 8 s (USGS 1 m: prédicteur flottant, relevés superposés) |
| Scène complète | 6 à 12 s | 22 à 30 s |

## Idée: un quartier « déjà chaud »

Garder en stockage partagé les morceaux bruts lus pour une scène, pour que les scènes voisines les relisent au lieu de
retourner chez Ressources naturelles Canada, l'USGS, Esri ou Overture:

1. Couche Overture par carré de 1 km (bâtiments, rues, boisés, parcs, eau, parties de bâtiment), découpée à la volée
   la première fois qu'un lieu du carré est demandé, puis gardée (Backblaze ou Supabase Storage). Même format que les
   tuiles du Québec (`api/overture-tiles.js`), donc même lecteur. C'est le plus gros gain (15 à 20 s).
2. Fenêtres LiDAR (sol nu et surface) par carré de 1 km, aux résolutions lues (1 ou 2 m pour les bâtiments et arbres,
   aperçus pour le relief). Format brut Float32 compressé, clé: source (rncan ou usgs), relevé, carré.
3. Tuiles d'imagerie Esri (zoom 19) lues pour les surfaces pavées et la teinte du sol: déjà petites, gain modeste.
4. Jetons et catalogues (STAC RNCan, index USGS, Planetary Computer): déjà en mémoire par instance de fonction;
   un cache partagé court (une heure) éviterait les 429 et les index en panne.

Les scènes et les reliefs resteraient calculés par lieu (les mesures LiDAR, le calage, les arbres dépendent du point),
mais en quelques secondes au lieu de 20 à 30.

## Variante plus simple

Découper d'avance des tuiles Overture pour d'autres cadres (le script `scripts/overture-tiles.mjs --bbox ...` accepte
un cadre quelconque: une région américaine se découpe en une à deux heures, quelques centaines de mégaoctets sur
Backblaze). À faire région par région, là où il y a vraiment des projets (Ontario, Nouvelle-Angleterre, Arizona...),
pas pour tout le continent. Ne règle pas le relief ni le LiDAR, seulement la couche Overture.

## Quand s'en occuper

Seulement si des utilisateurs ouvrent beaucoup de lieux nouveaux hors des tuiles du Québec. Tant que les projets sont
surtout au Québec, le préchauffage après chaque changement de version suffit.
