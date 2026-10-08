# SAT2: satellite Plans d'Apple dans la fiche projet

Le menu de la carte de la fiche propose SAT (satellite Google), SAT2 (satellite Plans d'Apple) et 3D. L'ancien mode
MAP (plan routier sombre de Google) a été retiré le 7 octobre 2026 à la demande de Stéphane: seules les vues
satellite servent. SAT2 sert à comparer les deux imageries à un endroit précis (celle d'Apple est souvent plus
récente au Québec).

## Ce qui est affiché sur SAT2

- Les images satellite d'Apple, par MapKit JS (la bibliothèque web de Plans), version 6.
- Tous les dessins de SAT, identiques: ligne du soleil, ombre, heures, formes tracées au crayon et leurs ombres,
  teinte de nuit, échelle, bouton « Mettre à jour ».
- Les noms de rues: le satellite d'Apple n'en a aucun. MeteoShoot les dessine lui-même (texte blanc, halo sombre,
  le long de la rue) à partir des rues d'OpenStreetMap déjà chargées pour la vue 3D (cache partagé `scene3d_cache`,
  environ 500 m autour du projet). Mention « Rues © OpenStreetMap » en bas à gauche, reliée à la page des droits
  d'OpenStreetMap, comme l'exige sa licence. En local, un lieu pas encore en cache demande le serveur des fonctions
  (`npm run api`); sans lui, SAT2 s'affiche simplement sans noms de rues.
- Le logo Plans et le lien « Mentions légales » d'Apple, en bas à gauche. La licence d'Apple interdit de les
  masquer ou de les modifier: la désaturation de la fiche ne s'applique qu'aux images (règle `.ms-apple-sat canvas`
  dans `src/styles/app.css`), et leur calque passe au-dessus du vignettage, des teintes de nuit et de nos dessins.

## Comment c'est construit

- `src/maps/appleSat.js`: une petite couche qui reproduit les fonctions de Google Maps utilisées par la fiche
  (carte, calques, polygones, marqueurs, évènements). Elle tient elle-même la caméra (centre et zoom au sens de
  Google) et pousse le rectangle visible à MapKit à chaque image: SAT et SAT2 s'alignent au pixel près, et le
  passage de l'un à l'autre garde exactement le cadrage.
- `src/maps/streetLabels.js`: les noms de rues de SAT2.
- `src/components/ProjectDetail.jsx`: `gm()` donne l'interface de la carte en place (Google ou la couche Apple).
  Chaque moteur a son propre calque dans le conteneur de la carte; la carte Google reste en vie, masquée, pendant
  SAT2: revenir sur SAT ne la recharge pas (Google compte chaque chargement de carte).
- Zoom maximal: les images d'Apple s'arrêtent parfois plus tôt que celles de Google (zoom 19 à Québec, mesuré le
  7 octobre 2026). La couche le détecte et bloque le zoom au même palier, sinon les dessins glisseraient.
- Gestes: comme SAT. Ordinateur: glisser pour déplacer, molette pour faire défiler la page, zoom par les boutons
  plus et moins. Téléphone et iPad en hauteur: un doigt fait défiler la page, deux doigts déplacent et zooment
  (le zoom revient au palier entier en relâchant, comme Google).
- Premier passage sur SAT2: MapKit se charge en arrière-plan (moins d'une seconde); SAT reste affiché d'ici là.

## Jetons Plans d'Apple

Créés dans le compte développeur Apple: [Maps Tokens](https://developer.apple.com/account/resources/services/maps-tokens).
Apple fait un jeton par site (restriction par domaine) et refuse « localhost ».

| Jeton | Restriction | Durée | Où il vit |
|---|---|---|---|
| www.meteoshoot.com | ce domaine | sans expiration | `apple-maps-token.json` (champ `web`), et sur Vercel |
| meteoshoot-dev.vercel.app | ce domaine | sans expiration | idem |
| Tests locaux | aucune | 7 jours (limite d'Apple) | `apple-maps-token.json` (champ `local`) seulement |

- `apple-maps-token.json` est à la racine du dépôt et ignoré par git (modèle: `apple-maps-token.example.json`).
- `vite.config.js` en tire une table « nom d'hôte: jeton » injectée dans la page. Le jeton `local` n'est utilisé
  que par le serveur de développement (`npm run dev`) et n'entre jamais dans une compilation.
- Sur Vercel (à faire au premier déploiement de SAT2): variable `APPLE_MAPS_TOKENS_WEB` sur les deux projets, avec
  pour valeur le texte JSON du champ `web`, par exemple
  `{"www.meteoshoot.com":"eyJ...","meteoshoot-dev.vercel.app":"eyJ..."}`.
- Sans jeton pour le site courant, SAT2 est simplement absent du menu. Un jeton refusé par Apple (révoqué,
  expiré, domaine non autorisé, quota dépassé) ramène la fiche sur SAT.
- Le domaine sans www (meteoshoot.com) n'a pas besoin de jeton: il redirige vers www.meteoshoot.com.

### Renouveler le jeton de tests (tous les 7 jours)

1. [Maps Tokens](https://developer.apple.com/account/resources/services/maps-tokens), bouton +.
2. Token Type: MapKit JS. Restriction Type: None. Description: MeteoShoot tests locaux.
3. Copier le jeton dans le champ `local` de `apple-maps-token.json`, puis relancer `npm run dev`.

Pour ne plus renouveler: fabriquer des jetons à la demande à partir d'une clé privée Apple (fichier .p8, « Keys »
avec MapKit JS coché). La clé existe depuis octobre 2026 (« MeteoShoot Plans », section suivante). C'est aussi la
piste pour l'app iPhone (voir plus bas).

## Clé privée Apple « MeteoShoot Plans » (images statiques, octobre 2026)

Le calque SOL SAT de la vue 3D (voir `docs/vue-3d.md`, « Modèle d'architecte importé ») demande une image satellite au
service d'images statiques de Plans (« Snapshots »). Apple exige que chaque adresse d'image soit signée avec une clé
privée de l'équipe. La signature se fait sur le serveur, dans `api/apple-snapshot.js`: la clé ne quitte jamais le
serveur et n'apparaît ni dans les réponses ni dans les journaux.

| Élément | Valeur |
|---|---|
| Nom de la clé (Certificates, Identifiers & Profiles, « Keys ») | MeteoShoot Plans |
| Key ID (identifiant de la clé) | A6X3F4XKYH |
| Identifiant Plans (Maps ID) | maps.com.meteoshoot |
| Équipe (Team ID) | 89HN379C53 |
| Fichier .p8 | hors du dépôt, dans `_METEOSHOOT/cles-apple/` (dossier parent du dépôt), jamais versionné |

- Apple ne laisse télécharger le fichier .p8 qu'une seule fois: en garder une copie de sauvegarde hors du dépôt.
- Sur Vercel, projets meteoshoot et meteoshoot-dev: `APPLE_MAPS_TEAM_ID` (89HN379C53), `APPLE_MAPS_KEY_ID`
  (A6X3F4XKYH) et `APPLE_MAPS_PRIVATE_KEY`: le texte PEM complet (le contenu texte du fichier .p8), lignes « BEGIN PRIVATE KEY » et
  « END PRIVATE KEY » comprises (des retours de ligne écrits `\n` sont acceptés).
- En local: `APPLE_MAPS_PRIVATE_KEY_PATH` (chemin du fichier .p8) à la place du texte PEM, avec les deux identifiants,
  donnés au lancement du serveur des fonctions (il ne lit pas `.env.local`):
  `APPLE_MAPS_TEAM_ID=89HN379C53 APPLE_MAPS_KEY_ID=A6X3F4XKYH APPLE_MAPS_PRIVATE_KEY_PATH=../cles-apple/<fichier>.p8 npm run api`.
- Sans clé ou identifiants, le service répond 503 et SOL SAT affiche une erreur; le reste de la 3D n'est pas touché.
- Protection du quota: le service est public, mais il ne répond qu'aux pages de MeteoShoot (en-tête Origin, sinon
  Referer): www.meteoshoot.com, meteoshoot.com, meteoshoot-dev.vercel.app et les aperçus Vercel (tout hôte qui
  commence par « meteoshoot » et finit par « .vercel.app »), localhost et 127.0.0.1 (développement),
  capacitor://localhost (app iPhone) et https://localhost (app Android). Les autres reçoivent 403. C'est un contrôle
  de bonne foi: un script peut imiter ces en-têtes, mais la page d'un autre site ne peut pas se servir de l'image.
  Un navigateur réglé pour ne jamais envoyer de Referer (rare) est refusé aussi.
- Zoom borné de 16 à 20 (18 par défaut: environ 260 m de côté à Québec). Image gardée une semaine par le navigateur
  seulement (`Cache-Control: private`), jamais par le réseau de Vercel; les erreurs ne sont jamais gardées.
- Clé perdue ou exposée: la révoquer dans « Keys », en créer une nouvelle (MapKit JS coché, identifiant Plans
  maps.com.meteoshoot), remplacer `APPLE_MAPS_KEY_ID` et `APPLE_MAPS_PRIVATE_KEY` sur les deux projets Vercel, puis
  redéployer.
- Piste pour l'app iPhone: cette même clé pourra signer des jetons MapKit à la demande (petit texte signé, de courte
  durée, que Plans vérifie) par une fonction serveur, pour l'origine `capacitor://localhost` que les jetons par
  domaine ne couvrent pas (voir « Limites et points ouverts »). Elle remplacerait aussi le jeton de tests de 7 jours.

## Limites et points ouverts

- Gratuit chez Apple: 250 000 affichages de carte par jour, inclus dans le compte développeur.
- App iPhone et iPad: SAT2 n'y apparaît pas encore. L'app tourne à l'adresse `capacitor://localhost`, qu'un jeton
  par domaine ne couvre pas. Deux pistes: des jetons signés par une fonction serveur avec la clé privée Apple (la clé
  « MeteoShoot Plans » existe déjà, voir plus haut), ou la carte Plans native (gratuite et sans jeton) par un module
  Capacitor.
- Conditions de Google: SAT2 affiche sur une carte Apple le point du projet obtenu par la recherche d'adresse
  Google, ce que les conditions de Google interdisent. Risque accepté par Stéphane le 7 octobre 2026 pour l'usage
  actuel; à revoir avant la mise en vente (seule voie entièrement permise: le champ de recherche « Places UI Kit »
  de Google, avec de fortes contraintes).
