// Calage de l'image Plans d'Apple sur les empreintes des bâtiments, côté serveur (10 octobre 2026).
//
// L'image satellite d'Apple est décalée de quelques mètres par rapport au LiDAR (Stoneham: 10 m trop au nord). Le
// calage se faisait dans le navigateur (satDrape.js, satShift) et ne s'appliquait pas chez Stéphane sans qu'on sache
// pourquoi (son navigateur, l'ordre des chargements). Ici, la même mesure est faite une fois pour toutes avec la scène,
// avec la clé Apple du serveur: la même image que celle que le navigateur affichera (même centre, même zoom), ramenée
// au mètre; ses pixels sombres (clarté sous le 25e centile: les toits, hors ville) contre les empreintes, décalage
// cherché à ±12 m, gardé s'il fait 1,5 fois mieux que sans décalage et couvre 50 pixels. Le résultat (mètres est et
// nord à ajouter à la position de l'image) voyage dans la scène (appleShift) et le navigateur l'applique tel quel.
// null sans clé (développement local sans identifiants) ou en cas d'échec: le navigateur garde son propre calage.
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
  const x0 = -side / 2, n0 = -side / 2, cells = [];
  for (const b of bld) {
    const ring = b[0]; let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
    for (const [x, n] of ring) { i0 = Math.min(i0, x - x0); i1 = Math.max(i1, x - x0); j0 = Math.min(j0, n - n0); j1 = Math.max(j1, n - n0); }
    if (i1 < 0 || j1 < 0 || i0 > N || j0 > N) continue;
    for (let j = Math.max(0, Math.floor(j0)); j <= Math.min(N - 1, Math.ceil(j1)); j++) for (let i = Math.max(0, Math.floor(i0)); i <= Math.min(N - 1, Math.ceil(i1)); i++) if (inRing(x0 + i + 0.5, n0 + j + 0.5, ring)) cells.push(j * N + i);
  }
  if (cells.length < 50) { log('calage Plans d\'Apple: trop peu de bâtiments dans l\'image'); return [0, 0]; }
  const score = (dx, dy) => { let s = 0; for (const k of cells) { const i0 = k % N, i = i0 + dx, j = (k - i0) / N + dy; if (i >= 0 && j >= 0 && i < N && j < N && dark[j * N + i]) s++; } return s; };
  const s0 = score(0, 0); let best = s0, bx = 0, by = 0;
  for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) { const sc = score(dx, dy); if (sc > best) { best = sc; bx = dx; by = dy; } }
  const ok = best >= 1.5 * s0 && best >= 50, out = ok ? [-bx, -by] : [0, 0];
  log(`calage Plans d'Apple: ${out[0]} m est, ${out[1]} m nord (${best} contre ${s0}${ok ? '' : ', pas assez net: pas de recalage'})`);
  return out;
}
