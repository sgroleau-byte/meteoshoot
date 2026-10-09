// Calage de l'image Plans d'Apple sur les empreintes des bâtiments, côté serveur (9 octobre 2026).
//
// L'image satellite d'Apple est décalée de quelques mètres par rapport au LiDAR (Stoneham: 10 m trop au nord). Le
// calage se faisait dans le navigateur (satDrape.js, satShift) et ne s'appliquait pas chez Stéphane sans qu'on sache
// pourquoi (son navigateur, l'ordre des chargements). Ici, la même mesure est faite une fois pour toutes avec la scène,
// avec la clé Apple du serveur: la même image que celle que le navigateur affichera (même centre, même zoom), ramenée
// au mètre; ses pixels sombres (clarté sous le 25e centile: les toits, hors ville) contre les empreintes. Le résultat (mètres est et
// nord à ajouter à la position de l'image) voyage dans la scène (appleShift) et le navigateur l'applique tel quel.
// null sans clé (développement local sans identifiants) ou en cas d'échec: le navigateur garde son propre calage.
// Critère (v633.184): contraste dedans/dehors (contrastShift), voir plus bas; le compte de pixels sombres seul donnait
// chez Stéphane 8 m est et 12 m nord (faux pic en bord de fenêtre) au lieu de 2 m est et 10 m sud.
import { PNG } from 'pngjs';
import { snapshotRequest } from './apple-snapshot.js';

const Z = 18;
const satSide = (lat) => 640 * 156543.03392 * Math.cos(lat * Math.PI / 180) / 2 ** Z; // comme satDrape.js
function inRing(x, y, r) { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) ins = !ins; } return ins; }

export async function appleShift(lat, lng, bld, log = () => {}) {
  const req = snapshotRequest(lat, lng, Z);
  if (!req) { log('calage Plans d\'Apple: pas de clé ici'); return null; }
  const r = await fetch(req.url, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) { log(`calage Plans d'Apple: image refusée (${r.status})`); return null; }
  const png = PNG.sync.read(Buffer.from(await r.arrayBuffer()));
  const W = png.width, H = png.height, side = satSide(lat), N = Math.max(32, Math.round(side));
  // Grille au mètre, rangée j = 0 au sud (l'image a sa rangée 0 au nord).
  const val = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const px = Math.min(W - 1, Math.floor((i + 0.5) * W / N)), py = Math.min(H - 1, Math.floor((N - 1 - j + 0.5) * H / N)), o = (py * W + px) * 4;
    val[j * N + i] = 0.299 * png.data[o] + 0.587 * png.data[o + 1] + 0.114 * png.data[o + 2];
  }
  const q25 = Float32Array.from(val).sort()[Math.floor(N * N * 0.25)], dark = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) dark[i] = val[i] < q25 ? 1 : 0;
  // Empreintes sur la grille (dedans) et anneau de 2 à 4 m autour (dehors): un toit est sombre et son pourtour (gazon,
  // entrée) plus clair; une ombre d'arbre ou un stationnement est sombre dedans et dehors. Le critère est la part de
  // pixels sombres dedans moins celle de l'anneau: un pic net au bon décalage, là où le simple compte de pixels sombres
  // hésitait entre les toits et les ombres (Stoneham, à 30 m près, deux pics à 1 % l'un de l'autre, le faux à la limite).
  const x0 = -side / 2, n0 = -side / 2, inside = new Uint8Array(N * N);
  for (const b of bld) {
    const ring = b[0]; let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
    for (const [x, n] of ring) { i0 = Math.min(i0, x - x0); i1 = Math.max(i1, x - x0); j0 = Math.min(j0, n - n0); j1 = Math.max(j1, n - n0); }
    if (i1 < 0 || j1 < 0 || i0 > N || j0 > N) continue;
    for (let j = Math.max(0, Math.floor(j0)); j <= Math.min(N - 1, Math.ceil(j1)); j++) for (let i = Math.max(0, Math.floor(i0)); i <= Math.min(N - 1, Math.ceil(i1)); i++) if (inRing(x0 + i + 0.5, n0 + j + 0.5, ring)) inside[j * N + i] = 1;
  }
  const cs = contrastShift(inside, dark, N);
  if (!cs) { log('calage Plans d\'Apple: trop peu de bâtiments dans l\'image'); return [0, 0]; }
  const out = cs.ok ? [-cs.dx, -cs.dy] : [0, 0];
  log(`calage Plans d'Apple: ${out[0]} m est, ${out[1]} m nord (contraste ${cs.best.toFixed(3)} contre ${cs.second.toFixed(3)} au 2e pic${cs.ok ? '' : ', pas assez net: pas de recalage'})`);
  return out;
}

// Décalage (dx, dy en cellules) qui maximise le contraste dedans/dehors; { ok, dx, dy, best, second } ou null sans
// empreintes. Recherche à ±16 m; accepté si le contraste atteint 0,08, fait 1,3 fois le 2e pic (à 4 m et plus) et
// n'est pas en bord de fenêtre.
export function contrastShift(inside, dark, N) {
  const dil = (m, k) => { const o = new Uint8Array(N * N); for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { if (!m[j * N + i]) continue; for (let dy = -k; dy <= k; dy++) for (let dx = -k; dx <= k; dx++) { const u = i + dx, v = j + dy; if (u >= 0 && v >= 0 && u < N && v < N) o[v * N + u] = 1; } } return o; };
  const d1 = dil(inside, 1), d4 = dil(inside, 4), inC = [], ringC = [];
  for (let k = 0; k < N * N; k++) { if (inside[k]) inC.push(k); else if (d4[k] && !d1[k]) ringC.push(k); }
  if (inC.length < 50 || ringC.length < 50) return null;
  const part = (cells, dx, dy) => { let s = 0, n = 0; for (const k of cells) { const i0 = k % N, i = i0 + dx, j = (k - i0) / N + dy; if (i >= 0 && j >= 0 && i < N && j < N) { n++; s += dark[j * N + i]; } } return n ? s / n : 0; };
  const R = 16, S = new Float32Array((2 * R + 1) * (2 * R + 1));
  let best = -Infinity, bx = 0, by = 0;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const v = part(inC, dx, dy) - part(ringC, dx, dy); S[(dy + R) * (2 * R + 1) + dx + R] = v; if (v > best) { best = v; bx = dx; by = dy; } }
  let second = -Infinity;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (Math.max(Math.abs(dx - bx), Math.abs(dy - by)) >= 4) second = Math.max(second, S[(dy + R) * (2 * R + 1) + dx + R]);
  const ok = best >= 0.08 && best >= 1.3 * second && Math.abs(bx) <= R - 2 && Math.abs(by) <= R - 2;
  return { ok, dx: bx, dy: by, best, second };
}

