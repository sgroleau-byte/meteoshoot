// Surfaces pavées (béton, asphalte: stationnements, aires, voies de circulation, cours) et entrées en gravier d'après l'imagerie satellite,
// pour les lieux où ni Overture ni OpenStreetMap ne les connaissent (cours d'école, stationnements privés, héliports...).
// Méthode sans intelligence artificielle: tuiles Esri World Imagery (zoom 19, 0,2 m par pixel) classées par couleur
// (béton clair peu saturé, asphalte neutre ou bleuté; l'herbe, la terre et la forêt sont exclues), moins les bâtiments et
// les rues déjà connus, nettoyées par morphologie, puis vectorisées en contours simplifiés au mètre. Résultat
// approximatif (bords au mètre près, gravier et sols nus parfois pris pour du pavé): la vue 3D le dit en légende.
// Désactivé en zone dense (plus de 18 % du sol bâti dans 300 m), où tout est gris.
//
// Entrées en gravier (9 octobre 2026, Stéphane: « les entrées ne sont pas présentes »; « en gravier, jamais en terre »):
// hors des villes, les entrées et cours sont en gravier, que la règle du pavé ignore (et dont la largeur de 3 à 5 m ne
// survit pas à l'ouverture de 3 m). Dans l'image, le gravier est ce qu'il y a de plus clair et de moins saturé: seuils
// relatifs à l'image (saturation sous son 15e centile, clarté au-dessus de son 70e), parce que la dominante varie
// d'une prise à l'autre (à Stoneham, même l'asphalte est « vert »). Puis la géométrie décide: une composante (fermée à
// 1,2 m, ouverte à 1 m, 12 à 1500 m²) n'est une entrée que si elle touche une rue (à 2,5 m) et un bâtiment (à 3 m).
// Calage: l'imagerie Esri est décalée de quelques mètres par rapport au LiDAR et à Overture (9 m à Stoneham); le
// décalage est mesuré en superposant les pixels sombres (toits) aux empreintes des bâtiments, puis appliqué aux
// polygones tirés de l'image (pavé et gravier).
//
// Relief LiDAR croisé avec la couleur (24 octobre 2026, Stéphane: « augmenter la précision des entrées »): une entrée
// est du sol nu (surface et terrain confondus, sous BARE_H) et régulier (écart au plan local sous SMOOTH_M). Là où le
// relevé voit, un pixel n'est candidat que s'il est nu et lisse (fini les toits clairs, arbustes et affleurements pris
// pour du gravier), et la clarté exigée descend (40e centile au lieu du 70e): l'ombre d'un arbre ne coupe plus
// l'entrée en deux. Les petits volumes (voitures, bacs, haies: sous SMALL_A, moins de 3 m) comptent comme du sol, la
// couleur décide. Les plans d'eau (Overture) sont retirés: un lac est sombre, peu saturé et plat. Hors du relevé, la
// règle de couleur seule reste.
import jpeg from 'jpeg-js';
import { ditchEntries } from './driveways.js';

const Z = 19, HALF_M = 320, TILE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
export const PAVED_ATTRIBUTION = 'Esri, Maxar, Earthstar Geographics';

const tileXY = (lat, lng) => { const n = 2 ** Z; return [(lng + 180) / 360 * n, (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n]; };

async function fetchTile(tx, ty) {
  const r = await fetch(`${TILE}/${Z}/${ty}/${tx}`, { headers: { 'User-Agent': 'MeteoShoot (www.meteoshoot.com)' } });
  if (!r.ok) throw new Error('tuile ' + r.status);
  return jpeg.decode(Buffer.from(await r.arrayBuffer()), { useTArray: true, formatAsRGBA: true });
}

const BARE_H = 0.4, SMOOTH_M = 0.12, SMALL_A = 25, SMALL_H = 3; // sol nu et lisse d'après le LiDAR (voir l'en-tête)

// Classe LiDAR de chaque pixel de la fenêtre: 0 inconnu, 1 sol nu et lisse, 2 volume bas ou terrain irrégulier,
// 3 sous la canopée (CANOPY_H et plus: le sol n'est pas vu, la couleur de l'image décide seule, comme avant).
const CANOPY_H = 3;
export function bareMask(win) {
  const { raw, seen, W, H, res, dtm } = win, out = new Uint8Array(W * H), vol = new Uint8Array(W * H);
  for (let k = 0; k < out.length; k++) if (seen[k] && raw[k] >= BARE_H) vol[k] = 1;
  // Petits volumes ramenés au sol: composantes de moins de SMALL_A m² dont le sommet reste sous SMALL_H.
  const lab = new Uint8Array(W * H), maxN = SMALL_A / (res * res);
  for (let s0 = 0; s0 < vol.length; s0++) {
    if (!vol[s0] || lab[s0]) continue;
    const stack = [s0], comp = []; lab[s0] = 1; let hmax = 0, big = false;
    while (stack.length) { const j = stack.pop(); comp.push(j); if (raw[j] > hmax) hmax = raw[j]; if (comp.length > maxN) big = true; const x = j % W, y = (j - x) / W; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const n = ny * W + nx; if (vol[n] && !lab[n]) { lab[n] = 1; stack.push(n); } } }
    if (!big && hmax < SMALL_H) for (const j of comp) vol[j] = 0;
  }
  // Régularité du terrain: écart quadratique au plan des moindres carrés sur 3 × 3 (1 m) ou 3 × 3 (2 m).
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const k = y * W + x; if (!seen[k]) continue; if (vol[k]) { out[k] = raw[k] >= CANOPY_H ? 3 : 2; continue; }
    let n = 0, sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const z = dtm[k + dy * W + dx]; if (z !== z) continue; n++; sx += dx; sy += dy; sz += z; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; sxz += dx * z; syz += dy * z; }
    if (n < 6) continue;
    // plan z = a dx + b dy + c (moindres carrés, 3 inconnues)
    const mx = sx / n, my = sy / n, mz = sz / n, cxx = sxx - n * mx * mx, cyy = syy - n * my * my, cxy = sxy - n * mx * my, cxz = sxz - n * mx * mz, cyz = syz - n * my * mz, det = cxx * cyy - cxy * cxy;
    if (Math.abs(det) < 1e-9) continue;
    const a = (cxz * cyy - cyz * cxy) / det, b = (cyz * cxx - cxz * cxy) / det, c = mz - a * mx - b * my;
    let ss = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const z = dtm[k + dy * W + dx]; if (z !== z) continue; const e = z - (a * dx + b * dy + c); ss += e * e; }
    out[k] = Math.sqrt(ss / n) < SMOOTH_M ? 1 : 2; // écart en mètres (la pente est absorbée par le plan)
  }
  return out;
}

// Pavé selon la couleur d'un pixel (RVB 0..255): béton clair, asphalte neutre, asphalte bleuté.
function isPaved(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), v = mx / 255, s = mx ? (mx - mn) / mx : 0;
  if (v > 0.985 || v <= 0.23) return false;
  if (v > 0.70 && s < 0.22) return true;
  if (s < 0.16) return true;
  if (s < 0.22) { let h = 0; const d = mx - mn; if (d > 0) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h = (h * 60 + 360) % 360; } return h > 165 && h < 275; }
  return false;
}

// Morphologie binaire sur une grille (carré de demi-côté r, deux passes séparables).
function dilate(m, W, H, r) { const t = new Uint8Array(W * H), o = new Uint8Array(W * H); for (let y = 0; y < H; y++) { const row = y * W; let c = 0; for (let x = -r; x < W; x++) { if (x + r < W && m[row + x + r]) c++; if (x - r - 1 >= 0 && m[row + x - r - 1]) c--; if (x >= 0) t[row + x] = c > 0 ? 1 : 0; } } for (let x = 0; x < W; x++) { let c = 0; for (let y = -r; y < H; y++) { if (y + r < H && t[(y + r) * W + x]) c++; if (y - r - 1 >= 0 && t[(y - r - 1) * W + x]) c--; if (y >= 0) o[y * W + x] = c > 0 ? 1 : 0; } } return o; }
function erode(m, W, H, r) { const inv = new Uint8Array(W * H); for (let i = 0; i < inv.length; i++) inv[i] = m[i] ? 0 : 1; const d = dilate(inv, W, H, r); for (let i = 0; i < d.length; i++) d[i] = d[i] ? 0 : 1; // bord de grille = hors pavé
  for (let x = 0; x < W; x++) { d[x] = 0; d[(H - 1) * W + x] = 0; } for (let y = 0; y < H; y++) { d[y * W] = 0; d[y * W + W - 1] = 0; } return d; }
const close = (m, W, H, r) => erode(dilate(m, W, H, r), W, H, r), open = (m, W, H, r) => dilate(erode(m, W, H, r), W, H, r);

// Remplissage d'un polygone (balayage) et trait épais (disques le long des segments) sur la grille.
function fillPoly(m, W, H, pts, val) {
  let y0 = Infinity, y1 = -Infinity; pts.forEach(p => { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(H - 1, Math.ceil(y1)); y++) {
    const xs = []; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; if ((a[1] <= y) !== (b[1] <= y)) xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])); }
    xs.sort((p, q) => p - q); for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.round(xs[k])); x <= Math.min(W - 1, Math.round(xs[k + 1])); x++) m[y * W + x] = val;
  }
}
function thickLine(m, W, H, a, b, r, val) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(len / Math.max(1, r / 2)));
  for (let i = 0; i <= n; i++) { const cx = Math.round(a[0] + (b[0] - a[0]) * i / n), cy = Math.round(a[1] + (b[1] - a[1]) * i / n); for (let dy = -r; dy <= r; dy++) { const y = cy + dy; if (y < 0 || y >= H) continue; const w = Math.floor(Math.sqrt(r * r - dy * dy)); for (let x = Math.max(0, cx - w); x <= Math.min(W - 1, cx + w); x++) m[y * W + x] = val; } }
}

// Contour extérieur d'une composante (suivi de Moore), sommets en pixels.
function traceContour(m, W, H, sx, sy) {
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && m[y * W + x] === 1;
  const pts = [[sx, sy]]; let x = sx, y = sy, d = 7;
  for (let guard = 0; guard < 400000; guard++) {
    let found = false;
    for (let k = 0; k < 8; k++) { const dd = (d + 5 + k) % 8; const nx = x + dirs[dd][0], ny = y + dirs[dd][1]; if (at(nx, ny)) { x = nx; y = ny; d = dd; found = true; break; } }
    if (!found) break;
    if (x === sx && y === sy) break;
    pts.push([x, y]);
  }
  return pts;
}
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const d2 = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const stack = [[0, pts.length - 1]];
  while (stack.length) { const [i, j] = stack.pop(); let best = 0, bi = -1; for (let k = i + 1; k < j; k++) { const dd = d2(pts[k], pts[i], pts[j]); if (dd > best) { best = dd; bi = k; } } if (best > eps) { keep[bi] = 1; stack.push([i, bi], [bi, j]); } }
  return pts.filter((p, i) => keep[i]);
}

// Entrée en bande (v633.179): la tache de gravier est redessinée comme une bande de largeur constante (médiane de la
// largeur mesurée, 2,5 à 7 m) le long du chemin qui va de la rue au bout de la tache (plus court chemin dans la tache
// jusqu'au pixel le plus éloigné qui touche un bâtiment, segments droits), plus, si la tache déborde largement de la
// bande (aire de stationnement devant la maison), le rectangle de ce qui reste. Sans chemin trouvé, la tache elle-même.
// Retourne des anneaux en mètres locaux. Les contours de taches avaient des bords ondulés et des excroissances; une
// entrée réelle est une bande droite.
function driveBands(comp, id, glab, nearRoad, nearBld, inBld, W2, H2, mp2, toM) {
  const inC = (j) => glab[j] === id;
  const srcs = comp.filter(j => nearRoad[j]);
  if (!srcs.length) { const o = contourOf(comp, W2, H2, mp2, toM); return o ? [o] : []; }
  // Plus court chemin (4 voisins) depuis les pixels contre la rue; le bout de l'entrée est le pixel le plus éloigné
  // parmi ceux qui touchent un bâtiment (sinon le plus éloigné de tous): la bande suit toute la longueur de la tache.
  const parent = new Map(), dist = new Map(), queue = srcs.slice(); let end = -1, endAll = -1, dBest = -1, dAll = -1;
  for (const j of srcs) { parent.set(j, -1); dist.set(j, 0); }
  for (let qi = 0; qi < queue.length; qi++) {
    const j = queue[qi], dj = dist.get(j);
    if (nearBld[j] && dj > dBest) { dBest = dj; end = j; }
    if (dj > dAll) { dAll = dj; endAll = j; }
    const jx = j % W2, jy = (j - jx) / W2;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = jx + dx, ny = jy + dy; if (nx < 0 || ny < 0 || nx >= W2 || ny >= H2) continue; const q = ny * W2 + nx; if (inC(q) && !parent.has(q)) { parent.set(q, j); dist.set(q, dj + 1); queue.push(q); } }
  }
  if (end < 0) end = endAll;
  if (end < 0) { const o = contourOf(comp, W2, H2, mp2, toM); return o ? [o] : []; }
  const path = []; for (let j = end; j >= 0; j = parent.get(j)) path.push([j % W2, (j - j % W2) / W2]);
  path.reverse();
  const pl = simplify(path, 1.5 / mp2); // polyligne en pixels, segments droits
  let len = 0; for (let i = 0; i + 1 < pl.length; i++) len += Math.hypot(pl[i + 1][0] - pl[i][0], pl[i + 1][1] - pl[i][1]);
  if (len < 2 / mp2) { const o = contourOf(comp, W2, H2, mp2, toM); return o ? [o] : []; }
  // Largeur: médiane de la largeur locale (pixels de la tache sur la perpendiculaire, à ±8 m), 2,5 à 7 m: un
  // stationnement au bout ne gonfle pas la bande.
  const widths = [];
  for (let i = 0; i + 1 < pl.length; i++) {
    const a = pl[i], b = pl[i + 1], ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey) || 1, px = -ey / l, py = ex / l, nS = Math.max(1, Math.round(l / (2 / mp2)));
    for (let s = 0; s < nS; s++) { const t = (s + 0.5) / nS, cx = a[0] + ex * t, cy = a[1] + ey * t; let wl = 0; for (let k = 1; k <= 8 / mp2; k++) { const x = Math.round(cx + px * k), y = Math.round(cy + py * k); if (x < 0 || y < 0 || x >= W2 || y >= H2 || !inC(y * W2 + x)) break; wl++; } let wr = 0; for (let k = 1; k <= 8 / mp2; k++) { const x = Math.round(cx - px * k), y = Math.round(cy - py * k); if (x < 0 || y < 0 || x >= W2 || y >= H2 || !inC(y * W2 + x)) break; wr++; } widths.push(wl + wr + 1); }
  }
  widths.sort((p, q) => p - q);
  const wPx = Math.max(2.5 / mp2, Math.min(7 / mp2, widths.length ? widths[widths.length >> 1] : comp.length / len));
  const out = [bandPoly(pl, wPx, mp2, toM)], fr = farRect(comp, pl, wPx, inBld, W2, H2, mp2);
  if (fr) out.push(toM(fr));
  return out;
}
// Bande droite autour d'une polyligne (pixels), largeur wPx: prolongée de 3 m au bout côté bâtiment (le chemin
// s'arrête à 3 m du mur) et de 1 m côté rue.
function bandPoly(pl, wPx, mp2, toM, extEnd = 3, extStart = 1) {
  const ext = (a, b, d) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [b[0] + (b[0] - a[0]) / l * d, b[1] + (b[1] - a[1]) / l * d]; };
  const P = pl.slice(); P[P.length - 1] = ext(P[P.length - 2], P[P.length - 1], extEnd / mp2); P[0] = ext(P[1], P[0], extStart / mp2);
  const left = [], right = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
    left.push([P[i][0] + nx * wPx / 2, P[i][1] + ny * wPx / 2]); right.push([P[i][0] - nx * wPx / 2, P[i][1] - ny * wPx / 2]);
  }
  return toM(left.concat(right.reverse()));
}
// Reste de la tache hors de la bande (plus de 25 m²): rectangle englobant minimal de ces pixels, au moins à moitié
// plein (sinon une traînée), hors des bâtiments. Pixels, ou null.
function farRect(comp, pl, wPx, inBld, W2, H2, mp2) {
  const far = comp.filter(j => { const x = j % W2, y = (j - x) / W2; let dmin = Infinity; for (let i = 0; i + 1 < pl.length; i++) { const a = pl[i], b = pl[i + 1], ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / l2)); dmin = Math.min(dmin, Math.hypot(x - a[0] - t * ex, y - a[1] - t * ey)); } return dmin > wPx / 2 + 1 / mp2; });
  if (far.length * mp2 * mp2 < 25) return null;
  const pts = far.map(j => [j % W2, (j - j % W2) / W2]);
  let best = null;
  for (let k = 0; k < 18; k++) { const th = k * Math.PI / 18, cs = Math.cos(th), sn = Math.sin(th); let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity; for (const [x, y] of pts) { const u = x * cs + y * sn, v = -x * sn + y * cs; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); } const area = (u1 - u0 + 1) * (v1 - v0 + 1); if (!best || area < best.area) best = { area, ring: [[u0, v0], [u1 + 1, v0], [u1 + 1, v1 + 1], [u0, v1 + 1]].map(([u, v]) => [u * cs - v * sn, u * sn + v * cs]) }; }
  const hitsBld = (r) => [...r, [r.reduce((t, p) => t + p[0] / 4, 0), r.reduce((t, p) => t + p[1] / 4, 0)]].some(([x, y]) => { const i = Math.round(x), j = Math.round(y); return i >= 0 && j >= 0 && i < W2 && j < H2 && inBld[j * W2 + i]; });
  return best && far.length / best.area >= 0.45 && !hitsBld(best.ring) ? best.ring : null;
}
function contourOf(comp, W2, H2, mp2, toM) {
  const cm = new Uint8Array(W2 * H2); let sx = -1, sy = -1;
  for (const j of comp) { cm[j] = 1; const x = j % W2, y = (j - x) / W2; if (sy < 0 || y < sy || (y === sy && x < sx)) { sx = x; sy = y; } }
  const c = simplify(traceContour(cm, W2, H2, sx, sy), 1 / mp2); return c.length >= 3 ? toM(c) : null;
}

// Surfaces pavées en mètres locaux autour de (lat, lng); bld = [[ring, h, fl, kind]], roads = [{w, k, p}] (mètres locaux).
// opts: win (fenêtre LiDAR de readCanopy, facultative), water (plans d'eau [{o, h}], facultatifs), dbg (objet rempli pour le banc).
export async function pavedFromImagery(lat, lng, bld, roads, log = () => {}, opts = {}) {
  const { win = null, water = [], dbg = null } = opts;
  const mLat = 111320, mLng = 111320 * Math.cos(lat * Math.PI / 180);
  const area = (r) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
  const built = bld.filter(b => Math.hypot(...b[0].reduce((c, p) => [c[0] + p[0] / b[0].length, c[1] + p[1] / b[0].length], [0, 0])) < 300).reduce((s, b) => s + area(b[0]), 0);
  if (built / (Math.PI * 300 * 300) > 0.18) { log('zone dense, surfaces pavées non détectées'); return { paved: [], gravel: [], dense: true, shift: [0, 0] }; }
  const [cx, cy] = tileXY(lat, lng), mpp = 156543.03 * Math.cos(lat * Math.PI / 180) / 2 ** Z, halfT = HALF_M / mpp / 256;
  const x0 = Math.floor(cx - halfT), x1 = Math.floor(cx + halfT), y0 = Math.floor(cy - halfT), y1 = Math.floor(cy + halfT);
  const W = (x1 - x0 + 1) * 256, H = (y1 - y0 + 1) * 256, cxp = (cx - x0) * 256, cyp = (cy - y0) * 256;
  const mask = new Uint8Array(W * H);
  const jobs = []; for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) jobs.push([tx, ty]);
  const sat = new Uint8Array(W * H), val = new Uint8Array(W * H); // saturation et clarté (0 à 255) de chaque pixel, pour le gravier
  const rgb = dbg ? new Uint8Array(W * H * 3) : null;
  let k = 0; const worker = async () => { while (k < jobs.length) { const [tx, ty] = jobs[k++]; let im; try { im = await fetchTile(tx, ty); } catch (e) { continue; } const d = im.data; for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) { const i = (y * 256 + x) * 4, j = (ty - y0) * 256 * W + (tx - x0) * 256 + y * W + x; const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b); sat[j] = mx ? Math.round(255 * (mx - mn) / mx) : 0; val[j] = mx; if (rgb) { rgb[j * 3] = r; rgb[j * 3 + 1] = g; rgb[j * 3 + 2] = b; } if (isPaved(r, g, b)) mask[j] = 1; } } };
  await Promise.all(Array.from({ length: 12 }, worker));
  // Calage de l'image sur les empreintes (LiDAR, Overture): pixels sombres (clarté sous le 25e centile) contre bâtiments,
  // sur une grille au mètre, décalage de ±12 m qui les superpose le mieux. Les polygones tirés de l'image sont ramenés
  // d'autant. Gardé seulement s'il fait nettement mieux que l'absence de décalage (1,5 fois).
  const step = Math.max(1, Math.round(1 / mpp)), Ws = Math.floor(W / step), Hs = Math.floor(H / step);
  let shx = 0, shy = 0;
  { const hist = new Uint32Array(256); for (let i = 0; i < val.length; i += 7) hist[val[i]]++; let acc = 0, q25 = 0; const tot = hist.reduce((a, b) => a + b, 0); for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= tot * 0.25) { q25 = i; break; } }
    const dark = new Uint8Array(Ws * Hs); for (let y = 0; y < Hs; y++) for (let x = 0; x < Ws; x++) dark[y * Ws + x] = val[(y * step) * W + x * step] < q25 ? 1 : 0;
    const fp = new Uint8Array(Ws * Hs); bld.forEach(b => fillPoly(fp, Ws, Hs, b[0].map(p => [(cxp + p[0] / mpp) / step, (cyp - p[1] / mpp) / step]), 1));
    const score = (dx, dy) => { let s = 0; for (let y = Math.max(0, -dy); y < Hs - Math.max(0, dy); y++) for (let x = Math.max(0, -dx); x < Ws - Math.max(0, dx); x++) if (fp[(y + dy) * Ws + x + dx] && dark[y * Ws + x]) s++; return s; };
    const s0 = score(0, 0); let best = s0;
    for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) { const sc = score(dx, dy); if (sc > best) { best = sc; shx = dx; shy = dy; } }
    if (best < 1.5 * s0 || best < 50) { shx = 0; shy = 0; }
    log(`calage de l'imagerie: ${(shx * step * mpp).toFixed(1)} m est, ${(-shy * step * mpp).toFixed(1)} m nord (${best} contre ${s0})`);
  }
  const ox = shx * step, oy = shy * step; // pixel de scène = pixel d'image + (ox, oy)
  // Bâtiments (dilatés de 2,5 m) et rues (largeur + 2 m) retirés, dans le repère de l'image recalé
  const toPx = (p) => [cxp + p[0] / mpp - ox, cyp - p[1] / mpp - oy];
  const rm = new Uint8Array(W * H);
  bld.forEach(b => fillPoly(rm, W, H, b[0].map(toPx), 1));
  const rmd = dilate(rm, W, H, Math.round(2.5 / mpp));
  roads.forEach(r => { const pts = r.p.map(toPx); for (let i = 0; i + 1 < pts.length; i++) thickLine(rmd, W, H, pts[i], pts[i + 1], Math.round((r.w / 2 + 1) / mpp), 1); });
  for (let i = 0; i < mask.length; i++) if (rmd[i]) mask[i] = 0;
  // Demi-résolution (0,4 m) pour la morphologie: fermer 3,5 m, ouvrir 3 m, fermer 2 m
  const W2 = W >> 1, H2 = H >> 1, m2 = new Uint8Array(W2 * H2), mp2 = mpp * 2;
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) { const i = (2 * y) * W + 2 * x; m2[y * W2 + x] = (mask[i] + mask[i + 1] + mask[i + W] + mask[i + W + 1]) >= 2 ? 1 : 0; }
  let m = close(m2, W2, H2, Math.round(3.5 / mp2)); m = open(m, W2, H2, Math.round(3 / mp2)); m = close(m, W2, H2, Math.round(2 / mp2));
  // Composantes (remplissage) de 200 m² et plus: contour extérieur, puis leurs trous (fond enclavé de 150 m² et plus,
  // par exemple l'herbe au milieu d'une boucle de voies), simplification au mètre, mètres locaux.
  const lab = new Int32Array(W2 * H2), comps = []; const minPx = 200 / (mp2 * mp2), minHole = 150 / (mp2 * mp2);
  const toM = (c) => c.map(p => [Math.round((p[0] * 2 + ox - cxp) * mpp * 10) / 10, Math.round((cyp - p[1] * 2 - oy) * mpp * 10) / 10]);
  const ring = (pix, x, y) => { const cm = new Uint8Array(W2 * H2); pix.forEach(j => { cm[j] = 1; }); const c = simplify(traceContour(cm, W2, H2, x, y), 1 / mp2); return c.length >= 3 ? toM(c) : null; };
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
    const i = y * W2 + x; if (!m[i] || lab[i]) continue;
    const id = comps.length + 1, stack = [i], comp = []; lab[i] = id;
    while (stack.length) { const j = stack.pop(); comp.push(j); const jx = j % W2, jy = (j - jx) / W2; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = jx + dx, ny = jy + dy; if (nx < 0 || ny < 0 || nx >= W2 || ny >= H2) continue; const n = ny * W2 + nx; if (m[n] && !lab[n]) { lab[n] = id; stack.push(n); } } }
    comps.push(comp.length >= minPx ? { o: ring(comp, x, y), h: [] } : null);
  }
  // Fond: ses composantes (4-connexité) qui ne touchent pas le bord sont des trous; leur parent est le pavé voisin.
  const seen = new Uint8Array(W2 * H2);
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
    const i = y * W2 + x; if (m[i] || seen[i]) continue;
    const stack = [i], pix = []; seen[i] = 1; let border = false, parent = 0;
    while (stack.length) { const j = stack.pop(); pix.push(j); const jx = j % W2, jy = (j - jx) / W2; if (jx === 0 || jy === 0 || jx === W2 - 1 || jy === H2 - 1) border = true; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = jx + dx, ny = jy + dy; if (nx < 0 || ny < 0 || nx >= W2 || ny >= H2) continue; const n = ny * W2 + nx; if (m[n]) { if (!parent) parent = lab[n]; } else if (!seen[n]) { seen[n] = 1; stack.push(n); } } }
    if (border || pix.length < minHole || !parent || !comps[parent - 1] || !comps[parent - 1].o) continue;
    const hr = ring(pix, x, y); if (hr) comps[parent - 1].h.push(hr);
  }
  const polys = comps.filter(c => c && c.o);
  log(`surfaces pavées: ${polys.length}`);
  // Entrées en gravier: seuils relatifs à l'image, demi-résolution, moins bâtiments (dilatés de 1 m) et rues (largeur + 1 m).
  // Hors ville seulement: sol bâti sous 10 % dans 300 m et image peu grise (15e centile de saturation à 0,2 au moins), sinon
  // trottoirs, toits clairs et stationnements passeraient pour du gravier.
  const gravel = []; let ditch = 0;
  try {
    const q = (arr, f) => { const hist = new Uint32Array(256); for (let i = 0; i < arr.length; i += 3) hist[arr[i]]++; const tot = hist.reduce((a, b) => a + b, 0); let acc = 0; for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= tot * f) return i; } return 255; };
    const sTh = q(sat, 0.15), vTh = q(val, 0.70);
    // Couleur seule hors ville et image colorée; sinon (trottoirs, toits clairs, stationnements, image en noir et blanc) la
    // couleur ne sert pas, mais les entrées par le fossé LiDAR restent possibles (elles ne lisent que le relief).
    const colourOK = !(built / (Math.PI * 300 * 300) > 0.10 || sTh < 0.2 * 255);
    if (!colourOK) log(`entrées en gravier: zone urbaine ou image grise (bâti ${(100 * built / (Math.PI * 300 * 300)).toFixed(0)} %, saturation ${sTh}), couleur non utilisée${win ? ', fossé LiDAR seulement' : ''}`);
    if (!colourOK && !win) return { paved: polys, gravel, dense: false, shift: [Math.round(ox * mpp * 10) / 10, Math.round(-oy * mpp * 10) / 10] };
    // Classe LiDAR de chaque pixel de demi-résolution (0 inconnu, 1 nu et lisse, 2 autre), par le repère local.
    const cls = new Uint8Array(W2 * H2);
    if (win && win.fr) {
      const bm0 = bareMask(win);
      for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) { const [u, v] = win.fr.toPx((x * 2 + 1 + ox - cxp) * mpp, (cyp - y * 2 - 1 - oy) * mpp); const i = Math.round(u), j = Math.round(v); if (i < 0 || j < 0 || i >= win.W || j >= win.H) continue; cls[y * W2 + x] = bm0[j * win.W + i]; }
    }
    const vTh2 = q(val, 0.40); // clarté moins exigée sur le sol nu (ombres)
    const g2 = new Uint8Array(W2 * H2), g2old = dbg ? new Uint8Array(W2 * H2) : null;
    if (colourOK) for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
      const i = (2 * y) * W + 2 * x, c = cls[y * W2 + x], th = c === 1 ? vTh2 : vTh; let n = 0, n0 = 0;
      for (const j of [i, i + 1, i + W, i + W + 1]) { if (sat[j] < sTh && val[j] > th) n++; if (g2old && sat[j] < sTh && val[j] > vTh) n0++; }
      g2[y * W2 + x] = c !== 2 && n >= 2 ? 1 : 0; if (g2old) g2old[y * W2 + x] = n0 >= 2 ? 1 : 0;
    }
    const bm = new Uint8Array(W2 * H2); bld.forEach(b => fillPoly(bm, W2, H2, b[0].map(p => { const [u, v] = toPx(p); return [u / 2, v / 2]; }), 1));
    for (const w of water) { fillPoly(g2, W2, H2, w.o.map(p => { const [u, v] = toPx(p); return [u / 2, v / 2]; }), 0); if (g2old) fillPoly(g2old, W2, H2, w.o.map(p => { const [u, v] = toPx(p); return [u / 2, v / 2]; }), 0); }

    const bmd = dilate(bm, W2, H2, Math.round(1 / mp2));
    const rd = new Uint8Array(W2 * H2); roads.forEach(r => { const pts = r.p.map(p => { const [u, v] = toPx(p); return [u / 2, v / 2]; }); for (let i = 0; i + 1 < pts.length; i++) thickLine(rd, W2, H2, pts[i], pts[i + 1], Math.round((r.w / 2 + 1) / mp2), 1); });
    for (let i = 0; i < g2.length; i++) if (bmd[i] || rd[i]) g2[i] = 0;
    let gm = close(g2, W2, H2, Math.round(1.2 / mp2)); gm = open(gm, W2, H2, Math.round(1.0 / mp2));
    if (dbg) Object.assign(dbg, { W, H, W2, H2, cxp, cyp, mpp, ox, oy, rgb, sat, val, cls, g2: g2.slice(), g2old, gm: gm.slice(), rd, bmd, sTh, vTh, vTh2 });
    const nearRoad = dilate(rd, W2, H2, Math.round(2.5 / mp2)), nearBld = dilate(bm, W2, H2, Math.round(3 / mp2));
    // Composantes de la tache (4-connexité), étiquetées 1..n
    const glab = new Int32Array(W2 * H2), comps = [], minG = 12 / (mp2 * mp2), maxG = 1500 / (mp2 * mp2);
    for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
      const i = y * W2 + x; if (!gm[i] || glab[i]) continue;
      const id = comps.length + 1, stack = [i], comp = []; glab[i] = id; let tr = false, tb = false;
      while (stack.length) { const j = stack.pop(); comp.push(j); if (nearRoad[j]) tr = true; if (nearBld[j]) tb = true; const jx = j % W2, jy = (j - jx) / W2; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = jx + dx, ny = jy + dy; if (nx < 0 || ny < 0 || nx >= W2 || ny >= H2) continue; const q2 = ny * W2 + nx; if (gm[q2] && !glab[q2]) { glab[q2] = id; stack.push(q2); } } }
      comps.push({ comp, tr, tb });
    }
    // Entrées par le fossé LiDAR (api/driveways.js): du point d'entrée sur le bord de la rue, bande droite jusqu'au
    // point le plus proche du bâtiment le plus proche devant (dans 70 m, pas une remise de moins de 30 m² s'il y a
    // mieux, segment qui ne traverse aucun autre bâtiment ni la rue); largeur d'après l'interruption du fossé (0,6 fois,
    // 3 à 7 m). Le reste de la tache de couleur touchée au bout devient le rectangle du stationnement. À moins de 20 m
    // d'une entrée du fossé, les entrées tirées de la couleur seule sont abandonnées (celles du fossé sont plus sûres);
    // ailleurs (courbes, culs-de-sac, rues sans fossé) la couleur reste la seule source, comme avant.
    const toH = (p) => { const [u, v] = toPx(p); return [u / 2, v / 2]; };
    let ditchMask = null, nDitch = 0, nLost = 0;
    if (win) {
      const { entries, ditched } = ditchEntries(win, roads);
      ditchMask = new Uint8Array(W2 * H2); // zone de 20 m autour de chaque entrée du fossé: la couleur seule n'y ajoute rien
      for (const e of entries) { const [u, v] = toH([e.x, e.n]); const r = Math.round(20 / mp2); for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (dx * dx + dy * dy > r * r) continue; const i = Math.round(u) + dx, j = Math.round(v) + dy; if (i >= 0 && j >= 0 && i < W2 && j < H2) ditchMask[j * W2 + i] = 1; } }
      if (dbg) dbg.entries = entries;
      const area = (r) => Math.abs(r.reduce((t, p, i) => { const q = r[(i + 1) % r.length]; return t + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
      const segD = (p, a, b) => { const dx = b[0] - a[0], dn = b[1] - a[1], l2 = dx * dx + dn * dn || 1e-9, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dn) / l2)); return [Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dn), [a[0] + t * dx, a[1] + t * dn]]; };
      const bk = new Int32Array(W2 * H2); bld.forEach((b, k) => fillPoly(bk, W2, H2, b[0].map(toH), k + 1)); // quel bâtiment (dilaté de 1 m ci-dessous)
      { const t = bk.slice(); for (let y = 1; y < H2 - 1; y++) for (let x = 1; x < W2 - 1; x++) { const i = y * W2 + x; if (t[i]) continue; const r = 1 / mp2; for (let dy = -Math.ceil(r); dy <= Math.ceil(r) && !bk[i]; dy++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) { const q = t[(y + dy) * W2 + x + dx]; if (q) { bk[i] = q; break; } } } }
      const taken = [];
      for (const e of entries) {
        // Cible: un point du contour du bâtiment, échantillonné tous les mètres (pas seulement le plus proche: l'entrée
        // mène à la porte du garage, pas au coin), jugé par la distance, l'angle à la perpendiculaire et le soutien de
        // la tache de couleur le long du segment.
        let best = null;
        bld.forEach((b, k) => {
          const r = b[0]; let dmin = Infinity;
          for (let i = 0, j = r.length - 1; i < r.length; j = i++) dmin = Math.min(dmin, segD([e.x, e.n], r[j], r[i])[0]);
          if (dmin > 70) return;
          const A = area(r), kA = (A < 30 ? 1.8 : 1) * (1 + 20 / Math.max(5, A)); // la maison plutôt que la remise
          for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
            const a = r[j], c = r[i], L = Math.hypot(c[0] - a[0], c[1] - a[1]), nS = Math.max(1, Math.round(L));
            for (let si = 0; si <= nS; si++) {
              const pm = [a[0] + (c[0] - a[0]) * si / nS, a[1] + (c[1] - a[1]) * si / nS], dm = Math.hypot(pm[0] - e.x, pm[1] - e.n);
              if (dm > 70 || dm < 3) continue;
              const fwd = ((pm[0] - e.x) * e.nx + (pm[1] - e.n) * e.nn) / dm;
              if (fwd < 0.5) continue; // devant seulement, à moins de 60° de la perpendiculaire
              let hit = 0, tot = 0; for (let t = 2; t < dm; t += 1) { const [u, v] = toH([e.x + (pm[0] - e.x) * t / dm, e.n + (pm[1] - e.n) * t / dm]); const ui = Math.round(u), vj = Math.round(v); tot++; if (ui >= 0 && vj >= 0 && ui < W2 && vj < H2 && gm[vj * W2 + ui]) hit++; }
              const cover = tot ? hit / tot : 0, score = dm * kA * (1.6 - fwd) * (1.5 - cover);
              if (!best || score < best.score) best = { score, dm, pm, k };
            }
          }
        });
        if (!best) { nLost++; if (dbg) (dbg.lost = dbg.lost || []).push({ e: [e.x, e.n], gap: e.gap, why: 'aucun bâtiment devant' }); continue; }
        // La bande ne traverse ni rue ni autre bâtiment; elle s'arrête au mur (bk = ce bâtiment, dilaté de 1 m)
        const bkAt = (p) => { const [u, v] = toH(p); const i = Math.round(u), j = Math.round(v); return i >= 0 && j >= 0 && i < W2 && j < H2 ? bk[j * W2 + i] : 0; };
        const crossesOther = (() => { const a = [e.x, e.n], b = best.pm, L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = 2; t < L - 2; t += 1) { const p = [a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L], [u, v] = toH(p), i = Math.round(u), j = Math.round(v); if (i < 0 || j < 0 || i >= W2 || j >= H2) return true; const q = j * W2 + i; if (rd[q]) return true; if (bmd[q] && bk[q] !== best.k + 1) return true; } return false; })();
        if (crossesOther) { nLost++; if (dbg) (dbg.lost = dbg.lost || []).push({ e: [e.x, e.n], gap: e.gap, k: best.k, why: 'traverse une rue ou un bâtiment' }); continue; }
        if (taken.some(t => t.k === best.k && Math.hypot(t.p[0] - best.pm[0], t.p[1] - best.pm[1]) < 8)) continue; // doublon (même mur, à moins de 8 m)
        taken.push({ k: best.k, p: best.pm }); if (dbg) (dbg.bands = dbg.bands || []).push({ e: [e.x, e.n], gap: e.gap, k: best.k, dm: best.dm, pm: best.pm, area: area(bld[best.k][0]) });
        const pl = [toH([e.x, e.n]), toH(best.pm)], wPx = Math.max(3 / mp2, Math.min(6 / mp2, e.gap * 0.45 / mp2)); // l'apron au bord est bien plus large que l'entrée (mesuré: 4 m pour 10 m d'interruption)
        gravel.push({ o: bandPoly(pl, wPx, mp2, toM, 0, 1), h: [] }); nDitch++; ditch++;
        // Stationnement: composante de couleur touchée par le dernier tiers de la bande (hors bâtiment)
        let cid = 0; const [p0, p1] = pl;
        for (let t = 0.66; t <= 1 && !cid; t += 0.05) { const x = Math.round(p0[0] + (p1[0] - p0[0]) * t), y = Math.round(p0[1] + (p1[1] - p0[1]) * t); for (let dy = -2; dy <= 2 && !cid; dy++) for (let dx = -2; dx <= 2 && !cid; dx++) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W2 || ny >= H2) continue; cid = glab[ny * W2 + nx]; } }
        if (cid) { const c = comps[cid - 1]; if (c && !c.used && c.comp.length <= maxG) { c.used = true; const fr = farRect(c.comp, pl, wPx, bmd, W2, H2, mp2); if (fr) gravel.push({ o: toM(fr), h: [] }); } }
      }
    }
    // Entrées par la couleur seule: tache qui touche une rue et un bâtiment, loin des entrées du fossé
    let nColor = 0;
    for (let id = 1; id <= comps.length; id++) {
      const { comp, tr, tb, used } = comps[id - 1];
      if (used || comp.length < minG || comp.length > maxG || !tr || !tb) continue;
      if (ditchMask && comp.some(j => nearRoad[j] && ditchMask[j])) continue;
      for (const o of driveBands(comp, id, glab, nearRoad, nearBld, bmd, W2, H2, mp2, toM)) gravel.push({ o, h: [] }); // bandes droites (v633.179)
      nColor++;
    }
    log(`entrées en gravier: ${gravel.length} (${nDitch} par le fossé LiDAR, ${nLost} sans bâtiment à 70 m, ${nColor} par la couleur; seuils saturation < ${sTh}, clarté > ${vTh}, ${vTh2} sur sol nu${win ? '' : '; sans relevé'})`);
  } catch (e) { log(`entrées en gravier: ${e && e.message}`); }
  return { paved: polys, gravel, ditch, dense: false, shift: [Math.round(ox * mpp * 10) / 10, Math.round(-oy * mpp * 10) / 10] }; // [{ o: contour, h: [trous] }] en mètres locaux; ditch: entrées par le fossé LiDAR
}
