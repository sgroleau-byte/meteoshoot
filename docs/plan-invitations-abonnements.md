# Plan: comptes sur invitation, gratuit puis 12,99 $ par mois, admin à part

Écrit le 25 octobre 2026. Objectif: inviter les 50 premiers photographes, leur donner l'application
gratuitement au départ, puis les faire passer à 12,99 $ par mois pour la version complète, à un prix
garanti (à vie ou 5 ans) parce qu'ils sont les fondateurs. Stéphane gère tout ça depuis un tableau de
bord à part de l'application.

## Ce qui existe déjà (et qu'on réutilise)

- **Comptes**: Supabase (courriel + mot de passe, mot de passe oublié, confirmation par courriel). Les pages
  `site/login.html`, `site/signup.html` et `site/account.html` sont en place. **L'inscription est ouverte à
  tout le monde** (lien « Créer un compte » sur la page de connexion): c'est la première chose à fermer.
- **Paliers**: la table `user_profiles` a déjà `subscription_tier` (free, shooter, god) et
  `subscription_status` (active, canceled, past_due, expired), plus les identifiants Lemon Squeezy et la fin de
  période. Depuis le 26 septembre 2026, un utilisateur ne peut plus modifier ses colonnes d'abonnement depuis le
  navigateur (droits par colonne): seul le serveur y touche. Bonne base.
- **Paiement**: Lemon Squeezy (boutique, page de paiement, portail client) avec la fonction edge `lemon-webhook`
  qui met le profil à jour quand un abonnement est créé, annulé ou expiré. Jamais testé avec un vrai client.
  Incohérence à corriger: la page de paiement pointe sur la boutique `driftandgrain`, le portail client sur la
  boutique `meteoshoot`.
- **Admin**: `site/dieu.html` (réservé au courriel sgroleau@me.com, fonctions SQL `admin_get_all_users`,
  `admin_get_stats`, `admin_set_tier`, fonction edge `admin-revenue` qui lit les commandes Lemon Squeezy).
  Il affiche les utilisateurs, change le palier à la main, montre les revenus. C'est l'embryon du tableau
  de bord demandé.
- **Dans l'application**: `SubscriptionProvider` lit le profil en temps réel (un changement de palier dans
  l'admin se reflète sans recharger), `UpgradeModal` montre trois forfaits avec un prix « --- »,
  `TIER_LIMITS` est à l'infini partout: **rien n'est bridé aujourd'hui, le gratuit a tout**.

## Décisions à prendre d'abord (Stéphane)

1. **Prix garanti: à vie ou 5 ans?** Recommandation: à vie. Plus simple (rien à migrer en 2031), argument de
   vente plus fort, et 50 abonnés à 12,99 $ ne pèsent rien sur la marge future.
2. **Durée de la gratuité**: une date commune pour tous (ex. « gratuit jusqu'au 1er avril 2027 ») ou une durée
   par personne à partir de l'invitation (ex. 3 mois)? Recommandation: durée par personne, réglée au moment
   d'inviter et modifiable dans l'admin. Les invitations vont s'étaler sur des semaines; une date commune
   pénalise les derniers invités.
3. **Ce que garde un compte gratuit après la période d'essai** (s'il ne paie pas). Proposition: ses projets
   restent lisibles, 3 projets actifs au maximum, pas de vue 3D, prévision des 3 prochains jours seulement.
   Les textes existants parlaient de « 3 projets maximum, météo de base ». À confirmer.
4. **Paiement sur iPhone et iPad**: Apple exige l'achat intégré (et prend 15 à 30 %) dès qu'une application de
   l'App Store propose un abonnement. Recommandation pour cette phase: le paiement se fait sur le web
   seulement, l'application iPhone ne montre ni prix ni bouton d'achat (comme Netflix): elle se contente de
   reconnaître le compte. Et tant que la distribution reste par TestFlight, Apple ne regarde pas. L'achat
   intégré (RevenueCat) viendra avec la mise en App Store, si jamais.
5. **L'admin « hors de l'application »**: garder `dieu.html` et le faire grossir, servi à une adresse à part
   (ex. admin.meteoshoot.com, même dépôt, même déploiement Vercel) plutôt qu'une application Mac distincte.
   Même design sobre, mais rien de tout ça ne se trouve dans l'application elle-même.

## Phase 1: fermer la porte et inviter

But: plus personne ne peut se créer un compte tout seul; Stéphane invite par courriel depuis l'admin.

1. **Base de données** (migration Supabase, à pousser avec `supabase db push`): nouvelles colonnes dans
   `user_profiles` et `user_profiles_dev`:
   `invited_at`, `invited_by`, `trial_ends_at` (fin de la gratuité), `is_founder` (fondateur, prix garanti),
   `admin_notes`, `last_seen_at`, `disabled_at`. Fonction `effective_tier()` qui répond « complet » si
   l'abonnement est actif OU si la gratuité court encore, « gratuit » sinon.
2. **Supabase, réglages**: désactiver les inscriptions libres (Authentication > Sign In / Up); brancher un
   serveur de courriel à nous (Resend ou Postmark, domaine meteoshoot.com): **le service de courriel par
   défaut de Supabase ne livre qu'aux membres de l'équipe et est limité à quelques envois par heure**, ce qui
   explique sans doute les confirmations qui n'arrivaient pas lors des tests de septembre. Gabarit du courriel
   d'invitation en français, au design MeteoShoot, signé Stéphane.
3. **Fonction edge `admin-invite`** (clé de service, vérification de l'admin comme dans `admin-revenue`):
   reçoit courriel, nom, durée de gratuité, drapeau fondateur; appelle l'invitation Supabase
   (`auth.admin.inviteUserByEmail`), remplit le profil. Aussi: renvoyer une invitation, désactiver un compte.
4. **Page d'accueil de l'invité**: `signup.html` devient « Accepter l'invitation »: le lien du courriel arrive
   là, l'invité choisit son mot de passe, confirme son nom et son organisation, et tombe dans l'application.
   Le lien « Créer un compte » disparaît de la page de connexion (remplacé par « Sur invitation seulement,
   écrivez à ... »).
5. **Admin**: formulaire Inviter (courriel, nom, durée, fondateur), liste des invitations en attente avec
   « Renvoyer ».

## Phase 2: le tableau de bord à part

But: tout voir et tout gérer sans entrer dans l'application.

1. **Adresse à part**: admin.meteoshoot.com (domaine ajouté au projet Vercel, réécriture vers la page admin);
   la page reste protégée par la session Supabase et le courriel admin; l'entrée ADMIN des préférences de
   l'application est retirée.
2. **Liste des comptes**, une ligne par photographe: courriel, nom, organisation, état (invité / actif /
   désactivé), fondateur, fin de la gratuité (avec compte à rebours), palier effectif, abonnement Lemon
   Squeezy (statut, prochain renouvellement, portail), dernière connexion, nombre de projets, notes.
   Filtres: en essai, essai terminé sans paiement, abonnés, inactifs depuis 30 jours.
3. **Actions par compte**: prolonger la gratuité (choisir une date), marquer ou retirer fondateur, passer
   complet ou gratuit à la main (offert, échange de service), renvoyer l'invitation, désactiver, supprimer.
   Journal des actions (qui, quand, quoi) pour s'y retrouver.
4. **Tableau de bord**: invités / acceptés / en essai / abonnés / perdus; revenus mensuels récurrents, prochains
   renouvellements, échecs de paiement (déjà en partie dans `admin-revenue`).
5. **Dernière connexion**: l'application écrit `last_seen_at` au démarrage (une petite fonction SQL, au plus
   une fois par jour).

## Phase 3: gratuit, puis payant, dans l'application

But: la bascule se fait toute seule, sans surprise pour le photographe.

1. `SubscriptionProvider` lit le palier effectif (abonnement actif ou gratuité en cours = complet).
2. **Bridage du gratuit** selon la décision 3: nombre de projets actifs, vue 3D, horizon de prévision. Les
   projets au-delà de la limite restent visibles mais ne se créent plus.
3. **Compte à rebours**: bandeau discret dans l'application à 30, 7 et 1 jours de la fin de la gratuité, puis
   écran « votre période gratuite est terminée » avec le bouton vers le paiement (web) et le rappel du prix
   fondateur.
4. **Modal de forfaits** réécrit en deux colonnes (Gratuit / Complet), vrai prix 12,99 $ par mois, mention
   « prix fondateur garanti », masqué dans l'application iPhone et iPad (décision 4).
5. **Page compte**: statut fondateur, date de fin de gratuité, bouton « Gérer mon abonnement » vers le bon
   portail Lemon Squeezy.
6. **Rappels par courriel** (optionnel mais utile): 7 jours avant la fin de la gratuité et le jour même,
   envoyés par une tâche planifiée Supabase (pg_cron) via le même serveur de courriel.

## Phase 4: le paiement pour vrai

1. **Lemon Squeezy**: une seule boutique (trancher entre `meteoshoot` et `driftandgrain`), devise CAD,
   produit « MeteoShoot complet » avec deux variantes: « Fondateur » à 12,99 $ par mois (prix figé, visible
   seulement par lien direct) et « Standard » au prix futur. Un abonnement garde le prix de sa variante pour
   toujours: c'est ce qui donne la garantie à vie. Pour l'option 5 ans, il faudrait une note dans l'admin et un
   changement de variante à la main en 2031.
2. **Webhook**: lire la variante pour poser `is_founder`, gérer les événements de paiement échoué et de reprise,
   journaliser chaque événement dans une table `billing_events` (utile pour comprendre un cas bizarre).
3. **Portail client** sur la bonne boutique; test complet en mode test de Lemon Squeezy (carte de test):
   acheter, annuler, réactiver, carte refusée.
4. **Taxes**: Lemon Squeezy agit comme marchand officiel (il perçoit et remet la TPS et la TVQ lui-même, et
   prend une commission d'environ 5 % plus des frais fixes). Vérifier que la boutique est bien réglée pour le
   Canada et le Québec avant la première vente.

## Phase 5: avant d'encaisser le premier dollar

- Conditions d'utilisation et politique de confidentialité (Loi 25 du Québec: quelles données, où elles
  vivent, comment supprimer son compte: la suppression existe déjà dans la page compte).
- Courriel de support (ex. bonjour@meteoshoot.com) affiché dans l'application et dans l'admin.
- Services tiers: Open-Meteo est déjà au forfait Standard (15 octobre 2026); vérifier les conditions d'Esri
  World Imagery (entrées en gravier) et de Google (recherche affichée sur carte Apple), notées dans
  `_METEOSHOOT/services-externes.md`.
- TestFlight: les builds expirent après 90 jours; tant qu'on publie régulièrement, les invités restent à jour.
  Pour des testeurs externes, Apple demande une courte revue du premier build (quelques jours).

## Phase 6: lancement des 50

1. Liste des 50 photographes (nom, courriel, lien avec Stéphane, ordre d'invitation) dans l'admin ou une
   simple feuille, à transférer dans l'admin au fur et à mesure des invitations.
2. Courriel personnel de Stéphane + invitation automatique, par vagues de 5 à 10 pour pouvoir répondre.
3. Canal de retours: un courriel, et la case « notes » de l'admin pour garder la trace de ce que chacun a dit.
4. Un mois avant la première fin de gratuité: phases 3 et 4 terminées et testées.

## Ordre et effort

| Étape | Dépend de | Effort (séances de travail) |
|---|---|---|
| Décisions 1 à 5 | Stéphane | une conversation |
| Phase 1 (inviter) | décision 2 | 2 à 3 |
| Phase 2 (admin à part) | phase 1 | 2 à 3 |
| Phase 3 (bascule dans l'app) | décisions 3 et 4 | 2 à 3 |
| Phase 4 (paiement réel) | décision 1 | 2, plus les tests |
| Phase 5 (textes légaux, services) | rien | 1, plus relecture par Stéphane |
| Phase 6 (lancement) | phases 1 et 2 | au rythme des invitations |

Les phases 1 et 2 suffisent pour commencer à inviter. Les phases 3 et 4 doivent être prêtes avant la première
fin de gratuité (donc, avec 3 mois d'essai, dans les 2 mois qui suivent la première invitation).

## État au 25 octobre 2026 (soir)

Décisions de Stéphane: prix garanti à vie pour ceux qui restent; durée de gratuité par personne, modifiable dans
dieu; le gratuit garde 3 projets, pas de 3D, 3 jours de prévision (réglable dans dieu); paiement par l'App Store pour
ceux qui viennent de là et par la boutique Drift&Grain (Lemon Squeezy) pour les autres (à faire, phase 4); admin sur
dieu.meteoshoot.com.

**Fait (phases 1 et 2, v633.246):**
- Base: table `admins` (clé d'accès exigée une fois enregistrée), colonnes d'invitation sur les profils, notes privées,
  journal `admin_log`, réglages `app_settings` (`free_limits`, `invite_defaults`), palier effectif, fonctions admin.
- Fonction edge `admin-users`: inviter, renvoyer, désactiver, réactiver, supprimer, mettre à jour, réglages, journal,
  clés d'accès; seule porte vers la clé de service. `admin-revenue` passe par la même porte.
- Supabase: inscriptions libres fermées; clés d'accès (passkeys) activées, domaine meteoshoot.com; courriel
  d'invitation en français et en anglais (`supabase/templates/invite.html`), envoyé par Resend; tout rejouable par
  `scripts/supabase-auth-config.py`. Supabase refuse WebAuthn comme second facteur sur ce projet: la clé d'accès est
  donc une méthode de connexion à part entière, et dieu l'exige dès qu'elle est enregistrée.
- Pages: `signup.html` devient « Accepter l'invitation »; la page de connexion dit « Sur invitation seulement »;
  `dieu.html` réécrit (entrée Face ID, comptes avec filtres, détail et actions, invitations, réglages, journal,
  revenus); entrée ADMIN retirée des préférences de l'application; l'application écrit la dernière visite.
- Vercel: domaine dieu.meteoshoot.com ajouté au projet, routes et en-têtes de sécurité (`vercel.json`, format `routes`: les `rewrites` sont ignorées pour les fichiers qui existent). En ligne le 25 octobre 2026 au soir.
- Relecture avec les avis de sécurité Supabase (skills `supabase` et `supabase-postgres-best-practices` installés):
  fonctions admin réservées au rôle de service (la page dieu passe toujours par `admin-users`), déclencheur
  `handle_new_user` fermé aux rôles clients, `search_path` fixé. Reste un avis: la protection contre les mots de
  passe compromis (HaveIBeenPwned) demande le forfait Pro de Supabase.
- Verrou Face ID en deux temps: enregistrer la clé, rentrer une fois avec Face ID, et le serveur verrouille seulement
  s'il constate une session ouverte par clé d'accès (aucun risque de se barrer soi-même).

**Reste à faire par Stéphane:**
- Chez Porkbun: enregistrement CNAME `dieu` vers `cname.vercel-dns.com` (le domaine est déjà sur Vercel).
- Sur dieu.meteoshoot.com, une fois en ligne: entrer avec le mot de passe, activer Face ID (bandeau en haut), puis
  s'inviter soi-même (sgroleauphoto@gmail.com a déjà un compte: utiliser une autre adresse) pour voir le courriel et
  la page d'acceptation de bout en bout.
- Phase 3 (bascule dans l'application: palier effectif, bridage du gratuit selon `app_settings`, compte à rebours,
  modal de forfaits) et phase 4 (paiement réel, App Store et Lemon Squeezy) restent à faire.

## Phase 3 faite (v633.248, 25 octobre 2026)

- `SubscriptionProvider`: palier effectif calculé côté client (abonnement actif ou gratuité en cours = complet;
  sinon gratuit), limites du gratuit lues dans `app_settings.free_limits` (réglables dans dieu), rien de bridé tant
  que le profil n'est pas lu, relecture horaire pour une fin de gratuité qui tombe l'app ouverte.
- Bridage du gratuit: projets actifs (compteur et blocage existants), vue 3D (le bouton 3D ouvre le modal des
  forfaits), jours de prévision (rangée météo coupée au nombre réglé, cellule pointillée « +N J » qui ouvre le modal).
- Pastille de compte à rebours (`TrialBanner`): à 30, 7 et 1 jours, chaque palier se ferme d'un geste et revient au
  suivant; « période gratuite terminée » en orange tant que l'abonnement n'est pas pris. Un toucher ouvre le modal.
- Modal des forfaits en deux colonnes (GRATUIT avec les limites réelles, COMPLET à 12,99 $ par mois, mention « prix
  fondateur garanti à vie » pour les fondateurs). Dans l'app iPhone et iPad: ni prix ni bouton d'achat (règles
  d'Apple), seulement « l'abonnement se gère depuis ton compte sur le web ». Le bouton web ouvre encore l'ancienne
  page de paiement Lemon Squeezy (boutique driftandgrain): à remplacer en phase 4 avant la première fin de gratuité.
- Préférences: date de fin de gratuité et mention fondateur sous le forfait; « SHOOTER » s'appelle maintenant
  « COMPLET » dans l'interface.
- Testé en local avec le compte de test dans les deux états (gratuité terminée, essai à 5 jours).

## Phase 4, côté code (v633.249, 26 octobre 2026)

- **Constat**: la clé d'API Lemon Squeezy gardée dans les secrets Supabase est expirée (« Your API key has expired »);
  la lecture du catalogue, des abonnements et du portail client ne marchera qu'après son remplacement.
- Migration `20261026120000_paiements_lemon.sql`: table privée `billing_events` (chaque événement du webhook),
  colonnes `lemon_variant_id`, `lemon_variant_name`, `subscription_ends_at` sur les profils, liste des comptes de dieu
  enrichie.
- Webhook `lemon-webhook` réécrit: fondateur reconnu par la variante (secret `LEMON_FOUNDER_VARIANT_ID`, ou nom de
  variante contenant « fondateur »), statuts Lemon traduits (past_due, cancelled avec accès jusqu'à `ends_at`,
  expired qui ferme), paiements échoués et repris, comparaison de signature à temps constant, journal.
- Fonction `billing-portal`: renvoie l'adresse signée du portail client de l'abonnement de l'utilisateur connecté
  (la page compte l'ouvre d'un clic; plus de lien fixe vers la boutique).
- `src/shared/config.js`: `LEMON_CHECKOUT_FOUNDER` et `LEMON_CHECKOUT_STANDARD` (vides tant que le produit n'existe
  pas: bouton inactif « bientôt disponible »), `openLemonCheckout(user, isFounder)` choisit la variante.
- Page compte: statut effectif (gratuité en cours = complet), date de fin de gratuité, variante et renouvellement,
  accès jusqu'au pour un abonnement annulé, deux colonnes de prix alignées sur le modal de l'app.
- Dieu, onglet Revenus: boutiques avec devise, variantes avec prix, abonnements, alerte si la clé est expirée.

**À faire par Stéphane chez Lemon Squeezy (boutique `meteoshoot`)**: nouvelle clé d'API (Settings > API) à coller
dans Supabase (Edge Functions > Secrets > `LEMON_API_KEY`); devise de la boutique en CAD (Settings > General, aucune
vente à ce jour); produit « MeteoShoot complet » avec deux variantes mensuelles: « Fondateur » 12,99 $ (lien direct
seulement) et « Standard » (prix à décider); webhook (Settings > Webhooks) pointant sur
`https://mioiieshhjqpakdlsfzw.supabase.co/functions/v1/lemon-webhook` avec les événements subscription_* et
subscription_payment_*, et le même secret que `LEMON_WEBHOOK_SECRET`; puis me donner les deux liens de paiement
(« Share » de chaque variante) et l'identifiant de la variante Fondateur.

## Phase 4, suite (v633.250, 26 octobre 2026)

- Nouvelle clé d'API Lemon Squeezy posée par Stéphane dans les secrets Supabase: le catalogue se lit. Une seule
  boutique sous ce compte: **Drift&Grain** (`driftandgrain`, dollars canadiens, Canada), avec DJI AEB Sorter,
  PerspectiveDrift et DeployLens Pro. Pas de boutique « meteoshoot »: MeteoShoot va dans Drift&Grain, rien à changer
  côté devise.
- Fonction `create-checkout`: crée pour l'utilisateur connecté un paiement Lemon sur la bonne variante (Fondateur si
  le profil est fondateur, sinon Standard), courriel rempli, `custom.user_id` pour le webhook, retour sur la page
  compte. Plus aucun lien de paiement dans le code; secrets `LEMON_STORE_ID` (297563, posé), `LEMON_FOUNDER_VARIANT_ID`
  et `LEMON_STANDARD_VARIANT_ID` (à poser quand le produit existe). D'ici là, le bouton répond « bientôt disponible ».
- Reste à Stéphane: créer dans Drift&Grain le produit « MeteoShoot complet » (abonnement mensuel, variantes
  « Fondateur » 12,99 $ et « Standard », prix à décider) et le webhook vers `lemon-webhook` (événements
  `subscription_*`, secret = `LEMON_WEBHOOK_SECRET`). Ensuite: lire les identifiants des variantes dans dieu, poser les
  deux secrets, tester un achat en mode test.

## Phase 4, produit en place (26 octobre 2026)

- Produit « MeteoShoot complet » (id 1472971) dans Drift&Grain, retiré de la vitrine: variante Fondateur
  **2296693** (12,99 $ par mois) et Standard **2296696** (19,99 $ par mois), posées dans les secrets
  `LEMON_FOUNDER_VARIANT_ID` et `LEMON_STANDARD_VARIANT_ID`. Une troisième variante (2296700, « Default », en
  attente) apparaît par l'API seulement: gabarit interne de Lemon, invisible dans le tableau de bord, rien à faire. Les variantes s'appellent encore « Default »: à renommer
  Fondateur et Standard dans Lemon (reçus, dieu).
- Webhook Lemon posé par Stéphane vers `lemon-webhook`, nouveau secret de signature dans les deux endroits.
- `create-checkout` vérifié: compte ordinaire → 19,99 $, fondateur → 12,99 $. Reste le test d'un vrai achat
  (webhook, profil, portail client).

## Phase 4 vérifiée de bout en bout (26 octobre 2026, nuit)

- Achat réel par Stéphane avec son compte gmail (fondateur): 12,99 $ plus taxes, abonnement Lemon 2636893,
  variante Fondateur. Les trois premiers envois du webhook avaient été refusés 401 par la porte Supabase (fonction
  redéployée sans `--no-verify-jwt`); corrigé, renvoi depuis Lemon Squeezy: le profil passe à complet, fondateur,
  avec abonnement, variante et renouvellement, prod et dev. Règle consignée dans `CLAUDE.md`.
- Comptes gratuits sans essai (v633.252): lien « Passer à la version complète » toujours visible à côté du compteur
  de projets, pastille « GRATUIT » en bas; le modal des forfaits mène au paiement.
- Reste: le portail client (« Gérer mon abonnement » sur la page compte) à essayer par Stéphane;  l'App Store (achat intégré) plus tard.
- Cycle complet vérifié à 02:48: remboursement et annulation dans Lemon → événements `subscription_cancelled`,
  `subscription_updated`, `subscription_expired` reçus et journalisés → le gmail revient au gratuit (statut expiré),
  reste fondateur, abonnement détaché. Un paiement remboursé ferme aussi l'accès tout de suite (webhook).

## Accueil d'un compte vide (v633.253, 26 octobre 2026)

- Un compte sans projet voit « Bienvenue {prénom} », un mot d'explication, et trois projets exemples
  (`src/projects/samples.js`): lieux publics de Québec aux noms génériques (pavillon du musée, église de la place,
  hôtel de ville), jamais un client. Ils vivent dans l'app seulement, s'ouvrent en fiche (météo, soleil, 3D), ne se
  modifient pas (le store ignore toute mutation sur un identifiant `exemple-`), ne comptent pas dans la limite du
  gratuit, et s'effacent au premier projet créé (ils reviennent si la liste redevient vide).
- Première impression à revoir en SF Pro avec les maquettes Photoshop de Stéphane; ceci est la version provisoire.
