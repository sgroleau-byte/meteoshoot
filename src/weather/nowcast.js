// Correction des premières heures par le ciel observé (15 octobre 2026, recalée le 16 octobre). Le 11 et le 15 octobre,
// ICON annonçait 34 à 60 % de nuages bas en fin de journée alors que le satellite et l'aéroport voyaient un ciel presque
// dégagé depuis des heures. Chaque heure à venir corrige la prévision (déjà combinée, src/weather/blend.js) vers les deux
// sources observées: prévision + ws x (satellite étalonné - prévision) + wa x (aéroport - prévision).
//
// Poids appris sur le banc de vérification (docs/nuages-verification.md): 4 mois de satellite GOES-19 (juin à octobre
// 2026, une image par heure) au-dessus de 30 aéroports avec observateur, la prévision courte combinée comme fond, et
// l'observateur de l'aéroport comme vérité h heures plus tard; l'aéroport « source » est soit celui du lieu, soit le plus
// proche voisin (le cas d'un projet loin de l'aéroport). Ce que le banc a appris:
// - le satellite brut se trompe: de jour, il voit « dégagé » là où l'observateur compte des petits nuages épars (sous
//   5 % au satellite, l'observateur voit 23 % en moyenne). Le total de jour et les nuages bas de nuit passent donc par
//   une table d'étalonnage; ailleurs, le satellite brut mélangé à la prévision fait mieux qu'étalonné;
// - même étalonné, il vaut moins que la prévision seule (écart de 12,0 points contre 11,8 de jour): son poids au moment
//   présent est d'environ 0,45 (0,4 la nuit et au crépuscule, infrarouge seulement), et s'efface en 2 à 3 h;
// - l'aéroport du lieu remplace la prévision à l'heure présente et pèse encore 0,8 une heure plus tard; un aéroport à
//   30 km ne pèse plus que 0,3 (0,5 la nuit, où les nappes basses sont étendues), à 120 km presque rien.
// L'ancienne version (satellite pris tel quel, poids plein) rendait l'heure présente PIRE que la prévision seule de jour
// loin d'un aéroport (écart de 11,9 à 14,9 points). Celle-ci, mesurée hors échantillon (tables calées sur une semaine sur
// deux, vérifiées sur les autres): total de jour 11,9 -> 11,0 sans aéroport, 11,9 -> 9,9 avec un aéroport à moins de 60 km,
// 11,8 -> 8,9 une heure plus tard au lieu même d'un aéroport; nuages bas de jour 16,5 -> 15,6 sans aéroport. Aussi bonne
// ou meilleure que l'ancienne dans tous les cas (jour, nuit, distance, échéance).
//
// Sources (fonctions serveur): /api/goes (satellite GOES-19: fraction nuageuse par étage dans une boîte d'environ 30 km,
// toutes les 5 minutes, jusqu'à 50,7° N) et /api/metar (aéroports dans un rayon de 150 km: huitièmes par couche, base, type).
// Fonctions pures (sauf fetchObserved): le banc les importe telles quelles.

import { sunElevation } from './solar.js';

export const NOWCAST = {
  pastH: 1,        // heure passée la plus récente: observé du moment (les plus anciennes: historique de l'aéroport)
  maxAgeMin: 80,   // observation plus vieille: ignorée
  dayElev: 5,      // jour: soleil à plus de 5° au moment de l'observation (comme le banc)
  satHighBlind: 50, // au-delà de ce % de nuages moyens et hauts vus d'en haut, le satellite ne sait rien des nuages bas
  layersKm: 40,    // couches observées (type, base) seulement d'un aéroport à 40 km ou moins
  lowOpaque: 95,   // nuages bas à partir desquels le total ne dit plus rien des étages au-dessus (3D)
};

// Tables du banc (tools/clouds/nowcast_fit.py): étalonnage du satellite (valeur observée au sol la plus probable pour
// chaque valeur brute) et poids par échéance (lignes: h) et distance de l'aéroport (colonnes: km). pairSat et pairAp
// quand les deux sources sont là, sat quand le satellite est seul, apOnly quand l'aéroport est seul (au nord de 50,7°).
export const NOWCAST_TABLES = {
  knots: [0,2,5,10,20,30,40,50,60,70,80,90,95,100], // satellite brut (%)
  h: [0,1,2,3,4,6], // échéance depuis l'observation (h); nul au-delà de 8 h
  km: [0, 30, 75, 120], // aéroport: au lieu, moins de 60 km, 60 à 90, 90 à 150 (nul à 150 km et plus)
  tot: {
    satDay: [15.2,27.4,30.0,37.2,50.1,54.7,61.4,65.7,71.6,75.3,80.0,84.1,86.1,94.9],
    satNight: [0.0,2.0,5.0,10.0,20.0,30.0,40.0,50.0,60.0,70.0,80.0,90.0,95.0,100.0], // brut (l'étalonnage n'aide pas ici)
    day: { sat: [0.45,0.3,0.1,0.05,0.05,0.0], pairSat: [[0.0,0.4,0.35,0.45],[0.0,0.25,0.15,0.3],[0.0,0.05,0.05,0.1],[0.0,0.0,0.0,0.05],[0.0,0.0,0.0,0.0],[0.0,0.0,0.0,0.0]], pairAp: [[1.0,0.3,0.15,0.05],[0.8,0.25,0.15,0.05],[0.35,0.15,0.1,0.05],[0.2,0.1,0.1,0.05],[0.1,0.05,0.05,0.05],[0.05,0.05,0.05,0.0]], apOnly: [[1.0,0.55,0.2,0.1],[1.0,0.35,0.15,0.1],[0.35,0.15,0.1,0.05],[0.2,0.05,0.05,0.05],[0.1,0.05,0.05,0.05],[0.05,0.0,0.0,0.0]] },
    night: { sat: [0.4,0.35,0.2,0.1,0.05,0.05], pairSat: [[0.0,0.25,0.35,0.4],[0.0,0.25,0.3,0.35],[0.0,0.1,0.2,0.15],[0.0,0.1,0.1,0.1],[0.0,0.05,0.05,0.05],[0.0,0.05,0.05,0.0]], pairAp: [[1.0,0.5,0.4,0.1],[0.8,0.35,0.35,0.1],[0.45,0.2,0.2,0.05],[0.25,0.05,0.05,0.0],[0.1,0.05,0.05,0.0],[0.05,0.0,0.0,0.0]], apOnly: [[1.0,0.65,0.35,0.1],[1.0,0.45,0.3,0.05],[0.45,0.2,0.2,0.05],[0.2,0.1,0.1,0.05],[0.1,0.05,0.05,0.0],[0.05,0.0,0.0,0.0]] },
  },
  low: {
    satDay: [0.0,2.0,5.0,10.0,20.0,30.0,40.0,50.0,60.0,70.0,80.0,90.0,95.0,100.0], // brut (l'étalonnage n'aide pas ici)
    satNight: [1.4,2.0,2.8,3.9,4.9,12.8,30.7,70.3,78.1,82.4,93.8,95.9,96.3,96.4],
    day: { sat: [0.5,0.4,0.25,0.2,0.15,0.0], pairSat: [[0.0,0.25,0.45,0.45],[0.0,0.2,0.4,0.35],[0.0,0.2,0.35,0.25],[0.0,0.15,0.25,0.15],[0.0,0.15,0.2,0.1],[0.0,0.0,0.05,0.05]], pairAp: [[1.0,0.5,0.2,0.15],[1.0,0.4,0.15,0.15],[0.5,0.25,0.1,0.1],[0.3,0.1,0.05,0.05],[0.15,0.0,0.0,0.0],[0.0,0.0,0.0,0.0]], apOnly: [[1.0,0.8,0.35,0.2],[1.0,0.65,0.3,0.15],[0.6,0.4,0.2,0.15],[0.35,0.2,0.15,0.1],[0.2,0.1,0.1,0.05],[0.0,0.0,0.0,0.0]] },
    night: { sat: [0.5,0.5,0.4,0.3,0.25,0.15], pairSat: [[0.0,0.25,0.5,0.5],[0.0,0.25,0.5,0.5],[0.0,0.25,0.3,0.4],[0.0,0.25,0.15,0.3],[0.0,0.15,0.1,0.25],[0.0,0.15,0.1,0.1]], pairAp: [[1.0,0.65,0.5,0.0],[1.0,0.35,0.35,0.0],[1.0,0.2,0.2,0.0],[0.7,0.1,0.1,0.0],[0.5,0.1,0.1,0.0],[0.25,0.1,0.1,0.0]], apOnly: [[1.0,1.0,0.45,0.1],[1.0,0.7,0.4,0.1],[0.8,0.4,0.3,0.1],[0.5,0.2,0.2,0.05],[0.25,0.1,0.1,0.0],[0.1,0.0,0.0,0.0]] },
  },
};

// Station automatique (ceilomètre: nuages bas seulement) plus proche que l'aéroport avec observateur: poids de plus sur les
// nuages bas déjà corrigés, par échéance (h, comme NOWCAST_TABLES) et distance (30: moins de 60 km, 90: 60 à 120 km; nul
// au-delà). Banc hors échantillon (tools/clouds/auto_fit.py), de jour: 14,9 -> 13,9 à l'heure présente, 15,2 -> 14,5 une
// heure plus tard; la nuit, 15,1 -> 14,7.
export const AUTO_LOW = {
  day: { 30: [0.3, 0.25, 0.2, 0.15, 0.1, 0], 90: [0.15, 0.15, 0.15, 0.1, 0.1, 0] },
  night: { 30: [0.25, 0.15, 0.15, 0.1, 0.05, 0], 90: [0.2, 0.15, 0.15, 0.1, 0, 0] },
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const toPct = (octas) => (octas == null ? null : Math.round(octas * 12.5));
const u = (...a) => 1 - a.reduce((q, v) => q * (1 - v), 1);
const interp = (xs, ys, x) => {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[ys.length - 1];
};
const HX = [...NOWCAST_TABLES.h, 8]; // au-delà de 6 h, le poids va à zéro à 8 h
const byH = (col, h) => interp(HX, [...col, 0], Math.max(0, h));
// Poids d'une table [h][classe de distance] à l'échéance h et à d km (au-delà de la dernière classe: vers end à 150 km)
const at2 = (tab, h, d, end) => {
  const col = (j) => byH(tab.map((r) => r[j]), h), [k0, k1, k2, k3] = NOWCAST_TABLES.km;
  // la classe « au lieu » ne vaut qu'à l'aéroport même (2 km); au-delà, celle de la classe suivante sans pente entre les deux
  // (banc: Québec et Valcartier, à 14,6 km, veulent le même poids qu'une paire à 33 km, 0,4 et non 0,66)
  return interp([k0, 2, k1, k2, k3, 150], [col(0), col(1), col(1), col(2), col(3), end], Math.min(150, Math.max(0, d)));
};
export function autoLowWeight(day, h, d) {
  if (h == null || d == null || d > 120) return 0;
  const T = AUTO_LOW[day ? 'day' : 'night'];
  return interp([30, 90], [byH(T[30], h), byH(T[90], h)], d) * (d > 90 ? (120 - d) / 30 : 1);
}
export const calibSat = (tier, day, v) => (v == null ? null : interp(NOWCAST_TABLES.knots, NOWCAST_TABLES[tier][day ? 'satDay' : 'satNight'], v));

// Poids { ws, wa } d'un étage ('tot' ou 'low'): hSat et hAp = heures écoulées depuis chaque observation (null: absente),
// d = distance de l'aéroport (km)
export function nowcastWeights(tier, day, hSat, hAp, d) {
  const T = NOWCAST_TABLES[tier][day ? 'day' : 'night'];
  const hasS = hSat != null, hasA = hAp != null && d != null && d < 150;
  let ws = 0, wa = 0;
  if (hasS && hasA) { ws = at2(T.pairSat, hSat, d, byH(T.sat, hSat)); wa = at2(T.pairAp, hAp, d, 0); }
  else if (hasS) ws = byH(T.sat, hSat);
  else if (hasA) wa = at2(T.apOnly, hAp, d, 0);
  const s = ws + wa; if (s > 1) { ws /= s; wa /= s; }
  return { ws, wa };
}

// Ciel observé du lieu à partir des deux sources: satellite (valeurs brutes et heure de l'image) et aéroport avec
// observateur le plus proche (huitièmes en %, distance, heure), plus les couches observées et l'historique de l'aéroport.
export function fuseObserved({ goes, metar }, { elev = 0, lat = null, lng = null, sunUp = null, now = Date.now() } = {}) {
  const P = NOWCAST;
  // jour ou nuit à l'heure de chaque observation, comme le banc (soleil à plus de 5° à l'heure du relevé)
  const dayAt = (t) => (lat != null && lng != null ? sunElevation(t, lat, lng) > P.dayElev : sunUp !== false);
  let sat = null, ap = null, auto = null, layers = null, history = [];
  const srcs = [];
  if (goes && goes.point && !goes.outside && goes.scan) {
    const t = new Date(goes.scan).getTime();
    if ((now - t) / 60000 <= P.maxAgeMin) {
      const p = goes.point;
      // Tranches du satellite au-dessus de la mer (CF1 0 à 1,52 km, CF2 1,52 à 3,05, CF3 3,05 à 5,49, CF4 5,49 à 7,32, CF5 au-delà)
      // ramenées aux étages d'ICON et des aéroports (bas: jusqu'à 2 km au-dessus du sol, haut: au-delà d'environ 6 km)
      const cf = (p.cf || []).map((v) => (v || 0) / 100), f2 = clamp((elev + 2000 - 1524) / 1524, 0, 1);
      const sLow = cf.length === 5 ? Math.round(100 * u(cf[0], f2 * cf[1])) : p.low;
      const sMid = cf.length === 5 ? Math.round(100 * u((1 - f2) * cf[1], cf[2], 0.3 * cf[3])) : p.mid;
      const sHigh = cf.length === 5 ? Math.round(100 * u(0.7 * cf[3], cf[4])) : p.high;
      const blind = Math.round(100 * u((sMid || 0) / 100, (sHigh || 0) / 100)) >= P.satHighBlind;
      sat = { t, day: dayAt(t), tot: p.tcf, low: blind ? null : sLow, mid: sMid, high: sHigh, blind };
      srcs.push({ kind: 'sat', low: sLow, tot: p.tcf, blind, night: !sat.day });
    }
  }
  // Aéroport avec observateur le plus proche; une station automatique plus proche que lui ne sert qu'aux nuages bas
  const st = ((metar && metar.stations) || []).filter((s) => s.km < 150);
  const best = st.map((s) => ({ s, o: s.obs && s.obs[0] })).filter(({ o }) => o && o.human && o.tot != null && (now - new Date(o.t).getTime()) / 60000 <= P.maxAgeMin).sort((a, b) => a.s.km - b.s.km)[0];
  if (best) {
    const { s, o } = best;
    ap = { t: new Date(o.t).getTime(), km: s.km, tot: toPct(o.tot), low: toPct(o.low), id: s.id, name: s.name };
    ap.day = dayAt(ap.t);
    srcs.push({ kind: 'metar', id: s.id, name: s.name, km: s.km, t: o.t, tot: o.tot, low: o.low });
    const dz = (s.elev ?? null) != null ? s.elev - elev : 0; // base au-dessus de l'aéroport -> au-dessus du lieu
    if (s.km <= P.layersKm) layers = o.layers.filter((l) => l.baseM != null).map((l) => ({ type: l.type, octas: l.octas, base: Math.max(100, l.baseM + dz) }));
    history = s.obs.filter((x) => x.human && x.tot != null).map((x) => { const t = new Date(x.t).getTime(); return { t, day: dayAt(t), tot: toPct(x.tot), low: toPct(x.low) }; });
  }
  const a = st.map((s) => ({ s, o: s.obs && s.obs[0] })).filter(({ s, o }) => o && !o.human && o.low != null && s.km <= 120 && (!ap || s.km < ap.km) && (now - new Date(o.t).getTime()) / 60000 <= P.maxAgeMin).sort((x, y) => x.s.km - y.s.km)[0];
  if (a) { const t = new Date(a.o.t).getTime(); auto = { t, day: dayAt(t), km: a.s.km, low: toPct(a.o.low), id: a.s.id, name: a.s.name }; srcs.push({ kind: 'auto', id: a.s.id, name: a.s.name, km: a.s.km, low: a.o.low }); }
  if (!sat && !ap && !auto) return null;
  const day = sat ? sat.day : ap ? ap.day : auto.day;
  return { t: now, day, sat, ap, auto, layers, history, srcs };
}

// Applique l'observé aux rangées horaires formatées (src/weather/api.js) d'un même lieu. Champs touchés: cloudcover et
// cloudLow; garde les valeurs du modèle (cloudcoverModel, cloudLowModel) et ajoute obsW (poids total de l'observé, 0 à 1),
// obsInfo (texte de la légende) et obsLayers (couches de l'aéroport) aux heures corrigées.
export function applyNowcast(rows, obs, opts = {}) {
  if (!obs || !obs.t || !Array.isArray(rows) || !rows.length) return rows;
  const P = { ...NOWCAST, ...(opts.params || {}) }, tz = opts.tzOffsetMin;
  const msOf = (t) => (tz != null ? Date.parse(t + ':00Z') - tz * 60000 : new Date(t).getTime());
  const H = 3600000, hist = obs.history || [], ap = obs.ap, sat = obs.sat;
  // Historique de l'aéroport (heures passées, au plus 4 h): valeur observée la plus proche de l'heure de la rangée (20 min)
  const histAt = (t) => { let b = null; for (const x of hist) { const d = Math.abs(x.t - t); if (d <= 1200000 && (!b || d < Math.abs(b.t - t))) b = x; } return b; };
  const fields = { tot: 'cloudcover', low: 'cloudLow' };
  return rows.map((r) => {
    const tr = msOf(r.time);
    let S = null, A = null, hS = null, hA = null, day = obs.day, wAuto = 0;
    if (tr < obs.t - P.pastH * H) { const x = ap && histAt(tr); if (!x) return r; A = x; hA = 0; if (x.day != null) day = x.day; }
    else {
      if (sat) { S = sat; hS = Math.max(0, (tr - sat.t) / H); }
      if (ap) { A = ap; hA = Math.max(0, (tr - ap.t) / H); }
      if (obs.auto) wAuto = autoLowWeight(obs.auto.day, Math.max(0, (tr - obs.auto.t) / H), obs.auto.km);
    }
    const n = { ...r, cloudcoverModel: r.cloudcoverModel ?? r.cloudcover, cloudLowModel: r.cloudLowModel ?? r.cloudLow };
    let wMax = 0, wAp = 0;
    for (const [k, f] of Object.entries(fields)) {
      const m = r[f]; if (m == null) continue;
      const sv = S && S[k] != null ? calibSat(k, day, S[k]) : null, av = A && A[k] != null ? A[k] : null;
      const { ws, wa } = nowcastWeights(k, day, sv != null ? hS : null, av != null ? hA : null, ap ? ap.km : null);
      const wu = k === 'low' ? wAuto : 0;
      if (ws + wa + wu < 0.03) continue;
      let v = m + ws * ((sv ?? m) - m) + wa * ((av ?? m) - m);
      if (wu > 0) {
        // station automatique, par-dessus (banc: poids appris sur la correction déjà faite); elle ne voit que les nuages bas: le
        // total suit en gardant la part d'altitude d'avant elle (sinon la 3D changerait l'écart en nuages moyens et hauts)
        const T0 = n.cloudcover ?? r.cloudcover, L0 = clamp(v / 100, 0, 1);
        v += wu * (obs.auto.low - v);
        if (T0 != null) { const Lc = Math.min(L0, NOWCAST.lowOpaque / 100 - 0.01), U = clamp((T0 / 100 - Lc) / (1 - Lc), 0, 1); n.cloudcover = Math.round(100 * (1 - (1 - clamp(v / 100, 0, 1)) * (1 - U))); }
      }
      n[f] = Math.round(clamp(v, 0, 100));
      wMax = Math.max(wMax, ws + wa, wu); if (k === 'tot') wAp = wa;
    }
    if (wMax < 0.03) return r;
    n.obsW = Math.round(wMax * 100) / 100;
    // cohérence: les nuages bas ne dépassent pas le total
    if (n.cloudLow != null && n.cloudcover != null) n.cloudLow = Math.min(n.cloudLow, n.cloudcover);
    if (tr >= obs.t - P.pastH * H && wAp >= 0.3 && obs.layers) n.obsLayers = obs.layers;
    if (tr >= obs.t - P.pastH * H && wMax >= 0.25) n.obsInfo = obsText(obs);
    return n;
  });
}

// Nuages moyens et hauts de la 3D accordés au total et aux nuages bas (recouvrement au hasard:
// total = 1 - (1 - bas)(1 - moyens et hauts)). Les deux étages gardent leur proportion; s'il n'y en avait pas, la part
// manquante va où le satellite en voit (sinon en haut). Rend { cloudMid, cloudHigh }. Gardes:
// - nuages bas à 95 % ou plus: le total ne dit rien des étages au-dessus (et l'écart total - bas, divisé par presque
//   rien, ferait apparaître un voile plein);
// - satellite qui ne voit rien en altitude: la part ajoutée par son étalonnage (petits nuages épars vus du sol) ne va pas
//   en altitude, les étages ne montent pas au-dessus de la prévision.
export function upperFromTotal(mid, high, tot, low, sat = null) {
  if (tot == null || (low ?? 0) >= NOWCAST.lowOpaque) return { cloudMid: mid, cloudHigh: high };
  const L = clamp((low ?? 0) / 100, 0, 0.95), T = clamp(tot / 100, 0, 1);
  let M = (mid ?? 0) / 100, Hh = (high ?? 0) / 100;
  const U0 = u(M, Hh), satUp = sat && sat.mid != null && sat.high != null ? u(sat.mid / 100, sat.high / 100) : null;
  let U1 = clamp((T - L) / (1 - L), 0, 1);
  if (satUp != null && satUp < 0.02) U1 = Math.min(U1, U0);
  if (U0 < 0.02) {
    if (U1 < 0.02) return { cloudMid: Math.round(M * 100), cloudHigh: Math.round(Hh * 100) };
    const sm = sat && sat.mid != null ? sat.mid : 0, sh = sat && sat.high != null ? sat.high : 1, fm = sm + sh > 0 ? sm / (sm + sh) : 0;
    M = fm; Hh = 1 - fm; // proportion du satellite, puis même recouvrement au hasard que l'autre cas
  }
  // facteur commun k tel que u(kM, kH) = U1 (bissection; k plafonné pour qu'aucun étage ne dépasse 100 %)
  let lo = 0, hi = 1 / Math.max(M, Hh, 1e-6);
  for (let i = 0; i < 30; i++) { const k = (lo + hi) / 2; if (u(k * M, k * Hh) < U1) lo = k; else hi = k; }
  const k = (lo + hi) / 2;
  return { cloudMid: Math.round(clamp(k * M, 0, 1) * 100), cloudHigh: Math.round(clamp(k * Hh, 0, 1) * 100) };
}

const typeName = { ST: 'stratus', SC: 'stratocumulus', CU: 'cumulus', TCU: 'cumulus bourgeonnants', CB: 'cumulonimbus', SF: 'fractus', CF: 'fractus', NS: 'nimbostratus', AC: 'altocumulus', AS: 'altostratus', ACC: 'altocumulus', CI: 'cirrus', CS: 'cirrostratus', CC: 'cirrocumulus' };
export function obsText(obs) {
  const parts = [];
  const sat = obs.srcs.find((s) => s.kind === 'sat'), m = obs.srcs.find((s) => s.kind === 'metar');
  // la nuit, le satellite (infrarouge) se trompe souvent sur les nuages bas: l'aéroport seul s'il y en a un
  if (sat && !(sat.night && m)) parts.push(sat.blind ? `satellite : total ${sat.tot} % (nuages bas cachés par le voile d'altitude)` : `satellite : nuages bas ${sat.low} %, total ${sat.tot} %`);
  if (m) {
    const L = (obs.layers || []).filter((l) => l.octas > 0).map((l) => `${l.octas < 1 ? 'traces de' : Math.round(l.octas) + '/8'} ${typeName[l.type] || 'nuages'} à ${Math.round(l.base / 10) * 10} m`);
    const sky = L.length ? L.join(', ') : obs.layers && !(m.tot > 0) ? 'ciel dégagé' : `${Math.round(m.tot)}/8 du ciel couvert`;
    parts.push(`${m.name.replace(/,.*$/, '')} (${Math.round(m.km)} km) : ${sky}`);
  }
  const au = obs.srcs.find((s) => s.kind === 'auto');
  if (au) parts.push(`${String(au.name || au.id).replace(/,.*$/, '')} (${Math.round(au.km)} km, station automatique) : ${au.low > 0 ? Math.round(au.low) + '/8 de nuages bas' : 'pas de nuages bas'}`);
  return parts.length ? 'Observé ' + parts.join(' ; ') : null;
}

// Récupère les deux sources (ne rejette jamais: null si rien n'a répondu dans le délai).
const API_BASE = (typeof __MS_TARGET__ !== 'undefined' && __MS_TARGET__ === 'native') ? 'https://www.meteoshoot.com' : '';
export async function fetchObserved(lat, lng, timeoutMs = 4500) {
  const get = (u) => Promise.race([fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null), new Promise((res) => setTimeout(() => res(null), timeoutMs))]);
  const q = `lat=${lat.toFixed(3)}&lng=${lng.toFixed(3)}`;
  const [goes, metar] = await Promise.all([get(`${API_BASE}/api/goes?${q}`), get(`${API_BASE}/api/metar?${q}&r=150`)]);
  return goes || metar ? { goes, metar } : null;
}

// Adaptateur pour les tableaux horaires de fetchWeather (avant les statistiques du jour et l'indice AM/PM): corrige
// cloudcover et cloudcover_low, ajuste le direct (part de l'heure au soleil) selon les nuages bas corrigés, et ajoute des
// tableaux parallèles (valeurs du modèle, poids de l'observé, texte et couches observées pour la 3D).
export function applyObservedToHourly(hourly, raw, { lat, lng, tzOffsetMin = null, elev = 0, now = Date.now(), clearDir } = {}) {
  const n = hourly && hourly.time ? hourly.time.length : 0;
  hourly.cloudcoverModel = hourly.cloudcover.slice(); hourly.cloudLowModel = hourly.cloudcover_low.slice(); hourly.directIcon = hourly.direct_radiation.slice();
  hourly.obsW = new Array(n).fill(0); hourly.obsInfo = new Array(n).fill(null); hourly.obsLayers = new Array(n).fill(null);
  if (!raw || !n) return null;
  const sunUp = (() => { try { return clearDir ? clearDir(now + 1800000) > 3 : true; } catch (e) { return true; } })();
  const obs = fuseObserved(raw, { elev, lat, lng, sunUp, now });
  if (!obs) return null;
  const rows = hourly.time.map((t, i) => ({ time: t, cloudcover: hourly.cloudcover[i], cloudLow: hourly.cloudcover_low[i] }));
  const out = applyNowcast(rows, obs, { tzOffsetMin });
  const msOf = (t) => (tzOffsetMin != null ? Date.parse(t + ':00Z') - tzOffsetMin * 60000 : new Date(t).getTime());
  out.forEach((r, i) => {
    if (!r.obsW) return;
    const lowM = hourly.cloudLowIcon ? hourly.cloudLowIcon[i] : hourly.cloudcover_low[i], lowN = r.cloudLow;
    const totM = hourly.cloudcoverIcon ? hourly.cloudcoverIcon[i] : hourly.cloudcoverModel[i], totN = r.cloudcover;
    hourly.cloudcover[i] = r.cloudcover; hourly.cloudcover_low[i] = lowN;
    hourly.obsW[i] = r.obsW; hourly.obsInfo[i] = r.obsInfo || null; hourly.obsLayers[i] = r.obsLayers || null;
    // Direct: rapporté à la part du ciel libre de nuages bas, plafonné au ciel clair (rayonnement = moyenne de l'heure
    // précédente: on prend les nuages au milieu de cette heure)
    const d = hourly.direct_radiation[i];
    if (d != null && lowM != null && lowN != null && clearDir) {
      // part opaque du ciel: nuages bas, ou 60 % du total quand des nuages moyens ou hauts dominent (un voile d'altostratus
      // annoncé à tort coupe aussi le soleil); côté modèle, les nuages d'ICON (son direct a été calculé sous ceux-là), à
      // l'heure et à l'heure précédente (le rayonnement est la moyenne de l'heure précédente)
      const opq = (lo, to) => Math.max(lo ?? 0, 0.6 * (to ?? 0)) / 100;
      const lowMp = i > 0 ? (hourly.cloudLowIcon ? hourly.cloudLowIcon[i - 1] : hourly.cloudLowModel[i - 1]) : lowM, totMp = i > 0 ? (hourly.cloudcoverIcon ? hourly.cloudcoverIcon[i - 1] : hourly.cloudcoverModel[i - 1]) : totM;
      const lowNp = i > 0 ? hourly.cloudcover_low[i - 1] : lowN, totNp = i > 0 ? hourly.cloudcover[i - 1] : totN;
      // base: nuages d'ICON quand l'observé pèse lourd (son direct a été calculé sous ceux-là), glissant vers la prévision
      // combinée quand son poids s'efface; sinon le direct recevrait tout l'écart ICON / combinée puis retomberait d'un coup
      // à la fin de la correction
      const w = r.obsW, mix = (x, y) => (x == null ? y : y == null ? x : y + w * (x - y));
      const lowB = hourly.cloudLowModel[i], totB = hourly.cloudcoverModel[i], lowBp = i > 0 ? hourly.cloudLowModel[i - 1] : lowB, totBp = i > 0 ? hourly.cloudcoverModel[i - 1] : totB;
      const cm = (opq(mix(lowM, lowB), mix(totM, totB)) + opq(mix(lowMp, lowBp), mix(totMp, totBp))) / 2, cn = (opq(lowN, totN) + opq(lowNp, totNp)) / 2;
      const cap = clearDir(msOf(r.time));
      // décalage additif: le ciel libéré (ou couvert) de nuages bas donne (ou retire) le direct d'un ciel clair sur cette part;
      // un rapport ne remontait pas un direct nul (ICON couvert, ciel observé dégagé)
      if (cap > 3) hourly.direct_radiation[i] = Math.round(Math.max(0, Math.min(Math.max(cap, d), d + cap * (cm - cn))));
    }
  });
  return obs;
}
