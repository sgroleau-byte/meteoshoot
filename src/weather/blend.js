// Couverture nuageuse combinée (15 octobre 2026): ICON et les autres modèles mélangés par un petit modèle statistique
// appris sur 12 mois d'observations d'aéroports canadiens (banc de vérification, voir docs/nuages-verification.md).
// Entrées: couverture totale de chaque modèle, nuages bas d'ICON, part de l'heure au soleil prévue par ICON (son direct
// rapporté au ciel clair: ses nuages minces se trahissent par un soleil qui passe), hauteur du soleil. Sortie: couverture
// totale la plus probable (médiane). Arbres de décision exportés du banc (blendModel.json, chargé à part pour ne pas
// alourdir le démarrage), une table par échéance. Un modèle absent (hors domaine, panne) est simplement manquant: les
// arbres savent s'en passer.

// Modèles demandés à Open-Meteo en plus d'ICON et de GFS (doivent couvrir les entrées des arbres)
export const BLEND_MEMBERS = ['GEM', 'ECMWF', 'AIFS', 'UKMO', 'NBM', 'IFS9'];

let modelP = null;
export const loadBlendModel = () => modelP || (modelP = import('./blendModel.json').then((m) => m.default || m).catch(() => { modelP = null; return null; }));

// Évalue un ensemble d'arbres exporté (HistGradientBoostingRegressor de scikit-learn)
function predict(m, x) {
  let y = m.base;
  for (const t of m.trees) {
    let i = 0;
    while (t.leaf[i] === 0) {
      const v = x[t.f[i]];
      i = v == null || Number.isNaN(v) ? (t.ml[i] ? t.l[i] : t.r[i]) : v <= t.th[i] ? t.l[i] : t.r[i];
    }
    y += t.v[i];
  }
  return y;
}

// Échéance réelle d'une heure à venir: les exécutions sortent environ 4 h après leur heure de départ
export const bucketOf = (hoursAhead) => (hoursAhead < 10 ? 'd0' : hoursAhead < 44 ? 'd1' : hoursAhead <= 72 ? 'd2' : null);

// model: blendModel.json chargé; feats: { ICON, GEM, GFS, ECMWF, AIFS, UKMO, NBM, IFS9, ICONlow, pSun, sunEl }
// (couvertures en %, pSun 0-1, sunEl en degrés)
export function blendCloud(model, feats, hoursAhead) {
  const b = bucketOf(hoursAhead), m = model && b && model[b];
  if (!m || feats.ICON == null) return null;
  const x = m.features.map((k) => (feats[k] == null ? NaN : feats[k]));
  return Math.max(0, Math.min(100, Math.round(predict(m, x))));
}
