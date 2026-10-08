// Arbres d'après le LiDAR de Ressources naturelles Canada (8 octobre 2026): position, hauteur, couronne et essence
// (conifère ou feuillu) de chaque arbre autour du projet.
//
// Les cartes (Overture, OpenStreetMap) n'ont que quelques arbres isolés et des boisés tracés à grands traits: un lot
// résidentiel en forêt, comme à Stoneham, n'y est qu'une pelouse. Le LiDAR, lui, voit chaque cime: la surface (dsm)
// moins le sol nu (dtm) donne la hauteur de ce qui dépasse du sol au mètre près. On y cherche les sommets (maxima
// locaux), on écarte les toits (empreintes des bâtiments, surfaces lisses) et on mesure la couronne.
//
// Conifère ou feuillu: le LiDAR seul le dit mal. Trois sources, de la plus précise à la plus large:
// 1) l'inventaire des arbres publics de la Ville de Québec (essence de chaque arbre de rue et de parc), apparié à la
//    cime la plus proche;
// 2) la carte écoforestière du Québec (ministère des Ressources naturelles et des Forêts): peuplements résineux,
//    mélangés ou feuillus, qui couvre aussi les boisés résidentiels;
// 3) la forme de la cime (pointue et étroite pour un sapin ou une épinette, en dôme pour un érable), qui affine.
// Ailleurs au Canada: la forme seule.
import { toLCC } from './terrain.js';
import { items, window1m } from './heights.js';

export const R_TREES = 350; // m autour du projet
const UA = 'MeteoShoot (www.meteoshoot.com)';
const MIN_H = 3; // m: en dessous, arbuste ou haie basse
const MAX_TREES = 4000;
// Hauteur maximale d'un arbre: au-delà, pylône, ligne électrique ou bord de toit de tour (mesuré: 43 à 84 m à Ottawa,
// Outremont, Limoilou). Les plus grands arbres mesurés dans l'Est: 31,5 m (Sillery); l'Ouest a des géants de 60 m et plus.
const HMAX_EAST = 38, HMAX_WEST = 100;
const ECOFOR = 'https://geoegl.msp.gouv.qc.ca/ws/mffpecofor.fcgi';
const VDQ = 'https://www.donneesquebec.ca/recherche/api/3/action/datastore_search_sql';
const VDQ_RES = '13a51853-a5b5-4add-8791-02ccba5c1be7'; // Arbres répertoriés (Ville de Québec, CC-BY 4.0)

// Repère local (x est, n nord, en mètres autour de lat, lng) vers les pixels d'une fenêtre LiDAR (Lambert du Canada),
// et retour. Sur 350 m, la projection est affine à quelques millimètres près (la rotation, d'environ 15 degrés au
// Québec, est comprise).
export function frame(lat, lng, win) {
  const mLat = 111320, mLng = 111320 * Math.cos(lat * Math.PI / 180), d = 100;
  const P = (x, n) => { const [E, N] = toLCC(lat + n / mLat, lng + x / mLng); return [(E - win.x0) / win.res - win.c0 - 0.5, (win.y0 - N) / win.res - win.r0 - 0.5]; };
  const o = P(0, 0), ex = P(d, 0), en = P(0, d);
  const a = (ex[0] - o[0]) / d, b = (en[0] - o[0]) / d, c = (ex[1] - o[1]) / d, e = (en[1] - o[1]) / d, det = a * e - b * c;
  return {
    toPx: (x, n) => [o[0] + a * x + b * n, o[1] + c * x + e * n],
    toLocal: (i, j) => { const u = i - o[0], v = j - o[1]; return [(e * u - b * v) / det, (-c * u + a * v) / det]; },
  };
}

// Pixels couverts par les bâtiments, élargis de pad pixels (le relevé mêle toit et sol sur le bord, et un auvent ou une
// galerie dépasse souvent de l'empreinte).
function buildingMask(bld, fr, W, H, pad) {
  const m = new Uint8Array(W * H);
  for (const b of bld) {
    const ring = b[0].map(([x, n]) => fr.toPx(x, n));
    let j0 = Infinity, j1 = -Infinity;
    for (const p of ring) { j0 = Math.min(j0, p[1]); j1 = Math.max(j1, p[1]); }
    j0 = Math.max(0, Math.ceil(j0)); j1 = Math.min(H - 1, Math.floor(j1));
    for (let j = j0; j <= j1; j++) {
      const xs = [];
      for (let k = 0, l = ring.length - 1; k < ring.length; l = k++) { const A = ring[k], B = ring[l]; if ((A[1] > j) !== (B[1] > j)) xs.push(A[0] + (j - A[1]) * (B[0] - A[0]) / (B[1] - A[1])); }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let i = Math.max(0, Math.ceil(xs[k])); i <= Math.min(W - 1, Math.floor(xs[k + 1])); i++) m[j * W + i] = 1;
    }
  }
  if (!pad) return m;
  const out = new Uint8Array(m);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (!m[j * W + i]) continue;
    for (let dj = -pad; dj <= pad; dj++) for (let di = -pad; di <= pad; di++) { const u = i + di, v = j + dj; if (u >= 0 && v >= 0 && u < W && v < H && di * di + dj * dj <= pad * pad) out[v * W + u] = 1; }
  }
  return out;
}

// Toits pris pour des cimes (8 octobre 2026): bâtiments absents d'Overture (maisons neuves, garages, remises, et même
// un immeuble de 60 m de long à Limoilou, 14 « arbres » sur son toit), et bords de toit qui débordent du masque quand
// l'empreinte est décalée (1,1 à 1,5 m en médiane, jusqu'à 3 m). Trois indices, chacun borné en hauteur pour ne pas
// toucher aux grandes cimes:
//  - pans plans: le quart au moins de la couronne attribuée au sommet (partage des eaux) tombe dans de grands pans
//    plans (30 pixels et plus, plan 3 x 3 à moins de 0,15 m, pente continue d'un pixel à l'autre); 14 m au plus;
//  - plateau: sur 5 des 16 directions au moins, la surface reste à 0,5 m du sommet sur 4 m (faîte, toit plat), avec le
//    sol à 5 m au plus (pas une canopée fermée); 12 m au plus;
//  - toit voisin: une direction rejoint le masque des bâtiments en 4 m sans descendre de plus de 0,7 m, et le sommet ne
//    dépasse pas de plus de 1 m les grands pans plans du toit masqué voisin (90e centile à 5 m); 16 m au plus.
// Mesuré sur 6 quartiers (Stoneham, Limoilou, Sillery, Montcalm, Outremont, Annexe de Toronto): 52 % des sommets de toits
// non cartographiés et 72 % des bords de toits décalés retirés; 99,4 % des arbres de l'inventaire de la Ville de Québec
// gardés (98,1 % de ceux à moins de 5 m d'un bâtiment), 99,3 % de la forêt de Stoneham. Pensé pour le relevé à 1 m.
// raw: hauteur de canopée brute (m), mask: bâtiments, tops: sommets (i, j, h), lab: partage des eaux (k + 1 par sommet).
// Retourne un Uint8Array: 1 pour un sommet de toit.
function roofTops(raw, W, H, mask, tops, lab, hmax) {
  const N = W * H, gx = new Float32Array(N), gy = new Float32Array(N), pl = new Uint8Array(N);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const k = y * W + x; if (!(raw[k] > 2)) continue;
    let s = 0, sx = 0, sy = 0, ss = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const z = raw[k + dy * W + dx]; s += z; sx += dx * z; sy += dy * z; ss += z * z; }
    const a = s / 9, b = sx / 6, c = sy / 6;
    if (ss - 9 * a * a - 6 * b * b - 6 * c * c < 9 * 0.15 * 0.15) { pl[k] = 1; gx[k] = b; gy[k] = c; } // écart type du plan < 0,15 m
  }
  // Pans: pixels plans voisins (4) de pentes proches (écarts en x et en y de moins de 0,2 au total).
  const par = new Int32Array(N); for (let k = 0; k < N; k++) par[k] = k;
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const join = (k, q) => { if (pl[q] && Math.abs(gx[k] - gx[q]) + Math.abs(gy[k] - gy[q]) < 0.2) { const a = find(k), b = find(q); if (a !== b) par[a] = b; } };
  for (let k = 0; k < N; k++) { if (!pl[k]) continue; if (k % W !== W - 1) join(k, k + 1); if (k + W < N) join(k, k + W); }
  const size = new Int32Array(N); for (let k = 0; k < N; k++) if (pl[k]) size[find(k)]++;
  const big = new Uint8Array(N); for (let k = 0; k < N; k++) if (pl[k] && size[find(k)] >= 30) big[k] = 1;
  const at = (u, v) => (u < 0 || v < 0 || u >= W || v >= H ? 0 : raw[v * W + u]);
  const out = new Uint8Array(tops.length);
  tops.forEach((t, ti) => {
    const { i: x, j: y, h } = t;
    if (h > hmax) { out[ti] = 1; return; } // plus haut que tout arbre de la région: pylône, fil, toit de tour
    if (h > 16 && h <= 30) return; // grandes cimes: intouchées; au-delà de 30 m, toits de tours (pans plans, toit voisin)
    // Pans plans dans la couronne du sommet.
    let n = 0, b = 0;
    for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) { const u = x + dx, v = y + dy; if (u < 1 || v < 1 || u >= W - 1 || v >= H - 1) continue; const k = v * W + u; if (lab[k] !== ti + 1) continue; n++; b += big[k]; }
    if ((h <= 14 || h > 30) && n && b / n >= 0.25) { out[ti] = 1; return; }
    // Rayons: plateau, sol, lien avec le toit masqué.
    const low = Math.max(1.5, 0.35 * h);
    let flat = 0, gnd = 9, link = 0;
    for (let a = 0; a < 16; a++) {
      const ca = Math.cos(a * Math.PI / 8), sa = Math.sin(a * Math.PI / 8);
      let f = true;
      for (let d = 1; d <= 8; d++) {
        const z = at(Math.round(x + ca * d), Math.round(y + sa * d));
        if (d <= 4 && z < h - 0.5) f = false;
        if (z < low) { gnd = Math.min(gnd, d); break; }
      }
      if (f) flat++;
      let mn = Infinity;
      for (let d = 1; d <= 4; d++) {
        const u = Math.round(x + ca * d), v = Math.round(y + sa * d);
        if (u < 0 || v < 0 || u >= W || v >= H) break;
        mn = Math.min(mn, raw[v * W + u]);
        if (mask[v * W + u]) { if (mn >= h - 0.7) link++; break; }
      }
    }
    if (h <= 12 && flat >= 5 && gnd <= 5) { out[ti] = 1; return; }
    if (!link) return;
    const zs = [];
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) { if (dx * dx + dy * dy > 25) continue; const u = x + dx, v = y + dy; if (u < 0 || v < 0 || u >= W || v >= H) continue; const k = v * W + u; if (mask[k] && big[k]) zs.push(raw[k]); }
    if (zs.length < 4) return;
    zs.sort((p, q) => p - q);
    if (h <= zs[Math.floor(zs.length * 0.9)] + 1) out[ti] = 1;
  });
  return out;
}

// Cimes dans une hauteur de canopée (surface moins sol) raw de W x H pixels de res mètres; mask: bâtiments.
// Retourne { tops: [{ i, j, h, cr, ca, ci, cj, prof }], chm, roofMask } en pixels: h hauteur (m), cr rayon à 55 % de
// la hauteur (m), ca rayon de la couronne d'après sa surface (m), (ci, cj) centre de la couronne, prof profil de la cime
// près du sommet; roofMask: masque des bâtiments plus les toits pris pour des cimes (null s'il n'y en a pas).
export function crowns(raw, W, H, res, mask, hmax = HMAX_EAST) {
  // Lissage 3 x 3 au mètre (bruit des points laser), aucun à 2 m (le noyau couvrirait 6 m).
  let chm = raw;
  if (res <= 1.01) {
    chm = new Float32Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += raw[(y + dy) * W + x + dx] * (dx || dy ? (dx && dy ? 1 : 2) : 4);
      chm[y * W + x] = s / 16;
    }
  }
  const rough = (x, y) => { const v = raw[y * W + x]; let r = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) r = Math.max(r, Math.abs(raw[(y + dy) * W + x + dx] - v)); return r; };
  const out = [], B = Math.ceil(6 / res);
  for (let y = B; y < H - B; y++) for (let x = B; x < W - B; x++) {
    const k = y * W + x, h = chm[k];
    if (!(h >= MIN_H) || mask[k]) continue;
    // Sommet: le plus haut point dans un rayon qui croît avec la hauteur (1,5 à 4 m: une grande cime a plusieurs bosses).
    const r = Math.max(1.5, Math.min(4, Math.max(1.5, 1.2 + 0.06 * h)) / res), ri = Math.ceil(r); // en pixels; au moins un voisin comparé à 2 m
    let top = true;
    for (let dy = -ri; dy <= ri && top; dy++) for (let dx = -ri; dx <= ri; dx++) {
      if (dx * dx + dy * dy > r * r || (!dx && !dy)) continue;
      const v = chm[(y + dy) * W + x + dx];
      if (v > h || (v === h && (dy < 0 || (dy === 0 && dx < 0)))) { top = false; break; } // à égalité, un seul sommet
    }
    if (!top) continue;
    // Toit non cartographié, remise, camion: surface lisse tout autour du sommet; une cime est rugueuse.
    let rs = 0, rn = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { rs += rough(x + dx, y + dy); rn++; }
    if (rs / rn < 0.35) continue;
    // Couronne: dans 8 directions, jusqu'à 55 % de la hauteur, une remontée (arbre voisin) ou un bâtiment, 9 m au plus.
    const ds = [];
    for (let a = 0; a < 8; a++) {
      const ca = Math.cos(a * Math.PI / 4), sa = Math.sin(a * Math.PI / 4); let prev = h, d = 1;
      for (; d * res <= 9; d++) {
        const xi = Math.round(x + ca * d), yi = Math.round(y + sa * d);
        if (xi < 0 || yi < 0 || xi >= W || yi >= H) break;
        const q = yi * W + xi, v = chm[q];
        if (mask[q] || v < 0.55 * h || v > prev + 0.4) break;
        prev = v;
      }
      ds.push((d - 0.5) * res);
    }
    ds.sort((p, q) => p - q);
    const cr = ds[4];
    if (cr < 1) continue; // fil électrique, poteau: étroit dans presque toutes les directions
    // Hauteur: le plus haut point brut près du sommet (le lissage l'abaisse), sans pic isolé (oiseau, fil).
    let hm = h; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) hm = Math.max(hm, Math.min(raw[(y + dy) * W + x + dx], h + 1.5));
    // Profil de la cime: chute moyenne (16 directions) à 1, 2 et 3 m du sommet, en part de la hauteur.
    const prof = [];
    for (let d = 1; d <= 3; d++) {
      let s = 0, c = 0;
      for (let a = 0; a < 16; a++) { const xi = Math.round(x + Math.cos(a * Math.PI / 8) * d / res), yi = Math.round(y + Math.sin(a * Math.PI / 8) * d / res); if (xi < 0 || yi < 0 || xi >= W || yi >= H) continue; s += hm - raw[yi * W + xi]; c++; }
      prof.push(c ? s / c / hm : 0);
    }
    out.push({ i: x, j: y, h: hm, cr, prof });
  }
  // Couronne réelle: chaque pixel de canopée revient à la cime qu'il rejoint en montant (partage des eaux, du plus haut
  // au plus bas), tant qu'il reste au-dessus du tiers de sa hauteur et à moins de 12 m. En forêt fermée, les couronnes
  // se partagent ainsi toute la canopée, sans trous ni chevauchement; le rayon cr à 55 % de la hauteur, lui, déborde
  // sur les voisins (il ne sert qu'à reconnaître la forme).
  const lab = new Int32Array(W * H), px = [];
  out.forEach((t, k) => { lab[t.j * W + t.i] = k + 1; });
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const k = y * W + x; if (chm[k] >= 2 && !mask[k] && !lab[k]) px.push(k); }
  px.sort((a, b) => chm[b] - chm[a]);
  const area = new Float64Array(out.length + 1).fill(1), reach = 12 / res, si = new Float64Array(out.length + 1), sj = new Float64Array(out.length + 1);
  out.forEach((t, k) => { si[k + 1] = t.i; sj[k + 1] = t.j; });
  for (const k of px) {
    let best = 0, bv = -1;
    for (const d of [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1]) { const l = lab[k + d]; if (l && chm[k + d] > bv) { bv = chm[k + d]; best = l; } }
    if (!best) continue;
    const t = out[best - 1], x = k % W, y = (k - x) / W;
    if (chm[k] < t.h / 3 || Math.hypot(x - t.i, y - t.j) > reach) continue;
    lab[k] = best; area[best]++; si[best] += x; sj[best] += y;
  }
  out.forEach((t, k) => { t.ca = Math.sqrt(area[k + 1] / Math.PI) * res; t.ci = si[k + 1] / area[k + 1]; t.cj = sj[k + 1] / area[k + 1]; });
  // Toits pris pour des cimes (bâtiments absents d'Overture, bords de toits décalés): retirés (relevé à 1 m seulement);
  // leurs pixels rejoignent le masque des bâtiments pour la canopée (pas de sous-bois sur un toit).
  const roof = res <= 1.01 ? roofTops(raw, W, H, mask, out, lab, hmax) : Uint8Array.from(out, (t) => (t.h > hmax ? 1 : 0));
  let roofMask = null;
  if (roof && roof.some(Boolean)) {
    roofMask = new Uint8Array(mask);
    for (let k = 0; k < W * H; k++) { const l = lab[k]; if (l && roof[l - 1]) roofMask[k] = 1; }
    out.forEach((t, k) => { if (roof[k]) roofMask[t.j * W + t.i] = 1; });
  }
  return { tops: roof ? out.filter((_, k) => !roof[k]) : out, chm, roofMask };
}

// Canopée continue des boisés (8 octobre 2026), pour le sous-bois dessiné sous les cimes: grille locale de CRES mètres
// (x est, n nord) de la hauteur de canopée, gardée seulement en massif (ouverture morphologique: un arbre isolé, une
// haie ou un alignement disparaissent) et, là où la carte écoforestière du Québec existe, dans un de ses peuplements (en
// ville, les arbres de rue qui se touchent n'ont pas de sous-bois: trottoirs et pelouses dessous). Hors de la carte (hors
// du Québec, même dans un cadre qui touche la frontière), massifs plus larges seulement. Case par case: à Ottawa, un
// polygone non forestier de Gatineau ne doit pas effacer l'escarpement boisé. Valeurs en demi-mètres sur un octet, zéros
// compressés par plages (0 puis la longueur), en base 64.
const CRES = 3;
// stands: peuplements forestiers; cover: tous les polygones de la carte (forestiers ou non) dans le cadre.
function canopyGrid(chm, mask, W, H, fr, stands, cover, hmax = HMAX_EAST) {
  const N = Math.round(2 * R_TREES / CRES), g = new Uint8Array(N * N);
  const fill = (rings) => { // cases dont le centre est dans un des anneaux (remplissage par lignes, comme les empreintes)
    const m = new Uint8Array(N * N);
    for (const r of rings) {
      const ring = r.map(([x, n]) => [(x + R_TREES) / CRES - 0.5, (n + R_TREES) / CRES - 0.5]);
      let j0 = Infinity, j1 = -Infinity; for (const p of ring) { j0 = Math.min(j0, p[1]); j1 = Math.max(j1, p[1]); }
      for (let j = Math.max(0, Math.ceil(j0)); j <= Math.min(N - 1, Math.floor(j1)); j++) {
        const xs = [];
        for (let k = 0, l = ring.length - 1; k < ring.length; l = k++) { const A = ring[k], B = ring[l]; if ((A[1] > j) !== (B[1] > j)) xs.push(A[0] + (j - A[1]) * (B[0] - A[0]) / (B[1] - A[1])); }
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) for (let i = Math.max(0, Math.ceil(xs[k])); i <= Math.min(N - 1, Math.floor(xs[k + 1])); i++) m[j * N + i] = 1;
      }
    }
    return m;
  };
  const mapped = cover && cover.length ? fill(cover) : null, forest = mapped ? fill(stands.map((s) => s.ring)) : null;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -R_TREES + (i + 0.5) * CRES, n = -R_TREES + (j + 0.5) * CRES;
    if (x * x + n * n > R_TREES * R_TREES || (mapped && mapped[j * N + i] && !forest[j * N + i])) continue;
    const [pi, pj] = fr.toPx(x, n), u = Math.round(pi), v = Math.round(pj);
    let s = 0, c = 0;
    for (let dv = -1; dv <= 1; dv++) for (let du = -1; du <= 1; du++) { const a = u + du, b = v + dv; if (a < 0 || b < 0 || a >= W || b >= H) continue; const k = b * W + a; s += mask[k] || chm[k] > hmax ? 0 : chm[k]; c++; }
    const h = c ? s / c : 0;
    if (h >= MIN_H) g[j * N + i] = Math.min(255, Math.round(h * 2));
  }
  // Ouverture: le cœur du massif (tout le disque couvert), puis regonflé d'autant; rayon 2 cases (6 m) dans la carte des
  // peuplements, 4 (12 m) ailleurs.
  const keep = new Uint8Array(N * N);
  const open = (RO, sel) => {
    const D = []; for (let b = -RO; b <= RO; b++) for (let a = -RO; a <= RO; a++) if (a * a + b * b <= RO * RO + 1) D.push([a, b]);
    const on = (q) => g[q] && sel(q), core = new Uint8Array(N * N);
    for (let j = RO; j < N - RO; j++) for (let i = RO; i < N - RO; i++) if (D.every(([a, b]) => on((j + b) * N + i + a))) core[j * N + i] = 1;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (core[j * N + i]) for (const [a, b] of D) { const q = (j + b) * N + i + a; if (on(q)) keep[q] = 1; }
  };
  if (mapped) open(2, (q) => mapped[q] === 1);
  open(4, (q) => !mapped || !mapped[q]);
  const bytes = []; let run = 0, kept = 0;
  for (let k = 0; k < N * N; k++) {
    const v = keep[k] ? g[k] : 0;
    if (!v) { run++; if (run === 255) { bytes.push(0, 255); run = 0; } continue; }
    if (run) { bytes.push(0, run); run = 0; }
    bytes.push(v); kept++;
  }
  if (run) bytes.push(0, run);
  return kept ? { res: CRES, n: N, half: R_TREES, d: Buffer.from(bytes).toString('base64') } : null;
}

// Rapport de vraisemblance « conifère » d'après la forme de la cime: régression logistique calibrée le 8 octobre 2026
// sur 2499 cimes appariées aux arbres de l'inventaire de la Ville de Québec (613 conifères, 8 quartiers). Une cime
// pointue (forte chute dès 1 m du sommet, puis moins) penche vers le conifère, un dôme vers le feuillu. Seule, la forme
// a raison 7 fois sur 10 (arbres de rue): elle corrige la part attendue du peuplement sans la remplacer. Plafonnée à
// ce qui a été observé (rapport réel d'environ 3 au plus, 0,1 au moins).
export function shapeOdds(t, res = 1) {
  if (res > 1.01) return 1; // profil mesuré à 1 m: à 2 m, la part du peuplement seule
  const e = 0.005, [p1, p2, p3] = t.prof.map((p) => Math.max(0, p));
  const z = 3.126 + 2.505 * Math.log(p1 + e) - 0.298 * Math.log(p2 + e) - 0.55 * Math.log(p3 + e) - 0.063 * Math.log(t.h) + 1.916 * Math.log(t.cr);
  return Math.exp(Math.max(-2.3, Math.min(1.1, z)));
}

// ---------- essences: inventaire de la Ville de Québec et carte écoforestière
const inVdq = (lat, lng) => lat > 46.70 && lat < 47.00 && lng > -71.62 && lng < -71.10;
async function vdqTrees(bbox) {
  const [x0, y0, x1, y1] = bbox;
  const sql = `SELECT "TYPE_ARBRE","NOM_FRANCAIS","LATITUDE","LONGITUDE" FROM "${VDQ_RES}" WHERE "LATITUDE"::float BETWEEN ${y0.toFixed(6)} AND ${y1.toFixed(6)} AND "LONGITUDE"::float BETWEEN ${x0.toFixed(6)} AND ${x1.toFixed(6)} LIMIT 20000`;
  const r = await fetch(`${VDQ}?sql=${encodeURIComponent(sql)}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`inventaire Ville de Québec ${r.status}`);
  const j = await r.json();
  if (!j.success) throw new Error('inventaire Ville de Québec: réponse invalide');
  return j.result.records.map((o) => ({ lat: Number(o.LATITUDE), lng: Number(o.LONGITUDE), con: o.TYPE_ARBRE === 'Conifère', name: o.NOM_FRANCAIS || '' })).filter((o) => o.lat === o.lat && o.lng === o.lng);
}

// Groupes d'essences résineuses de la carte écoforestière (codes en tête de gr_ess, par ordre de dominance).
const RESIN = new Set(['SB', 'SE', 'EP', 'EN', 'EB', 'RX', 'RZ', 'RS', 'PG', 'PB', 'PR', 'PI', 'TO', 'PU', 'ME', 'MH']);
async function ecoforStands(bbox) {
  const [x0, y0, x1, y1] = bbox;
  const q = `SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=ms:ori_pee_close_scale&COUNT=300&OUTPUTFORMAT=${encodeURIComponent('text/xml; subtype=gml/2.1.2')}&BBOX=${y0.toFixed(6)},${x0.toFixed(6)},${y1.toFixed(6)},${x1.toFixed(6)},urn:ogc:def:crs:EPSG::4326`;
  const r = await fetch(`${ECOFOR}?${q}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`carte écoforestière ${r.status}`);
  const xml = await r.text();
  if (!/FeatureCollection/.test(xml)) throw new Error('carte écoforestière: réponse invalide');
  const out = [];
  for (const m of xml.matchAll(/<wfs:member>([\s\S]*?)<\/wfs:member>/g)) {
    const f = m[1], tag = (n) => { const t = f.match(new RegExp(`<ms:${n}>([^<]*)</ms:${n}>`)); return t ? t[1].trim() : ''; };
    const couv = tag('type_couv'), ess = tag('gr_ess');
    // Anneau extérieur seulement (les trous des peuplements sont rares et petits); coordonnées « lat,lng ».
    const outer = f.match(/<gml:outerBoundaryIs>[\s\S]*?<gml:coordinates>([^<]*)<\/gml:coordinates>/g) || [];
    for (const o of outer) {
      const c = o.match(/<gml:coordinates>([^<]*)</)[1].trim().split(/\s+/).map((p) => p.split(',').map(Number)).map(([la, ln]) => [ln, la]);
      if (c.length >= 3) out.push({ couv, ess, ring: c });
    }
  }
  return out;
}
// Part de conifères attendue dans un peuplement: R résineux (75 % et plus), M mélangé (selon l'essence dominante),
// F feuillu (moins de 25 %). Hors forêt (milieu bâti, terrain vague): null.
function standPrior(s) {
  if (!s) return null;
  if (s.couv === 'R') return 0.85;
  if (s.couv === 'F') return 0.08;
  if (s.couv === 'M') return RESIN.has(s.ess.slice(0, 2)) ? 0.62 : 0.35;
  return null;
}
const inRing = (x, y, r) => { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) ins = !ins; } return ins; };
const hsh = (x, n, k) => { const s = Math.sin(x * 12.9898 + n * 78.233 + k * 37.719) * 43758.5453; return s - Math.floor(s); };

// Arbres autour de (lat, lng): { trees: [[x, n, h, r, k]] (k 1 conifère, 0 feuillu; près d'un bâtiment, plus dx, dn, o), covered(x, n) (le LiDAR voit-il ce
// point), canopy (boisés, voir canopyGrid), date, essences (sources utilisées), failed }. trees null: pas de LiDAR ici (repli sur Overture).
export async function lidarTrees(lat, lng, bld, log = () => {}) {
  const R = R_TREES + 8, mLat = 111320, mLng = 111320 * Math.cos(lat * Math.PI / 180);
  const bbox = [lng - R / mLng, lat - R / mLat, lng + R / mLng, lat + R / mLat];
  const [E, N] = toLCC(lat, lng);
  // Peuplements et inventaire en même temps que le LiDAR.
  const inQc = lat > 44.9 && lat < 53 && lng > -79.8 && lng < -57;
  const again = (f) => f().catch(() => f()); // une erreur réseau passagère (ou un service lent) ne doit pas coûter les arbres
  const vdqP = inVdq(lat, lng) ? again(() => vdqTrees(bbox)) : Promise.resolve(null);
  const ecoP = inQc ? again(() => ecoforStands(bbox)) : Promise.resolve(null);
  vdqP.catch(() => {}); ecoP.catch(() => {});
  let list = await again(() => items('hrdem-mosaic-1m', bbox));
  if (!list.length) list = await again(() => items('hrdem-mosaic-2m', bbox));
  if (!list.length) { log('arbres: pas de LiDAR ici'); return { trees: null, failed: false }; }
  const it = list[0];
  // Fenêtre carrée en Lambert (±R plus la rotation du repère: le cercle de R mètres y tient).
  const [dsm, dtm] = await Promise.all([again(() => window1m(it.dsm, E - R, N - R, E + R, N + R)), again(() => window1m(it.dtm, E - R, N - R, E + R, N + R))]);
  if (!dsm || !dtm || dsm.w !== dtm.w || dsm.h !== dtm.h || dsm.c0 !== dtm.c0 || dsm.r0 !== dtm.r0) { log('arbres: fenêtre LiDAR vide'); return { trees: null, failed: false }; }
  const { w: W, h: H, res } = dsm;
  const raw = new Float32Array(W * H), seen = new Uint8Array(W * H);
  let nSeen = 0;
  for (let k = 0; k < raw.length; k++) { const v = dsm.data[k] - dtm.data[k]; if (v === v) { raw[k] = Math.max(0, v); seen[k] = 1; nSeen++; } }
  if (nSeen < raw.length * 0.05) { log('arbres: LiDAR absent de la fenêtre'); return { trees: null, failed: false }; }
  const fr = frame(lat, lng, dsm);
  const mask = buildingMask(bld, fr, W, H, Math.round(1.5 / res)); // 2 pixels à 1 m, 1 à 2 m: 2 m autour de l'empreinte
  const hmax = lng < -114 ? HMAX_WEST : HMAX_EAST;
  const { tops: found, chm, roofMask } = crowns(raw, W, H, res, mask, hmax);
  // Près d'un bâtiment (empreinte sans marge à portée de la couronne): centre réel de la couronne (partage des eaux,
  // qui s'écarte des toits masqués) et feuillage mesuré au-dessus du toit voisin, rugueux et non plan, plus de 1 m
  // au-dessus du quart bas des pixels du toit (surplomb). Le moteur dégage ainsi la couronne d'un mur sans inventer de
  // surplomb que le relevé ne montre pas.
  const fmask = buildingMask(bld, fr, W, H, 0);
  const planar = (k) => { let s = 0, sx = 0, sy = 0, ss = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const z = raw[k + dy * W + dx]; s += z; sx += dx * z; sy += dy * z; ss += z * z; } const a = s / 9, b = sx / 6, c = sy / 6; return ss - 9 * a * a - 6 * b * b - 6 * c * c < 9 * 0.15 * 0.15; };
  for (const t of found) {
    const Rp = Math.ceil((1.25 * t.ca + 1.5) / res), zs = [];
    for (let dj = -Rp; dj <= Rp; dj++) for (let di = -Rp; di <= Rp; di++) {
      const u = t.i + di, v = t.j + dj; if (di * di + dj * dj > Rp * Rp || u < 1 || v < 1 || u >= W - 1 || v >= H - 1) continue;
      const k = v * W + u; if (fmask[k]) zs.push(k);
    }
    if (!zs.length) continue;
    t.near = true;
    const hs = zs.map((k) => raw[k]).sort((a, b) => a - b), lvl = hs[Math.floor(hs.length * 0.25)];
    t.over = zs.length >= 6 && zs.filter((k) => raw[k] > lvl + 1 && !planar(k)).length >= 0.12 * zs.length ? 1 : 0;
  }

  // Repère local, dans le cercle.
  let tops = found.map((t) => { const [x, n] = fr.toLocal(t.i, t.j); return { ...t, x, n }; }).filter((t) => Math.hypot(t.x, t.n) <= R_TREES);

  // Essences.
  const used = [];
  let failed = false;
  const [vdq, eco] = await Promise.all([vdqP.catch((e) => { failed = true; log(`arbres: ${e.message}`); return null; }), ecoP.catch((e) => { failed = true; log(`arbres: ${e.message}`); return null; })]);
  const loc = (ln, la) => [(ln - lng) * mLng, (la - lat) * mLat];
  if (vdq && vdq.length) {
    // Appariement glouton: chaque arbre de l'inventaire à la cime la plus proche (3,5 m au plus), une cime par arbre.
    const pairs = [];
    const grid = new Map(), key = (x, n) => `${Math.floor(x / 4)},${Math.floor(n / 4)}`;
    tops.forEach((t, ti) => { const k = key(t.x, t.n); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(ti); });
    vdq.forEach((v, vi) => {
      const [x, n] = loc(v.lng, v.lat); v.x = x; v.n = n;
      const gx = Math.floor(x / 4), gn = Math.floor(n / 4);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const ti of grid.get(`${gx + a},${gn + b}`) || []) { const d = Math.hypot(tops[ti].x - x, tops[ti].n - n); if (d <= 3.5) pairs.push([d, vi, ti]); }
    });
    pairs.sort((p, q) => p[0] - q[0]);
    const vUsed = new Set();
    for (const [, vi, ti] of pairs) { if (vUsed.has(vi) || tops[ti].src) continue; vUsed.add(vi); tops[ti].src = 'vdq'; tops[ti].k = vdq[vi].con ? 1 : 0; }
    used.push('l’inventaire des arbres de la Ville de Québec');
  }
  const stands = (eco || []).map((s) => ({ ...s, ring: s.ring.map(([ln, la]) => loc(ln, la)), prior: standPrior(s) })).filter((s) => s.prior != null);
  if (stands.length) used.push('la carte écoforestière du Québec');
  const canopy = canopyGrid(chm, roofMask || mask, W, H, fr, stands, (eco || []).map((s) => s.ring.map(([ln, la]) => loc(ln, la))), hmax);
  let inStands = 0;
  for (const t of tops) {
    if (t.src) continue;
    const s = stands.find((q) => inRing(t.x, t.n, q.ring));
    let p = s ? s.prior : (vdq ? 0.11 : 0.2); // hors peuplement: arbres de ville (11 % de conifères dans l'inventaire)
    if (s) inStands++;
    const o = p / (1 - p) * shapeOdds(t, res);
    p = o / (1 + o);
    t.k = hsh(t.x, t.n, 9) < p ? 1 : 0; // tirage fixe pour une même cime
  }
  // Plafond: tous les arbres à moins de 150 m, puis les grands (ligne d'horizon, longues ombres), puis les autres.
  if (tops.length > MAX_TREES) {
    const pr = (t) => (Math.hypot(t.x, t.n) < 150 ? 2 : 0) + (t.h >= 15 ? 1 : 0) + t.h / 100;
    tops.sort((a, b) => pr(b) - pr(a));
    tops = tops.slice(0, MAX_TREES);
  }
  const r1 = (v) => Math.round(v * 10) / 10;
  // Près d'un bâtiment: [x, n, h, r, k, dx, dn, o], (dx, dn) du sommet au centre de la couronne (borné à la moitié du
  // rayon et à 3 m; nul pour un arbre qui surplombe le toit, dont la partie masquée manque au calcul), o 1 si le relevé
  // montre du feuillage au-dessus du toit.
  const trees = tops.map((t) => {
    const a = [r1(t.x), r1(t.n), r1(t.h), r1(Math.max(0.8, t.ca)), t.k];
    if (!t.near) return a;
    let dx = 0, dn = 0;
    if (!t.over) { const [cx, cn] = fr.toLocal(t.ci, t.cj), l = Math.hypot(cx - t.x, cn - t.n), m = Math.min(3, 0.5 * t.ca); if (l > 0.3) { const f = Math.min(1, m / l); dx = (cx - t.x) * f; dn = (cn - t.n) * f; } }
    return a.concat([r1(dx), r1(dn), t.over]);
  });
  const covered = (x, n) => { const [i, j] = fr.toPx(x, n), u = Math.round(i), v = Math.round(j); return u >= 0 && v >= 0 && u < W && v < H && seen[v * W + u] === 1; };
  const nCon = trees.filter((t) => t[4]).length;
  log(`arbres LiDAR: ${trees.length} (${nCon} conifères, ${tops.filter((t) => t.src === 'vdq').length} de l'inventaire, ${inStands} dans un peuplement), relevé ${it.date || '?'}, ${res} m`);
  return { trees, covered, canopy, date: it.date, res, essences: used, failed };
}
