// Surfaces pavées (béton, asphalte: stationnements, aires, voies de circulation, cours) d'après l'imagerie satellite,
// pour les lieux où ni Overture ni OpenStreetMap ne les connaissent (cours d'école, stationnements privés, héliports...).
// Méthode sans intelligence artificielle: tuiles Esri World Imagery (zoom 19, 0,2 m par pixel) classées par couleur
// (béton clair peu saturé, asphalte neutre ou bleuté; l'herbe, la terre et la forêt sont exclues), moins les bâtiments et
// les rues déjà connus, nettoyées par morphologie, puis vectorisées en contours simplifiés au mètre. Résultat
// approximatif (bords au mètre près, gravier et sols nus parfois pris pour du pavé): la vue 3D le dit en légende.
// Désactivé en zone dense (plus de 18 % du sol bâti dans 300 m), où tout est gris.
import jpeg from 'jpeg-js';

const Z = 19, HALF_M = 320, TILE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
export const PAVED_ATTRIBUTION = 'Esri, Maxar, Earthstar Geographics';

const tileXY = (lat, lng) => { const n = 2 ** Z; return [(lng + 180) / 360 * n, (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n]; };

async function fetchTile(tx, ty) {
  const r = await fetch(`${TILE}/${Z}/${ty}/${tx}`, { headers: { 'User-Agent': 'MeteoShoot (www.meteoshoot.com)' } });
  if (!r.ok) throw new Error('tuile ' + r.status);
  return jpeg.decode(Buffer.from(await r.arrayBuffer()), { useTArray: true, formatAsRGBA: true });
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

// Surfaces pavées en mètres locaux autour de (lat, lng); bld = [[ring, h, fl, kind]], roads = [{w, k, p}] (mètres locaux).
export async function pavedFromImagery(lat, lng, bld, roads, log = () => {}) {
  const mLat = 111320, mLng = 111320 * Math.cos(lat * Math.PI / 180);
  const area = (r) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
  const built = bld.filter(b => Math.hypot(...b[0].reduce((c, p) => [c[0] + p[0] / b[0].length, c[1] + p[1] / b[0].length], [0, 0])) < 300).reduce((s, b) => s + area(b[0]), 0);
  if (built / (Math.PI * 300 * 300) > 0.18) { log('zone dense, surfaces pavées non détectées'); return { paved: [], dense: true }; }
  const [cx, cy] = tileXY(lat, lng), mpp = 156543.03 * Math.cos(lat * Math.PI / 180) / 2 ** Z, halfT = HALF_M / mpp / 256;
  const x0 = Math.floor(cx - halfT), x1 = Math.floor(cx + halfT), y0 = Math.floor(cy - halfT), y1 = Math.floor(cy + halfT);
  const W = (x1 - x0 + 1) * 256, H = (y1 - y0 + 1) * 256, cxp = (cx - x0) * 256, cyp = (cy - y0) * 256;
  const mask = new Uint8Array(W * H);
  const jobs = []; for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) jobs.push([tx, ty]);
  let k = 0; const worker = async () => { while (k < jobs.length) { const [tx, ty] = jobs[k++]; let im; try { im = await fetchTile(tx, ty); } catch (e) { continue; } const d = im.data; for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) { const i = (y * 256 + x) * 4; if (isPaved(d[i], d[i + 1], d[i + 2])) mask[(ty - y0) * 256 * W + (tx - x0) * 256 + y * W + x] = 1; } } };
  await Promise.all(Array.from({ length: 12 }, worker));
  // Bâtiments (dilatés de 2,5 m) et rues (largeur + 2 m) retirés
  const toPx = (p) => [cxp + p[0] / mpp, cyp - p[1] / mpp];
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
  const toM = (c) => c.map(p => [Math.round((p[0] * 2 - cxp) * mpp * 10) / 10, Math.round((cyp - p[1] * 2) * mpp * 10) / 10]);
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
  return { paved: polys, dense: false }; // [{ o: contour, h: [trous] }] en mètres locaux
}
