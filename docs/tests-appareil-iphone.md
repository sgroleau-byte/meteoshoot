# Tests sur iPhone réel (app native Capacitor)

Ce que le simulateur a déjà validé (26 septembre 2026, iPhone 17 Pro simulé, données météo rejouées):
démarrage sans écran blanc, liste, fiche projet avec carte Google, météo horaire, carte « météo de votre
position » avec la permission native « Lorsque l'app est active » réutilisée au relancement, refus de la
position (projets toujours accessibles), pages de connexion et d'inscription.

Ce qui demande ton iPhone (impossible à simuler): performance réelle du processeur et du GPU, fluidité au
doigt, retour haptique, clavier physique iOS, mise en veille réelle, fournisseurs météo réels avec ton compte.

## Installation sur ton iPhone

1. Brancher l'iPhone au Mac, le déverrouiller, accepter « Se fier à cet ordinateur » si demandé.
2. Me le dire: je lance `tools/iphone-install.sh` (compilation signée avec ton équipe, installation et
   lancement sur le téléphone). Variante manuelle: `npm run ios` puis Run dans Xcode avec l'iPhone choisi.
   Au premier lancement, iOS peut demander d'approuver le développeur: Réglages > Général > VPN et
   gestion de l'appareil.
3. Se connecter avec ton compte MeteoShoot habituel (l'app native utilise les données de production,
   comme le site).

## Mot de passe oublié depuis l'app

Le formulaire « Mot de passe oublié? » de l'app envoie le courriel. Le lien du courriel ouvre le site
(meteoshoot.com/site/login.html) dans Safari, qui demande le nouveau mot de passe et connecte. Revenir
ensuite dans l'app et se connecter avec le nouveau mot de passe. (Ouvrir directement l'app depuis le
lien demandera des « liens universels », prévus plus tard.)

## Vérifications à faire (dans l'ordre)

- Démarrage: fond sombre immédiat, splash animé, puis la liste. Noter le temps entre le toucher de
  l'icône et la liste complète (viser moins de 4 s en 4G, moins de 3 s en wifi).
- Défilement de la liste avec beaucoup de projets: fluide, sans saccade, halos intacts.
- Carte « météo de votre position »: au premier lancement, toucher « Activer la localisation »,
  choisir « Autoriser lorsque l'app est active ». Fermer complètement l'app (balayer vers le haut),
  relancer: la carte doit se charger sans rien demander.
- Refus: Réglages > MeteoShoot > Position > Jamais, relancer: message « Localisation refusée » avec
  l'aide, projets et fiches toujours accessibles.
- Fiche projet: carte Google (tuiles, boussole du soleil), bande horaire au doigt, retour.
- Clavier: nouveau projet, toucher le champ nom: le clavier monte, le menu du bas se cache, rien de
  masqué; adresse avec suggestions Google.
- Retour haptique: glisser-déposer d'un projet dans la liste (léger tapotement attendu).
- Mise en veille: verrouiller l'iPhone 5 minutes avec l'app ouverte, déverrouiller: même écran, données
  intactes, météo rafraîchie si périmée.
- Passage en arrière-plan: ouvrir une autre app puis revenir: même écran.
- Route: itinéraire, hôtel, liens vers Plans/Google Maps (doivent ouvrir l'app externe).
- Préférences: changement de langue, adresse de départ (suggestions Google).
- Compte: page compte, déconnexion, reconnexion.

## Mesures « réelles » à noter

Deux jeux de chiffres sont à distinguer: les mesures automatiques faites avec des réponses météo
rejouées (voir `verification_etape0/`), et le comportement avec les fournisseurs réels (Open-Meteo,
Environnement Canada, Google). Sur l'iPhone, noter pour trois lancements: heure du toucher, apparition
de la liste, apparition des prévisions, en wifi puis en cellulaire.

## Android (émulateur, 28 septembre 2026)

Compilé (JDK 21, SDK 36, Gradle 8.14) et testé dans l'émulateur Pixel 7 virtuel (Android 16): démarrage,
liste, fiche projet, carte « météo de votre position » avec le dialogue de permission Android
(« Lorsque vous utilisez l'app »), permission réutilisée au relancement, retrait de la permission, bouton
Retour du système qui ferme la fiche. L'écran de l'émulateur montre des colonnes fantômes dans les rangées
météo: la capture prise par le moteur de rendu lui-même est propre et le DOM ne contient aucune
duplication, c'est un artefact de l'émulateur. À confirmer sur un téléphone Android réel.

Lancer: `tools/android-run.sh` (émulateur + installation + lancement). APK de débogage:
`verification_etape0/android/meteoshoot-debug.apk` (installable sur un téléphone en mode développeur).

## iPad (3 octobre 2026, v633.128)

L'app iOS est universelle (projet Xcode réglé pour l'iPhone et l'iPad): une seule app, une seule fiche App Store
et une seule mise à jour pour les deux. Sur iPad, l'interface est celle de l'ordinateur (plus de 768 px de large).

Corrigé après le test de Stéphane sur iPad (app web installée sur l'écran d'accueil), vérifié dans le simulateur
iPad Air 11 pouces (Safari, app web installée et app native, portrait et paysage):
- Le menu du haut et le titre de page passaient sous l'heure et la batterie (zone sûre du haut ignorée), et les
  onglets étaient presque impossibles à toucher: le système réserve cette bande. Le menu, le titre, le flou et
  le fondu du haut descendent maintenant de `env(safe-area-inset-top)`, nul dans un navigateur ordinaire.
- Un toucher sur une case météo était annulé (ancien code de bulles, `preventDefault` au `touchstart`): la page
  ne défilait pas si le doigt partait des cases, et le toucher n'ouvrait pas la fiche.
- Portrait (moins de 1024 px): la colonne CRÉÉ quitte les rangées de la liste (elle reste dans la fiche) et la
  rangée se réduit juste assez pour tenir (environ 96 % sur un iPad 11 pouces) au lieu d'être coupée à droite.
- Fiche en portrait (moins de 1100 px): les colonnes passent sous les jours au lieu de les chevaucher, et la
  carte passe au-dessus des champs, sur toute la largeur (640 px de haut; un doigt fait défiler la page, deux
  doigts déplacent la carte). En paysage, rien ne change: carte à droite.
- Survol réservé aux souris et trackpads: le halo rouge et les actions de la carte restaient collés après un
  toucher. Sur iPad, « Passer en édition » et la corbeille sont dans la fiche.
- Ordinateur et téléphone: captures identiques au pixel près avant et après (1440 px et 393 px).

Installer l'app native sur un iPad: le brancher au Mac, le déverrouiller, accepter « Se fier à cet ordinateur »,
activer le mode développeur (Réglages > Confidentialité et sécurité > Mode développeur, redémarrage), puis
`tools/iphone-install.sh` (le script trouve maintenant un iPhone ou un iPad). L'iPad mini en portrait (744 px)
garde l'interface téléphone.
