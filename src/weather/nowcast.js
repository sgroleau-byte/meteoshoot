// Correction des premières heures par le ciel observé (15 octobre 2026). Le 11 et le 15 octobre, ICON annonçait 34 à 60 %
// de nuages bas en fin de journée alors que le satellite et l'aéroport voyaient un ciel presque dégagé depuis des heures.
// Ici, chaque heure à venir mélange le ciel observé et la prévision (déjà combinée, src/weather/blend.js), le poids de
// l'observé s'effaçant avec l'échéance: w·observé + (1 - w)·prévision, w = e^(-h/tau). Banc de vérification (12 mois,
// 33 aéroports avec observateur): c'est la forme qui gagne, devant l'écart reporté (additif) et le rapport. Sur le fond
// combiné, tau de 2,5 h (3 h pour les nuages bas): écart moyen au ciel observé de 12,4 points sans correction, 8,4 à
// +1 h, 10,9 à +2 h, 11,7 à +3 h, plus de gain au-delà de 5 h. Voir docs/nuages-verification.md.
//
// Sources (fonctions serveur): /api/goes (satellite GOES-19: fraction nuageuse par étage dans une boîte d'environ 30 km,
// toutes les 5 minutes, jusqu'à 50,7° N) et /api/metar (aéroports dans un rayon de 90 km: huitièmes par couche, base, type).
// Fonctions pures (sauf fetchObserved): le banc les importe telles quelles.

export const NOWCAST = {
  tauH: { tot: 2.5, low: 3, mid: 2.5, high: 2.5 }, // décroissance du poids de l'observé (heures): e^(-h/tau)
  pastH: 1,           // heure passée la plus récente: observé à poids plein (les plus anciennes: historique de l'aéroport)
  maxAgeMin: 80,      // observation plus vieille: ignorée
  metarKm: 40,        // portée d'un aéroport: poids e^(-d/40 km), coupé à 90 km
  satDay: 1.0,        // poids du satellite de jour, et la nuit (infrarouge seulement: nuages bas moins sûrs)
  satNight: 0.5,
  satHighBlind: 50,   // au-delà de ce % de nuages hauts, le satellite ne voit plus les nuages bas: on ne les corrige pas par lui
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const toPct = (octas) => (octas == null ? null : Math.round(octas * 12.5));

// Valeur observée par étage { tot, low, mid, high } (%) à partir des deux sources, avec leur poids, plus une description
// pour la légende de la 3D et les couches observées (type, base au-dessus du lieu, huitièmes).
export function fuseObserved({ goes, metar }, { elev = 0, sunUp = true, now = Date.now() } = {}) {
  const P = NOWCAST, acc = { tot: [0, 0], low: [0, 0], mid: [0, 0], high: [0, 0] };
  const add = (k, v, w) => { if (v == null || !(w > 0)) return; acc[k][0] += v * w; acc[k][1] += w; };
  // âge de la source: son poids décroît comme celui de l'observé dans les heures à venir (une observation d'aéroport d'il y a
  // 55 min ne vaut pas un satellite de 5 min); la fusion est datée de maintenant
  const fresh = (t) => Math.exp(-Math.max(0, (now - t) / 3600000) / 2.5);
  let layers = null, history = [], srcs = [];
  // Satellite
  if (goes && goes.point && !goes.outside && goes.scan) {
    const age = (now - new Date(goes.scan).getTime()) / 60000;
    if (age <= P.maxAgeMin) {
      const w = (sunUp ? P.satDay : P.satNight) * fresh(new Date(goes.scan).getTime()), p = goes.point;
      // Tranches du satellite au-dessus de la mer (CF1 0 à 1,52 km, CF2 1,52 à 3,05, CF3 3,05 à 5,49, CF4 5,49 à 7,32, CF5 au-delà)
      // ramenées aux étages d'ICON et des aéroports (bas: jusqu'à 2 km au-dessus du sol, haut: au-delà d'environ 6 km)
      const u = (...a) => 1 - a.reduce((q, v) => q * (1 - v), 1);
      const cf = (p.cf || []).map((v) => (v || 0) / 100), f2 = Math.max(0, Math.min(1, (elev + 2000 - 1524) / 1524));
      const sLow = cf.length === 5 ? Math.round(100 * u(cf[0], f2 * cf[1])) : p.low;
      const sMid = cf.length === 5 ? Math.round(100 * u((1 - f2) * cf[1], cf[2], 0.3 * cf[3])) : p.mid;
      const sHigh = cf.length === 5 ? Math.round(100 * u(0.7 * cf[3], cf[4])) : p.high;
      add('tot', p.tcf, w); add('mid', sMid, w * 0.8); add('high', sHigh, w * 0.8);
      // Sous une couche moyenne ou haute assez fournie, le satellite (qui voit le dessus) ne sait rien des nuages bas
      if (Math.round(100 * u(sMid / 100, sHigh / 100)) < P.satHighBlind) add('low', sLow, w);
      p.lowT = sLow; p.blind = Math.round(100 * u(sMid / 100, sHigh / 100)) >= P.satHighBlind;
      srcs.push({ kind: 'sat', low: p.lowT, tot: p.tcf, blind: p.blind, night: !sunUp });
    }
  }
  // Aéroports: humains d'abord (ils voient tout le ciel et donnent les huitièmes); automatiques pour les nuages bas seulement
  const st = (metar && metar.stations) || [];
  let best = null;
  for (const s of st) {
    const o = s.obs && s.obs[0]; if (!o) continue;
    const age = (now - new Date(o.t).getTime()) / 60000; if (age > P.maxAgeMin || s.km > 90) continue;
    const w = Math.exp(-s.km / P.metarKm) * fresh(new Date(o.t).getTime());
    if (o.human && o.tot != null) {
      add('tot', toPct(o.tot), w); add('low', toPct(o.low), w); add('mid', toPct(o.mid), w * 0.7); add('high', toPct(o.high), w * 0.7);
      if (!best || s.km < best.s.km) best = { s, o };
    } else if (o.low != null) add('low', toPct(o.low), w * 0.6);
  }
  // Couches (type, base) seulement d'un aéroport assez proche: au-delà de 40 km, son ciel n'est plus celui du lieu
  if (best && best.s.km > 40) best = { ...best, far: true };
  if (best) {
    srcs.push({ kind: 'metar', id: best.s.id, name: best.s.name, km: best.s.km, t: best.o.t, tot: best.o.tot, low: best.o.low });
    const dz = (best.s.elev ?? null) != null ? best.s.elev - elev : 0; // base au-dessus de l'aéroport -> au-dessus du lieu
    layers = best.far ? null : best.o.layers.filter((l) => l.baseM != null).map((l) => ({ type: l.type, octas: l.octas, base: Math.max(100, l.baseM + dz) }));
    const wb = Math.exp(-best.s.km / P.metarKm);
    history = best.s.obs.filter((o) => o.human && o.tot != null).map((o) => ({ t: new Date(o.t).getTime(), tot: toPct(o.tot), low: toPct(o.low), mid: toPct(o.mid), high: toPct(o.high), totW: wb, lowW: wb, midW: wb * 0.7, highW: wb * 0.7 }));
  }
  const out = {}; let any = false;
  for (const k of Object.keys(acc)) { out[k] = acc[k][1] > 0 ? acc[k][0] / acc[k][1] : null; out[k + 'W'] = acc[k][1]; if (out[k] != null) any = true; }
  if (!any) return null;
  return { ...out, t: now, layers, history, srcs };
}

// Applique l'observé aux rangées horaires formatées (src/weather/api.js) d'un même lieu. Champs touchés: cloudcover,
// cloudLow, et pour la 3D cloudMid/cloudHigh s'ils existent; garde les valeurs du modèle (cloudcoverModel, cloudLowModel)
// et ajoute obsW (poids de l'observé, 0 à 1) et obsInfo (texte de la légende) aux heures corrigées.
export function applyNowcast(rows, obs, opts = {}) {
  if (!obs || !obs.t || !Array.isArray(rows) || !rows.length) return rows;
  const P = { ...NOWCAST, ...(opts.params || {}) }, tz = opts.tzOffsetMin;
  const msOf = (t) => (tz != null ? Date.parse(t + ':00Z') - tz * 60000 : new Date(t).getTime());
  // Valeur du modèle à l'heure de l'observation (interpolée entre les deux heures pleines voisines)
  const ts = rows.map((r) => msOf(r.time));
  const at = (k) => {
    let i = ts.findIndex((t) => t > obs.t); if (i <= 0) return i === 0 ? rows[0][k] : rows[rows.length - 1][k];
    const a = rows[i - 1][k], b = rows[i][k]; if (a == null || b == null) return a ?? b;
    return a + (b - a) * (obs.t - ts[i - 1]) / (ts[i] - ts[i - 1]);
  };
  const keys = { tot: 'cloudcover', low: 'cloudLow', mid: 'cloudMid', high: 'cloudHigh' };
  // Historique de l'aéroport (heures passées, au plus 4 h): valeur observée la plus proche de l'heure de la rangée (20 min)
  const hist = obs.history || [];
  const histAt = (t) => { let b = null; for (const x of hist) { const d = Math.abs(x.t - t); if (d <= 1200000 && (!b || d < Math.abs(b.t - t))) b = x; } return b; };
  return rows.map((r, i) => {
    const h = (ts[i] - obs.t) / 3600000;
    let src = obs, w0 = 1;
    if (h < -P.pastH) { const x = histAt(ts[i]); if (!x) return r; src = x; w0 = 1; }
    const n = { ...r, cloudcoverModel: r.cloudcoverModel ?? r.cloudcover, cloudLowModel: r.cloudLowModel ?? r.cloudLow };
    let wMax = 0;
    for (const [k, f] of Object.entries(keys)) {
      if (src[k] == null || r[f] == null) continue;
      const tau = typeof P.tauH === 'number' ? P.tauH : P.tauH[k];
      // poids de la source pour cet étage (un aéroport à 60 km pèse moins qu'un satellite au-dessus du lieu), puis échéance
      const w = (h <= 0 ? w0 : Math.exp(-h / tau)) * clamp(src[k + 'W'] ?? 1, 0, 1);
      if (w < 0.03) continue;
      n[f] = Math.round(clamp(w * src[k] + (1 - w) * r[f], 0, 100)); wMax = Math.max(wMax, w);
    }
    if (wMax < 0.03) return r;
    n.obsW = Math.round(wMax * 100) / 100;
    // cohérence: un total observé borne chaque étage (une boîte vue à 45 % sans nuages d'en haut ne peut pas avoir 70 % de
    // nuages bas); sans total observé, le total couvre au moins chaque étage
    if (src.tot != null && n.cloudcover != null) { for (const f of ['cloudLow', 'cloudMid', 'cloudHigh']) if (n[f] != null) n[f] = Math.min(n[f], n.cloudcover); }
    else n.cloudcover = Math.max(n.cloudcover ?? 0, n.cloudLow ?? 0, n.cloudMid ?? 0, n.cloudHigh ?? 0);
    if (h >= -P.pastH && wMax >= 0.5 && obs.layers) n.obsLayers = obs.layers;
    if (h >= -P.pastH && wMax >= 0.3) n.obsInfo = obsText(obs);
    return n;
  });
}

const typeName = { ST: 'stratus', SC: 'stratocumulus', CU: 'cumulus', TCU: 'cumulus bourgeonnants', CB: 'cumulonimbus', SF: 'fractus', CF: 'fractus', NS: 'nimbostratus', AC: 'altocumulus', AS: 'altostratus', ACC: 'altocumulus', CI: 'cirrus', CS: 'cirrostratus', CC: 'cirrocumulus' };
export function obsText(obs) {
  const parts = [];
  const sat = obs.srcs.find((s) => s.kind === 'sat'), m = obs.srcs.find((s) => s.kind === 'metar');
  // la nuit, le satellite (infrarouge) se trompe souvent sur les nuages bas: l'aéroport seul s'il y en a un
  if (sat && !(sat.night && m)) parts.push(sat.blind ? `satellite : total ${sat.tot} % (nuages bas cachés par le voile d'altitude)` : `satellite : nuages bas ${sat.low} %, total ${sat.tot} %`);
  if (m) {
    const L = (obs.layers || []).filter((l) => l.octas > 0).map((l) => `${l.octas < 1 ? 'traces de' : Math.round(l.octas) + '/8'} ${typeName[l.type] || 'nuages'} à ${Math.round(l.base / 10) * 10} m`);
    parts.push(`${m.name.replace(/,.*$/, '')} (${Math.round(m.km)} km) : ${L.length ? L.join(', ') : 'ciel dégagé'}`);
  }
  return parts.length ? 'Observé ' + parts.join(' ; ') : null;
}

// Récupère les deux sources (ne rejette jamais: null si rien n'a répondu dans le délai).
const API_BASE = (typeof __MS_TARGET__ !== 'undefined' && __MS_TARGET__ === 'native') ? 'https://www.meteoshoot.com' : '';
export async function fetchObserved(lat, lng, timeoutMs = 4500) {
  const get = (u) => Promise.race([fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null), new Promise((res) => setTimeout(() => res(null), timeoutMs))]);
  const q = `lat=${lat.toFixed(3)}&lng=${lng.toFixed(3)}`;
  const [goes, metar] = await Promise.all([get(`${API_BASE}/api/goes?${q}`), get(`${API_BASE}/api/metar?${q}`)]);
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
  const obs = fuseObserved(raw, { elev, sunUp, now });
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
      const cm = (opq(lowM, totM) + opq(lowMp, totMp)) / 2, cn = (opq(lowN, totN) + opq(lowNp, totNp)) / 2;
      const cap = clearDir(msOf(r.time));
      // décalage additif: le ciel libéré (ou couvert) de nuages bas donne (ou retire) le direct d'un ciel clair sur cette part;
      // un rapport ne remontait pas un direct nul (ICON couvert, ciel observé dégagé)
      if (cap > 3) hourly.direct_radiation[i] = Math.round(Math.max(0, Math.min(Math.max(cap, d), d + cap * (cm - cn))));
    }
  });
  return obs;
}
