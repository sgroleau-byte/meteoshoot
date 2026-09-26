# MeteoShoot - Instructions projet

## Structure (depuis l'étape 0, septembre 2026)

- Application compilée par Vite (React 18 précompilé, Tailwind 3 compilé, dépendances et polices embarquées). Plus aucun chargement de Babel, React ou Tailwind depuis un serveur externe.
- `index.html`: coquille de l'application (splash, enregistrement du service worker, Google Maps). Le code est dans `src/`:
  - `src/main.jsx` point d'entrée (styles, polices, montage de React)
  - `src/components/` interface (App, TodoView, ProjectDetail, route/, icônes...)
  - `src/weather/` calculs et appels météo (Open-Meteo, fumée, relief, icônes, départ, Kp)
  - `src/projects/` projets (StoreProvider, fichiers, constantes)
  - `src/auth/` comptes, `src/subscription/` abonnements, `src/i18n/` langue
  - `src/shared/` configuration Supabase et Lemon Squeezy, traductions (partagé avec les pages)
  - `src/pages/` code des pages `site/login.html`, `signup.html`, `account.html`, `dieu.html`
  - `src/styles/app.css` styles de l'application (ancien bloc `<style>`), suivi des directives Tailwind
  - `src/native/` détection de la plateforme, géolocalisation Capacitor (natif seulement), réglages natifs au démarrage
- `ios/` et `android/` projets Capacitor 8 (iOS avec Swift Package Manager, signature automatique équipe 89HN379C53, appId `com.meteoshoot.app`). `npm run ios` compile, synchronise et ouvre Xcode; `npm run android` idem pour Android Studio (SDK Android et JDK à installer). Le contenu web des apps vient de `dist/`, jamais modifié à la main.
- `tools/baseline/` harnais de mesure et de comparaison visuelle (voir `verification_etape0/` dans le dossier parent pour les captures et mesures).
- `docs/tests-appareil-iphone.md` procédure de tests sur iPhone réel.
- `public/` fichiers servis tels quels à la racine: icônes, `manifest.json`, `sw.js`, `fonts/`, `imgProjet/`.
- Commandes: `npm install` (une fois), `npm run dev` (serveur de développement sur le port 5173), `npm run build` (produit `dist/`), `npm run lint` (variables non déclarées: à lancer après tout déplacement de code), `npm run cap:sync` (recompile et synchronise les apps natives).
- Dans l'app native, `isDev` est faux (données de production) même si l'origine est `capacitor://localhost`.

## Workflow de déploiement

- **Publier directement en prod par défaut.** Quand Stéphane demande un changement, après l'avoir codé: `npm run build` doit passer sans erreur, bump version `v633.X`, commit sur `dev`, puis `git push origin dev && git push origin dev:main`. Vercel détecte Vite (commande `npm run build`, dossier `dist`) et déploie le push sur `main`.
- Pas besoin de demander confirmation avant le push (override de la règle globale "toujours demander avant git push" pour ce projet).
- Le branch `main` est utilisé par un worktree local, donc utiliser `git push origin dev:main` au lieu de checkout + merge.

## Versioning

- Version actuelle suit le format `v633.X` (patch courant) - bump le `X` à chaque changement.
- Trois endroits à mettre à jour: `index.html` (version affichée sur le splash), `src/components/PreferencesView.jsx` (écran préférences), `public/sw.js` (`CACHE_VERSION` numérique).
