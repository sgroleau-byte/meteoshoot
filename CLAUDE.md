# MeteoShoot - Instructions projet

## Workflow de déploiement

- **Publier directement en prod par défaut.** Quand Stéphane demande un changement, après l'avoir codé, enchaîner: bump version `v633.X` (dans `index.html` aux deux endroits + `CACHE_VERSION` dans `sw.js`), commit sur `dev`, puis `git push origin dev && git push origin dev:main`. Vercel auto-deploy le push sur `main`.
- Pas besoin de demander confirmation avant le push (override de la règle globale "toujours demander avant git push" pour ce projet).
- Le branch `main` est utilisé par un worktree local, donc utiliser `git push origin dev:main` au lieu de checkout + merge.

## Versioning

- Version actuelle suit le format `v633.X` (patch courant) - bump le `X` à chaque changement.
- Trois endroits à mettre à jour: deux dans `index.html` (header debug + écran préférences), un dans `sw.js` (`CACHE_VERSION` numérique).
