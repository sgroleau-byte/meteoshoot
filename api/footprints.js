// Empreintes réelles des bâtiments d'après le LiDAR de Ressources naturelles Canada (9 octobre 2026).
//
// Les empreintes d'Overture viennent, hors des villes, d'un tracé automatique sur images (Microsoft): des carrés de
// taille et d'orientation approximatives, sans les ailes ni les annexes, et beaucoup de bâtiments manquent (à Stoneham,
// la maison du projet n'y était pas). La hauteur de canopée (surface moins sol nu, la même fenêtre que les arbres,
// api/trees.js) montre chaque toit comme une plaque: on en tire le contour, mis au net en côtés droits, et la hauteur.
//
// Un toit, dans ce relevé, c'est: des pans plans (plan 3 x 3 à moins de 0,3 m, pente continue d'un pixel à l'autre),
// une plaque aux côtés droits (contour régularisé qui remplit son rectangle englobant aux 3/5 au moins), une chute
// nette en bordure (le sol ou un toit plus bas à moins de 2 m de hauteur de moins, dans les 3 m), et une surface fine
// (plan à 0,15 m sur plus du tiers des pixels: une cime est bosselée). Une tache de canopée fermée n'a pas de chute en
// bordure; un arbre isolé est bombé et bosselé. Pour un toit absent d'Overture, en plus: 14 m au plus (un bâtiment
// plus haut est toujours cartographié) et un entourage qui tranche (du sol dans l'anneau de 6 à 14 m autour, ou des
// arbres bien plus hauts): une tache de canopée est à la hauteur de la canopée autour. Mesuré à Stoneham (relevé 2024,
// 1 m): 55 bâtiments d'Overture retrouvés avec leur vraie forme, 46 ajoutés, aucune cime acceptée.
//
// Un bâtiment d'Overture sans toit reconnu (toit sous les arbres, bâti après le relevé) est gardé tel quel; un toit
// reconnu dans son empreinte la remplace (sauf s'il n'en fait pas 40 %: un coin de toit vu entre les arbres); un toit
// hors de toute empreinte devient un bâtiment (remise si moins de 45 m²). Un tracé OpenStreetMap (locked, fait à la main,
// exact en ville) n'est jamais remplacé: un toit reconnu dedans ne change rien. La hauteur vient du même relevé
// (pickHeight, api/heights.js) et le 5e champ passe à 1 (mesuré), le 6e à 1 (empreinte LiDAR).
import { regularizeRing } from '../src/scene3d/ring.js';
import { pickHeight } from './heights.js';

const MIN_H = 2.5; // m: en dessous, pas un toit (terrasse, remise basse, buisson)
const PLAN = 0.3, PLAN_FINE = 0.15; // écart type du plan 3 x 3 (m): pixel plan, pixel fin
const GRAD_TOL = 0.25; // m par pixel: écart de pente admis entre deux pixels d'un même pan
const MIN_PAN = 8, MIN_AREA = 16, MAX_AREA = 2500, MIN_HOLE = 40; // m²
const EDGE_RAY = 3, DROP = 2; // m: chute en bordure
const RING0 = 6, RING1 = 14; // m: anneau d'entourage
const NEW_MAX_H = 14; // m: toit absent d'Overture
const SHED_AREA = 45; // m²: en dessous, remise (comme scene3d.js)

const signedArea = (r) => r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
const ccw = (r) => (signedArea(r) < 0 ? r.slice().reverse() : r);
const round1 = (r) => r.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
const centroid = (r) => r.reduce((c, p) => [c[0] + p[0] / r.length, c[1] + p[1] / r.length], [0, 0]);
function inRing(x, y, r) {
  let ins = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) ins = !ins; }
  return ins;
}
// Rectangle englobant minimal (par direction de côté): { area, ring } (sommets du rectangle, antihoraires).
function minRect(r) {
  let best = { area: Infinity, ring: null };
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length], th = Math.atan2(q[1] - p[1], q[0] - p[0]), cs = Math.cos(th), sn = Math.sin(th);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, n] of r) { const u = x * cs + n * sn, v = -x * sn + n * cs; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (area < best.area) best = { area, ring: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => [u * cs - v * sn, u * sn + v * cs]) };
  }
  return best;
}
const RECT_SNAP = 0.87; // une plaque qui remplit son rectangle à 87 % devient ce rectangle (le contour pixel coupe les coins)
// Contour extérieur d'une composante (suivi de Moore), en pixels.
function traceContour(mask, W, H, sx, sy) {
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1;
  const pts = [[sx, sy]]; let x = sx, y = sy, d = 7;
  for (let g = 0; g < 200000; g++) {
    let f = false;
    for (let k = 0; k < 8; k++) { const dd = (d + 5 + k) % 8, nx = x + dirs[dd][0], ny = y + dirs[dd][1]; if (at(nx, ny)) { x = nx; y = ny; d = dd; f = true; break; } }
    if (!f) break;
    if (x === sx && y === sy) break;
    pts.push([x, y]);
  }
  return pts;
}
const dilate = (m, W, H, r) => { const t = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (!m[y * W + x]) continue; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const u = x + dx, v = y + dy; if (u >= 0 && v >= 0 && u < W && v < H) t[v * W + u] = 1; } } return t; };
const erode = (m, W, H, r) => { const N = W * H, inv = new Uint8Array(N); for (let i = 0; i < N; i++) inv[i] = m[i] ? 0 : 1; const d = dilate(inv, W, H, r); for (let i = 0; i < N; i++) d[i] = d[i] ? 0 : 1; return d; };

// win: { raw (hauteur de canopée, m), W, H, res }; fr: repère (trees.js frame); bld: [[anneau (m locaux), h, étages, genre, ...]].
// Retourne { bld, replaced, added }: nouvelle liste (mêmes entrées, certaines remplacées, plus les toits ajoutés).
export function lidarFootprints(win, fr, bld, log = () => {}, locked = []) {
  const { raw, W, H, res } = win, N = W * H;
  const px2 = res * res, pxOf = (m) => Math.max(1, Math.round(m / res));
  // Pixels plans et leur pente; rugosité (plus grand écart avec les 4 voisins).
  const pl = new Uint8Array(N), fine = new Uint8Array(N), gx = new Float32Array(N), gy = new Float32Array(N), rough = new Float32Array(N);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const k = y * W + x, v = raw[k]; let r = 0; for (const d of [1, -1, W, -W]) r = Math.max(r, Math.abs(raw[k + d] - v)); rough[k] = r;
    if (!(v >= MIN_H)) continue;
    let s = 0, sx = 0, sy = 0, ss = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const z = raw[k + dy * W + dx]; s += z; sx += dx * z; sy += dy * z; ss += z * z; }
    const m = s / 9, bx = sx / 6, by = sy / 6, resid = ss - 9 * m * m - 6 * bx * bx - 6 * by * by;
    if (resid < 9 * PLAN_FINE * PLAN_FINE) fine[k] = 1;
    if (resid < 9 * PLAN * PLAN) { pl[k] = 1; gx[k] = bx; gy[k] = by; }
  }
  // Pans: pixels plans voisins de pente proche (union-find).
  const par = new Int32Array(N); for (let k = 0; k < N; k++) par[k] = k;
  const find = (q) => { while (par[q] !== q) { par[q] = par[par[q]]; q = par[q]; } return q; };
  const tol = GRAD_TOL * res;
  const join = (k, q) => { if (pl[q] && Math.abs(gx[k] - gx[q]) + Math.abs(gy[k] - gy[q]) < tol) { const A = find(k), B = find(q); if (A !== B) par[A] = B; } };
  for (let k = 0; k < N; k++) { if (!pl[k]) continue; if (k % W !== W - 1) join(k, k + 1); if (k + W < N) join(k, k + W); }
  const pans = new Map(); for (let k = 0; k < N; k++) if (pl[k]) { const r = find(k); let l = pans.get(r); if (!l) pans.set(r, l = []); l.push(k); }
  // Grands pans; dôme d'un pan: la pente pointe-t-elle vers l'extérieur depuis son centre (cime, toit en arc)?
  const big = new Uint8Array(N), domeOf = new Float32Array(N), minPan = Math.max(3, Math.round(MIN_PAN / px2));
  for (const pts of pans.values()) {
    if (pts.length < minPan) continue;
    let mx = 0, my = 0; for (const k of pts) { mx += k % W; my += (k - k % W) / W; } mx /= pts.length; my /= pts.length;
    let sd = 0, sn = 0; for (const k of pts) { const x = k % W, y = (k - x) / W, dx = x - mx, dy = y - my; sd += gx[k] * dx + gy[k] * dy; sn += Math.hypot(gx[k], gy[k]) * Math.hypot(dx, dy); }
    const dome = sn > 0 ? -sd / sn : 0;
    for (const k of pts) { big[k] = 1; domeOf[k] = dome; }
  }
  // Plaques: fermeture d'un pixel (faîtes, arêtes), jamais sous 2 m; un pixel de bord en plus quand la hauteur y reste à
  // 1,5 m du toit (le relevé mêle toit et sol au bord); trous de moins de 40 m² comblés (cheminées, lucarnes).
  let m = erode(dilate(big, W, H, 1), W, H, 1);
  for (let k = 0; k < N; k++) if (m[k] && raw[k] < 2) m[k] = 0;
  { const t = new Uint8Array(m); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const k = y * W + x; if (m[k] || !(raw[k] >= MIN_H)) continue; for (const d of [1, -1, W, -W]) if (m[k + d] && Math.abs(raw[k + d] - raw[k]) <= 1.5 && rough[k] <= 2.5) { t[k] = 1; break; } } m = t; }
  { const lab = new Uint8Array(N), maxHole = MIN_HOLE / px2; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (m[i] || lab[i]) continue; const st = [i], pix = []; lab[i] = 1; let border = false; while (st.length) { const j = st.pop(); pix.push(j); const jx = j % W, jy = (j - jx) / W; if (jx === 0 || jy === 0 || jx === W - 1 || jy === H - 1) border = true; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = jx + dx, ny = jy + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const q = ny * W + nx; if (!m[q] && !lab[q]) { lab[q] = 1; st.push(q); } } } if (!border && pix.length < maxHole) for (const j of pix) m[j] = 1; } }
  // Composantes (8 voisins).
  const lab = new Int32Array(N), comps = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!m[i] || lab[i]) continue;
    const id = comps.length + 1, st = [i], comp = []; lab[i] = id;
    while (st.length) { const j = st.pop(); comp.push(j); const jx = j % W, jy = (j - jx) / W; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = jx + dx, ny = jy + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const q = ny * W + nx; if (m[q] && !lab[q]) { lab[q] = id; st.push(q); } } }
    comps.push(comp);
  }
  // Mesures par composante et acceptation.
  const rayN = pxOf(EDGE_RAY), r0 = pxOf(RING0), r1 = pxOf(RING1), cands = [];
  const ovCen = bld.map(b => centroid(b[0]));
  for (const comp of comps) {
    if (comp.length * px2 < MIN_AREA) continue;
    const hs = comp.map(k => raw[k]).sort((p, q) => p - q), h = hs[Math.floor(hs.length * 0.6)];
    let dsum = 0, dn = 0, nf = 0; for (const k of comp) { if (big[k]) { dsum += domeOf[k]; dn++; } if (fine[k]) nf++; }
    const dome = dn ? dsum / dn : 0, p15 = nf / comp.length;
    const mask = new Uint8Array(N); for (const k of comp) mask[k] = 1;
    let edge = 0, drop = 0, sx = -1, sy = -1;
    for (const k of comp) {
      const x = k % W, y = (k - x) / W;
      if (sy < 0 || y < sy || (y === sy && x < sx)) { sx = x; sy = y; }
      let isEdge = false, dr = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const u = x + dx, v = y + dy; if (u < 0 || v < 0 || u >= W || v >= H || mask[v * W + u]) continue;
        isEdge = true;
        for (let s = 1; s <= rayN; s++) { const uu = x + dx * s, vv = y + dy * s; if (uu < 0 || vv < 0 || uu >= W || vv >= H) break; if (raw[vv * W + uu] < Math.min(h, raw[k]) - DROP) { dr = true; break; } }
      }
      if (isEdge) { edge++; if (dr) drop++; }
    }
    const chute = edge ? drop / edge : 0;
    // Entourage: anneau de 6 à 14 m (pas de 2 pixels), hors composante: médiane et part de sol (sous 2 m).
    const ring = [], seen = new Set();
    for (const k of comp) { const x = k % W, y = (k - x) / W; for (let dy = -r1; dy <= r1; dy += 2) for (let dx = -r1; dx <= r1; dx += 2) { const dd = dx * dx + dy * dy; if (dd < r0 * r0 || dd > r1 * r1) continue; const u = x + dx, v = y + dy; if (u < 0 || v < 0 || u >= W || v >= H) continue; const q = v * W + u; if (mask[q] || seen.has(q)) continue; seen.add(q); ring.push(raw[q]); } }
    ring.sort((p, q) => p - q);
    const env = ring.length ? ring[ring.length >> 1] : 0, gnd = ring.length ? ring.filter(v => v < 2).length / ring.length : 0;
    const cpx = traceContour(mask, W, H, sx, sy).map(([i, j]) => fr.toLocal(i + 0.5, j + 0.5)); if (cpx.length < 4) continue;
    let reg = regularizeRing(cpx, 0.8, 15, 2); if (reg.length < 3) continue;
    const mr = minRect(reg), A0 = Math.abs(signedArea(reg)), rect = A0 / Math.max(1e-6, mr.area);
    if (rect >= RECT_SNAP && reg.length > 4) reg = mr.ring; // maison rectangulaire: le rectangle, pas l'octogone
    const A = Math.abs(signedArea(reg)), cc = centroid(reg);
    const ov = []; bld.forEach((b, i) => { if (inRing(cc[0], cc[1], b[0]) || inRing(ovCen[i][0], ovCen[i][1], reg)) ov.push(i); });
    const matched = ov.length === 1;
    const ok = A >= MIN_AREA && A <= MAX_AREA && h >= MIN_H && dome < 0.8 && p15 >= (matched ? 0.3 : 0.35) && chute >= (matched ? 0.25 : 0.35) && rect >= (matched ? 0.5 : 0.6)
      && (matched || (h <= NEW_MAX_H && (gnd >= 0.2 || env - h >= 4)));
    if (ok) cands.push({ comp, ring: reg, A, h, ov });
  }
  // Remplacement et ajouts. Un toit par empreinte d'Overture (le plus grand); les autres toits de la même empreinte
  // deviennent des bâtiments à part (maison et garage dans un même carré).
  cands.sort((a, b) => b.A - a.A);
  const out = bld.map(b => b.slice()), taken = new Set();
  let replaced = 0, added = 0;
  const heightOf = (c, kind) => {
    const pts = c.comp.map(k => ({ v: raw[k], rough: rough[k] })), area = c.comp.length * px2;
    const maxH = area >= 400 ? Infinity : kind === 2 ? 7 : kind === 1 ? (area < 250 ? 20 : Infinity) : 13;
    const pick = pickHeight(pts, maxH);
    return Math.round(Math.min(250, pick.h != null && pick.h >= MIN_H ? pick.h : c.h) * 10) / 10;
  };
  const entry = (c, kind, src) => { const h = heightOf(c, kind), fl = src && src[2] && Math.abs(src[2] * 3.3 - h) <= 0.3 * h ? src[2] : Math.max(1, Math.round(h / 3.3)); return [round1(ccw(c.ring)), h, fl, kind, 1, 1]; };
  for (const c of cands) {
    if (c.ov.length > 1) continue; // à cheval sur plusieurs empreintes (maisons en rangée): on garde Overture
    if (c.ov.length === 1 && locked[c.ov[0]]) continue; // tracé OpenStreetMap: gardé tel quel
    if (c.ov.length === 1 && !taken.has(c.ov[0])) {
      const i = c.ov[0], b = bld[i], aOv = Math.abs(signedArea(b[0]));
      if (c.A < 0.4 * aOv) continue; // un coin de toit entre les arbres: l'empreinte d'Overture reste
      taken.add(i); out[i] = entry(c, b[3], b); replaced++;
      continue;
    }
    const kind = c.ov.length === 1 ? (c.A < SHED_AREA ? 2 : bld[c.ov[0]][3]) : (c.A < SHED_AREA ? 2 : 0);
    out.push(entry(c, kind, null)); added++;
  }
  log(`empreintes LiDAR: ${replaced} remplacées, ${added} ajoutées (${cands.length} toits reconnus, ${comps.length} plaques)`);
  return { bld: out, replaced, added };
}
