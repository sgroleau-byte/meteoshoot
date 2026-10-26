# Fiche projet: une seule position effective (v633.255, 26 octobre 2026)

## Le problème

Le repère blanc de la carte est fixe au centre: la carte glisse derrière lui. Tout ce qui se dessine (lignes du
lever et du coucher, ombre, halo du soleil, échelle, altitude, 3D) partait d'une « position effective » recalculée
à cinq endroits (`adjustedPos ?? project.lat/lng`), avec des références parallèles (`projectPosRef`,
`effectiveCenterRef`) écrites par l'écouteur `idle` de la carte et par « Mettre à jour ». Dès qu'un chemin ne
suivait pas (par exemple un projet exemple qui refuse la modification), le repère et les lignes se contredisaient:
« les lignes du soleil sont tout décalées ».

## La règle

- `effectivePos` (mémoïsé) est la seule source: la position ajustée par le glissement si elle existe, sinon celle du
  projet. Tout ce qui se dessine la lit; `effectiveCenterRef` n'en est qu'un miroir pour les écouteurs.
- Seul l'écouteur `idle` écrit `adjustedPos` (centre de la carte différent du projet de plus de 0,00005 degré).
- **Sans position ajustée, la carte est centrée sur le projet.** Un effet le vérifie à chaque changement de
  `adjustedPos`, de la position du projet ou de la carte, et recentre sinon. Un « Mettre à jour » refusé ou un
  état intermédiaire ne peuvent plus laisser le repère d'un côté et les lignes de l'autre.
- Un projet exemple n'a pas de bouton « Mettre à jour » (il ne se modifie pas).

## Le test

En local (`isDev`), la fiche expose `window.__msDetail` (carte, position effective, position ajustée, position
du projet). Les lignes du soleil sont dessinées sur le calque canvas depuis `effectivePos`: l'invariant à vérifier
est donc **centre de la carte = position effective**, avec le drapeau « ajusté » cohérent, après chaque manipulation.

Dans le navigateur intégré (serveur Vite sur le port 5173, seule origine locale acceptée par la clé Google Maps), sur un
projet jetable du compte de test, après la connexion et l'ouverture de la fiche:

```js
window.__msCheck = () => {
  const d = window.__msDetail, m = d.map, c = m.getCenter(), e = d.effectivePos;
  const dist = (a, b) => Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 111320 * Math.cos(a.lat * Math.PI / 180));
  return { centreVsEffectif_m: Math.round(dist({ lat: c.lat(), lng: c.lng() }, e) * 10) / 10, ajuste: !!d.adjustedPos, projet: d.projectPos, effectif: e, zoom: m.getZoom() };
};
```

Scénarios (le navigateur intégré n'anime pas: `panBy` ne bouge pas et `idle` ne part pas seul; on pose le centre
avec `setCenter` et on déclenche `google.maps.event.trigger(map, 'idle')`):

1. Ouverture: `centreVsEffectif_m` = 0, `ajuste` = false.
2. Glissement (`setCenter` ailleurs + `idle`): 0 m, `ajuste` = true, `effectif` = nouveau centre.
3. « Mettre à jour » (bouton) + `idle`: 0 m, `ajuste` = false, `projet` = `effectif` = nouveau centre.
4. Zoom (`setZoom(18)` + `zoom_changed` + `idle`): 0 m, `ajuste` = false.
5. Nouveau glissement + `idle`: 0 m, `ajuste` = true; retour sur `projectPos` + `idle`: 0 m, `ajuste` = false.

Résultat le 26 octobre 2026: les cinq scénarios à 0 m. Le compte de test (test-securite-2026@meteoshoot.com) et
son projet jetable servent à ça; le projet jetable est supprimé après.
