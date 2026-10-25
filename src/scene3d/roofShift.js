// Calage d'une image satellite sur les empreintes LiDAR par les toits (25 octobre 2026, partagé serveur et navigateur).
//
// Stéphane, devant un stationnement dessiné qui ne touchait pas sa maison: « pourquoi un si gros décalage? ». Cause:
// l'ancien critère (pixels sombres dedans moins pourtour, api/satshift.js contrastShift) se calait sur la masse
// sombre toit + ombre portée. Les ombres tombent d'un même côté sur toute l'image, d'où un biais constant: à Stoneham,
// l'image Plans d'Apple était poussée de 10 m vers le sud alors que ses toits ne demandent que 2 à 3 m. Tout ce qui
// était posé sur l'image (la maison importée) se retrouvait 7 m au sud du vrai bâtiment.
//
// Ici, on mesure les toits eux-mêmes: un pixel de toit est gris (saturation sous 0,22) et ni noir ni clair (valeur de
// 0,12 à 0,55); les arbres et le gazon sont verts, les ombres trop sombres, le gravier et les toits blancs trop clairs.
// Pour chaque empreinte LiDAR d'au moins 60 m², on cherche le décalage (±16 m) qui met le plus de toit dedans et le
// moins dans l'anneau de 1,5 à 4 m autour (sans les autres bâtiments); une empreinte n'est gardée que si son pic est
// net. Le décalage retenu est la médiane pondérée (les bâtiments proches du projet comptent plus), exigée en accord
// avec plusieurs bâtiments: des maisons régulièrement espacées le long d'une rue donnent de faux pics sur le toit du
// voisin, que la médiane écarte.
const S = 0.5; // m par cellule
const R = 16; // m de recherche
const MIN_AREA = 60, EDGE_IN = 0.5, RING_IN = 1.5, RING_OUT = 4;

const inRing = (x, y, r) => { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) ins = !ins; } return ins; };
const segD = (x, y, a, b) => { const dx = b[0] - a[0], dn = b[1] - a[1], l2 = dx * dx + dn * dn || 1e-9, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dn) / l2)); return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dn); };
const edgeD = (x, y, r) => { let d = Infinity; for (let i = 0, j = r.length - 1; i < r.length; j = i++) d = Math.min(d, segD(x, y, r[j], r[i])); return d; };
const areaOf = (r) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const centre = (r) => [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length];
const bbox = (r) => { let x0 = Infinity, x1 = -Infinity, n0 = Infinity, n1 = -Infinity; for (const [x, n] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); n0 = Math.min(n0, n); n1 = Math.max(n1, n); } return [x0, n0, x1, n1]; };

export const isRoof = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), v = mx / 255, s = mx ? (mx - mn) / mx : 0; return s < 0.22 && v < 0.55 && v > 0.12; };

// Grille de toits d'une image quelconque: half = demi-côté couvert (m, centré en 0, 0), roofAt(x, n) = part de toit (0 à 1)
// au point local (x est, n nord). Sert à l'image Esri de api/paved.js (mosaïque de tuiles, autre échelle).
export function roofGridFrom(half, roofAt) {
  const N = Math.round(2 * half / S), g = new Float32Array(N * N), x0 = -half, n0 = -half;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) g[j * N + i] = roofAt(x0 + (i + 0.5) * S, n0 + (j + 0.5) * S);
  return { g, N, x0, n0 };
}

// Part de toit de chaque cellule de 0,5 m (rangée 0 au sud), d'après l'image RGBA de côté `side` mètres centrée en (0, 0).
export function roofGrid(rgba, W, H, side) {
  const N = Math.round(side / S), g = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const py0 = Math.floor((N - 1 - j) * H / N), py1 = Math.max(py0 + 1, Math.floor((N - j) * H / N));
    for (let i = 0; i < N; i++) {
      const px0 = Math.floor(i * W / N), px1 = Math.max(px0 + 1, Math.floor((i + 1) * W / N));
      let k = 0, t = 0;
      for (let py = py0; py < py1 && py < H; py++) for (let px = px0; px < px1 && px < W; px++) {
        const o = (py * W + px) * 4;
        t++; if (isRoof(rgba[o], rgba[o + 1], rgba[o + 2])) k++;
      }
      g[j * N + i] = t ? k / t : 0;
    }
  }
  return { g, N, x0: -side / 2, n0: -side / 2 };
}

// Décalage d'une empreinte: { shift: [est, nord] à ajouter à l'image, best, second } ou null si trop peu de cellules.
function oneBuilding(grid, ring, others) {
  const { g, N, x0, n0 } = grid, [bx0, bn0, bx1, bn1] = bbox(ring);
  const near = others.filter(o => { const [a, b, c, d] = o.bb; return c > bx0 - RING_OUT && a < bx1 + RING_OUT && d > bn0 - RING_OUT && b < bn1 + RING_OUT; });
  const inC = [], ringC = [];
  const i0 = Math.floor((bx0 - RING_OUT - x0) / S), i1 = Math.ceil((bx1 + RING_OUT - x0) / S), j0 = Math.floor((bn0 - RING_OUT - n0) / S), j1 = Math.ceil((bn1 + RING_OUT - n0) / S);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if (i < 0 || j < 0 || i >= N || j >= N) continue;
    const x = x0 + (i + 0.5) * S, n = n0 + (j + 0.5) * S, ins = inRing(x, n, ring), d = edgeD(x, n, ring);
    if (ins && d >= EDGE_IN) inC.push(j * N + i);
    else if (!ins && d >= RING_IN && d <= RING_OUT && !near.some(o => inRing(x, n, o.r))) ringC.push(j * N + i);
  }
  if (inC.length < 80 || ringC.length < 80) return null;
  // Image décalée de d: la cellule c de l'empreinte voit le pixel c - d.
  const score = (dx, dy) => {
    let a = 0, b = 0;
    for (const c of inC) { const i = c % N - dx, j = (c - c % N) / N - dy; if (i >= 0 && j >= 0 && i < N && j < N) a += g[j * N + i]; }
    for (const c of ringC) { const i = c % N - dx, j = (c - c % N) / N - dy; if (i >= 0 && j >= 0 && i < N && j < N) b += g[j * N + i]; }
    return a / inC.length - b / ringC.length;
  };
  const K = Math.round(R / S), coarse = [];
  let best = -Infinity, bx = 0, by = 0;
  for (let dy = -K; dy <= K; dy += 2) for (let dx = -K; dx <= K; dx += 2) { const v = score(dx, dy); coarse.push([dx, dy, v]); if (v > best) { best = v; bx = dx; by = dy; } }
  let second = -Infinity; for (const [dx, dy, v] of coarse) if (Math.max(Math.abs(dx - bx), Math.abs(dy - by)) * S >= 3) second = Math.max(second, v);
  const cx = bx, cy = by; // affinage au demi-mètre autour du pic
  for (let dy = cy - 2; dy <= cy + 2; dy++) for (let dx = cx - 2; dx <= cx + 2; dx++) { const v = score(dx, dy); if (v > best) { best = v; bx = dx; by = dy; } }
  return { shift: [bx * S, by * S], best, second };
}

// Décalage de l'image (m est, m nord à ajouter à sa position) d'après les empreintes LiDAR (bld[i][5] === 1) de la
// scène; centre: point du projet (mètres locaux) autour duquel les bâtiments comptent le plus. { shift, used, agree,
// total } ou null quand les toits ne s'accordent pas (pas assez d'empreintes nettes).
export function roofShift(rgba, W, H, side, bld, centreXY = [0, 0], dbg = null) { // dbg: tableau rempli des mesures par bâtiment (banc)
  return roofShiftGrid(roofGrid(rgba, W, H, side), side, bld, centreXY, dbg);
}
export function roofShiftGrid(grid, side, bld, centreXY = [0, 0], dbg = null) {
  const lid = [];
  for (const b of bld) if (b[5] === 1 && b[0] && b[0].length >= 3) lid.push({ r: b[0], bb: bbox(b[0]) });
  const found = [];
  for (const o of lid) {
    const A = areaOf(o.r); if (A < MIN_AREA) continue;
    const c = centre(o.r); if (Math.abs(c[0]) > side / 2 - R - 6 || Math.abs(c[1]) > side / 2 - R - 6) continue;
    const m = oneBuilding(grid, o.r, lid.filter(x => x !== o)); if (dbg) dbg.push({ c, A, m }); if (!m) continue;
    if (m.best < 0.35 || m.best - m.second < 0.10) continue; // pic flou: toit pâle, caché par les arbres, ou voisins identiques
    const d = Math.hypot(c[0] - centreXY[0], c[1] - centreXY[1]);
    found.push({ s: m.shift, w: 1 / (1 + (d / 60) ** 2), d });
  }
  if (found.length < 2) return null;
  const wmed = (k) => { const a = found.map(f => [f.s[k], f.w]).sort((p, q) => p[0] - q[0]), tot = a.reduce((t, x) => t + x[1], 0); let acc = 0; for (const [v, w] of a) { acc += w; if (acc >= tot / 2) return v; } return a[a.length - 1][0]; };
  const shift = [wmed(0), wmed(1)];
  const tot = found.reduce((t, f) => t + f.w, 0), agreeing = found.filter(f => Math.hypot(f.s[0] - shift[0], f.s[1] - shift[1]) <= 2.5);
  const wAgree = agreeing.reduce((t, f) => t + f.w, 0);
  if (agreeing.length < 2 || wAgree < 0.5 * tot) return null;
  // Moyenne des bâtiments en accord (plus fine que la médiane au demi-mètre), arrondie au demi-mètre
  const mean = (k) => Math.round(2 * agreeing.reduce((t, f) => t + f.s[k] * f.w, 0) / wAgree) / 2;
  return { shift: [mean(0), mean(1)], used: agreeing.length, total: found.length, agree: wAgree / tot };
}
