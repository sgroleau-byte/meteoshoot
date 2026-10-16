// Couverture nuageuse combinée (15 octobre 2026): ICON et les autres modèles mélangés par un petit modèle statistique
// appris sur 12 mois d'observations d'aéroports canadiens (banc de vérification, voir docs/nuages-verification.md).
// Entrées: couverture totale de chaque modèle, nuages bas d'ICON, part de l'heure au soleil prévue par ICON (son direct
// rapporté au ciel clair: ses nuages minces se trahissent par un soleil qui passe), hauteur du soleil. Sortie: couverture
// totale la plus probable (médiane). Arbres de décision exportés du banc (blendModel.json, chargé à part pour ne pas
// alourdir le démarrage), une table par échéance. Un modèle absent (hors domaine, panne) est simplement manquant: les
// arbres savent s'en passer.

import { clearDirHour, sunElevation } from './solar.js';

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
// Nuages bas combinés (tables low_d0, low_d1, low_d2 du même fichier), null si la table de l'échéance manque
export function blendLow(model, feats, hoursAhead) {
  const b = bucketOf(hoursAhead), m = model && b && model['low_' + b];
  if (!m || feats.ICONlow == null) return null;
  const x = m.features.map((k) => (feats[k] == null ? NaN : feats[k]));
  return Math.max(0, Math.min(100, Math.round(predict(m, x))));
}
export function blendCloud(model, feats, hoursAhead) {
  const b = bucketOf(hoursAhead), m = model && b && model[b];
  if (!m || feats.ICON == null) return null;
  const x = m.features.map((k) => (feats[k] == null ? NaN : feats[k]));
  return Math.max(0, Math.min(100, Math.round(predict(m, x))));
}

// Noms Open-Meteo des membres de la couverture combinée (ICON et GFS viennent des deux requêtes de base)
export const MEMBER_API = { GEM: 'gem_seamless', ECMWF: 'ecmwf_ifs025', AIFS: 'ecmwf_aifs025_single', UKMO: 'ukmo_seamless', NBM: 'ncep_nbm_conus', IFS9: 'ecmwf_ifs' };

// Application aux tableaux horaires d'une prévision (fetchWeather, et l'archive de vérification api/verif-snapshot.js):
// réécrit cloudcover et cloudcover_low sur les 72 premières heures d'ICON; garde cloudcoverIcon, cloudLowIcon et blendK.
// Les autres modèles doivent fournir cloud_cover et cloud_cover_low.
export function applyBlend(hourly, { model, gfs, gfsHourIdx, members, lat, lng, tzOffsetMin, now = Date.now() }) {
  const n = hourly.time.length;
  hourly.cloudcoverIcon = hourly.cloudcover.slice(); hourly.cloudLowIcon = hourly.cloudcover_low.slice(); hourly.blendK = new Array(n).fill(null);
  if (!model) return;
  const msOf = (t) => (tzOffsetMin != null ? Date.parse(t + ':00Z') - tzOffsetMin * 60000 : new Date(t).getTime());
  const memIdx = {}; if (members && members.hourly) members.hourly.time.forEach((t, i) => { memIdx[t] = i; });
  const mem = (m, t, low = false) => { const a = members && members.hourly && members.hourly[`cloud_cover${low ? '_low' : ''}_${MEMBER_API[m]}`]; const i = memIdx[t]; return a && i != null ? a[i] : null; };
  // part de l'heure au soleil prévue par ICON (direct rapporté au ciel clair), moyenne des rangées T et T+1 (le rayonnement
  // est la moyenne de l'heure précédente), comme au banc
  const pAt = (i) => { if (i >= n || hourly.direct_radiation[i] == null) return null; const c = clearDirHour(msOf(hourly.time[i]), lat, lng); return c >= 3 ? Math.min(1, hourly.direct_radiation[i] / c) : null; };
  for (let i = 0; i < n; i++) {
    if (hourly.model[i] !== 'icon') continue;
    const t = hourly.time[i], ms = msOf(t), ahead = (ms - now) / 3600000;
    if (ahead < -24 || ahead > 72) continue;
    const ico = hourly.cloudcover[i]; if (ico == null) continue;
    const p0 = pAt(i), p1 = pAt(i + 1), pSun = p0 != null && p1 != null ? (p0 + p1) / 2 : p0 ?? p1;
    const gi = gfsHourIdx[t];
    const f = { ICON: ico, GFS: gi != null && gfs ? gfs.hourly.cloudcover[gi] : null, GEM: mem('GEM', t), ECMWF: mem('ECMWF', t), AIFS: mem('AIFS', t), UKMO: mem('UKMO', t), NBM: mem('NBM', t), IFS9: mem('IFS9', t), ICONlow: hourly.cloudcover_low[i], pSun, sunEl: sunElevation(ms, lat, lng) };
    // Au moins trois autres modèles à cette heure (sinon les arbres travailleraient sur des entrées qu'ils n'ont presque jamais vues manquer)
    if (['GEM', 'ECMWF', 'AIFS', 'UKMO', 'IFS9'].filter((k) => f[k] != null).length < 3) continue;
    const b = blendCloud(model, f, Math.max(0, ahead));
    if (b == null) continue;
    const low = hourly.cloudcover_low[i];
    hourly.cloudcover[i] = b;
    hourly.blendK[i] = Math.round(Math.min(3, b / Math.max(5, ico)) * 100) / 100;
    // Nuages bas: leur propre combinaison quand elle existe pour cette échéance (nuages bas de chaque modèle; banc: 18,3 points
    // d'écart avec ICON seul, 13,5 combinés à courte échéance), bornée par le total combiné
    const gL = gi != null && gfs ? gfs.hourly.cloudcover_low?.[gi] : null;
    const lowB = blendLow(model, { ...f, GEMlow: mem('GEM', t, true), GFSlow: gL, ECMWFlow: mem('ECMWF', t, true), AIFSlow: mem('AIFS', t, true), UKMOlow: mem('UKMO', t, true) }, Math.max(0, ahead));
    if (lowB != null) { hourly.cloudcover_low[i] = Math.min(b, lowB); continue; }
    // Sinon: bas d'ICON à l'échelle du total combiné; ICON presque sans nuages: la part basse vient de GFS (même heure), sinon 60 %
    const gT = gi != null && gfs ? gfs.hourly.cloudcover[gi] : null;
    if (low != null) hourly.cloudcover_low[i] = Math.round(Math.min(b, ico >= 5 ? low * b / ico : gT >= 10 && gL != null ? b * Math.min(1, gL / gT) : b * 0.6));
  }
}

