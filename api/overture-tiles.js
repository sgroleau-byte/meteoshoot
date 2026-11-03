// Tuiles Overture (v633.268, 3 novembre 2026): la lecture d'Overture par DuckDB dans les Parquet (13 s sur 28 d'un
// calcul d'environs en production) est remplacée, là où elles existent, par quelques petits fichiers pré-découpés lus
// dans le stockage Supabase (seau public « overture », fichiers gzip). Deux grilles: « f » (bâtiments, parties de
// bâtiment, rues, sol, usage du sol; tuiles de 0,05 degré) et « w » (eau; 0,1 degré). Chaque entité est rangée dans les
// tuiles que son cadre Overture touche, telle quelle; le serveur lit les tuiles que touche son cadre de lecture (deux à
// quatre par grille, en même temps), dédoublonne (clé « o »: fichier Parquet puis numéro de ligne), applique le même
// filtre par cadre que la requête DuckDB et remet les lignes dans l'ordre d'origine: le résultat est celui de la lecture
// directe (le tirage des arbres des boisés suit cet ordre). Les grandes entités (lac, forêt, autoroute: plus de 300
// sommets) sont à part: rangées, découpées, dans chaque tuile dont le cadre agrandi de la marge (600 m pour f, dont les
// rayons de lecture vont jusqu'à 500 m; 2 600 m pour w, rayon 2 500 m) touche leur cadre, et lues seulement dans la
// tuile du lieu (drapeau « x »), ce qui évite les coutures; les boisés gardent le cadre et l'aire de leur contour
// d'origine (« ob », « oa ») pour que le tirage reste le même. Tuiles trop lourdes (centre-ville) subdivisées en quatre
// (quadtree, niveau z) d'après le manifeste. Hors couverture, manifeste illisible ou tuile injoignable: lecture DuckDB.
// Génération et envoi: node scripts/overture-tiles.mjs (à refaire à chaque changement de RELEASE dans api/scene3d.js).
// Vérification tuiles contre DuckDB: node scripts/overture-tiles-check.mjs.

import { gunzipSync } from 'zlib';
import { SUPABASE_URL } from '../src/shared/config.js';

export const TILES_V = 1; // format des tuiles et du manifeste
// Grilles: taille de la tuile de base (degrés), rayon de lecture le plus grand (m), marge de découpe des grandes
// entités (m, au-delà du rayon), subdivision la plus fine (z).
export const GRIDS = {
  f: { deg: 0.05, radius: 500, margin: 600, maxZ: 2 },   // bâtiments, parties, rues, sol, usage du sol (rayons 340 à 500 m)
  w: { deg: 0.1, radius: 2500, margin: 2600, maxZ: 1 },  // eau (rayon 2 500 m)
};
export const TILES_URL = (process.env.OVERTURE_TILES_URL || `${SUPABASE_URL}/storage/v1/object/public/overture`).replace(/\/$/, '');

export const tileSize = (grid, z) => GRIDS[grid].deg / 2 ** z;
export function tileAt(grid, z, lng, lat) { const s = tileSize(grid, z); return [Math.floor((lng + 180) / s), Math.floor((lat + 90) / s)]; }
export function tileBox(grid, z, ix, iy) { const s = tileSize(grid, z); return [ix * s - 180, iy * s - 90, (ix + 1) * s - 180, (iy + 1) * s - 90]; }
// Cadre agrandi de m mètres de chaque côté (degrés; la longitude selon la latitude du centre).
export function expandBox([x0, y0, x1, y1], m) { const c = (y0 + y1) / 2 * Math.PI / 180, dy = m / 111320, dx = m / (111320 * Math.cos(c)); return [x0 - dx, y0 - dy, x1 + dx, y1 + dy]; }
export const boxesMeet = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
export const boxInside = (a, b) => a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];
export const tileKey = (z, ix, iy) => `${z}/${ix}_${iy}`;
export const tilePath = (release, grid, z, ix, iy) => `${release}/${grid}/${z}/${ix}_${iy}.json.gz`;
// Cadre Overture (float32) écrit court: le nombre le plus court dont l'arrondi en float32 redonne la valeur exacte.
export function f32s(v) { for (let p = 6; p <= 9; p++) { const n = Number(v.toPrecision(p)); if (Math.fround(n) === v) return n; } return v; }

// ---------- géométrie partagée (WKB d'Overture, découpe)
export function wkbToGeom(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 0;
  const geom = () => {
    const le = buf[o] === 1; o += 1;
    let type = dv.getUint32(o, le); o += 4;
    if (type & 0x20000000) { o += 4; type &= ~0x20000000; } // SRID
    const dims = type >= 3000 ? 4 : type >= 1000 ? 3 : 2;   // Z / M / ZM
    type = type % 1000;
    const pt = () => { const x = dv.getFloat64(o, le), y = dv.getFloat64(o + 8, le); o += 8 * dims; return [x, y]; };
    const ring = () => { const n = dv.getUint32(o, le); o += 4; const r = []; for (let i = 0; i < n; i++) r.push(pt()); return r; };
    const rings = () => { const n = dv.getUint32(o, le); o += 4; const r = []; for (let i = 0; i < n; i++) r.push(ring()); return r; };
    const many = () => { const n = dv.getUint32(o, le); o += 4; const r = []; for (let i = 0; i < n; i++) r.push(geom()); return r; };
    switch (type) {
      case 1: return { t: 'Point', c: pt() };
      case 2: return { t: 'Line', c: ring() };
      case 3: return { t: 'Poly', c: rings() };
      case 4: return { t: 'MPoint', c: many().map(g => g.c) };
      case 5: return { t: 'MLine', c: many().map(g => g.c) };
      case 6: return { t: 'MPoly', c: many().map(g => g.c) };
      case 7: return { t: 'Coll', c: many() };
      default: throw new Error('WKB type ' + type);
    }
  };
  return geom();
}
export const polysOf = (g) => g.t === 'Poly' ? [g.c] : g.t === 'MPoly' ? g.c : g.t === 'Coll' ? g.c.flatMap(polysOf) : [];
export const linesOf = (g) => g.t === 'Line' ? [g.c] : g.t === 'MLine' ? g.c : g.t === 'Coll' ? g.c.flatMap(linesOf) : [];
export const pointsOf = (g) => g.t === 'Point' ? [g.c] : g.t === 'MPoint' ? g.c : g.t === 'Coll' ? g.c.flatMap(pointsOf) : [];
export const signedArea = (r) => { let a = 0; for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
// Découpe d'un anneau par un rectangle (Sutherland-Hodgman)
export function clipRing(r, minx, miny, maxx, maxy) {
  const edges = [
    [(p) => p[0] >= minx, (a, b) => [minx, a[1] + (b[1] - a[1]) * (minx - a[0]) / (b[0] - a[0])]],
    [(p) => p[0] <= maxx, (a, b) => [maxx, a[1] + (b[1] - a[1]) * (maxx - a[0]) / (b[0] - a[0])]],
    [(p) => p[1] >= miny, (a, b) => [a[0] + (b[0] - a[0]) * (miny - a[1]) / (b[1] - a[1]), miny]],
    [(p) => p[1] <= maxy, (a, b) => [a[0] + (b[0] - a[0]) * (maxy - a[1]) / (b[1] - a[1]), maxy]],
  ];
  let out = r;
  for (const [inside, inter] of edges) {
    const inp = out; out = [];
    if (!inp.length) break;
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
      if (inside(cur)) { if (!inside(prev)) out.push(inter(prev, cur)); out.push(cur); }
      else if (inside(prev)) out.push(inter(prev, cur));
    }
  }
  return out;
}
// Découpe d'une ligne par un rectangle (Liang-Barsky segment par segment): morceaux à l'intérieur, dans l'ordre.
export function clipLine(pts, minx, miny, maxx, maxy) {
  const pieces = []; let cur = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1];
    let t0 = 0, t1 = 1, ok = true;
    for (const [p, q] of [[-dx, a[0] - minx], [dx, maxx - a[0]], [-dy, a[1] - miny], [dy, maxy - a[1]]]) {
      if (p === 0) { if (q < 0) { ok = false; break; } continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) { ok = false; break; } if (t > t0) t0 = t; } else { if (t < t0) { ok = false; break; } if (t < t1) t1 = t; }
    }
    if (!ok) { cur = null; continue; }
    const p0 = t0 === 0 ? a : [a[0] + t0 * dx, a[1] + t0 * dy], p1 = t1 === 1 ? b : [a[0] + t1 * dx, a[1] + t1 * dy];
    if (cur && cur[cur.length - 1] === p0) cur.push(p1); else { cur = [p0, p1]; pieces.push(cur); }
    if (t1 !== 1) cur = null;
  }
  return pieces;
}

// ---------- codage des géométries dans les tuiles: [type, coordonnées]
const T_CODE = { Point: 'P', Line: 'L', Poly: 'G', MPoint: 'MP', MLine: 'ML', MPoly: 'MG' };
const T_NAME = Object.fromEntries(Object.entries(T_CODE).map(([k, v]) => [v, k]));
export const encodeGeom = (g) => g.t === 'Coll' ? ['C', g.c.map(encodeGeom)] : [T_CODE[g.t], g.c];
export const decodeGeom = ([t, c]) => t === 'C' ? { t: 'Coll', c: c.map(decodeGeom) } : { t: T_NAME[t], c };
export const nVertices = (g) => g.t === 'Point' ? 1 : g.t === 'Line' || g.t === 'MPoint' ? g.c.length : g.t === 'Poly' ? g.c.reduce((n, r) => n + r.length, 0) : g.t === 'Coll' ? g.c.reduce((n, s) => n + nVertices(s), 0) : g.c.reduce((n, p) => n + (g.t === 'MLine' ? p.length : p.reduce((m, r) => m + r.length, 0)), 0);

// ---------- lecture côté serveur
let MEM = { release: null, at: 0, m: undefined };
async function manifest(release) {
  const ttl = MEM.m ? 600000 : 60000; // manifeste absent ou injoignable: on réessaie après une minute
  if (MEM.release === release && MEM.m !== undefined && Date.now() - MEM.at < ttl) return MEM.m;
  let m = null;
  try {
    const r = await fetch(`${TILES_URL}/${release}/manifest.json`, { signal: AbortSignal.timeout(4000) });
    if (r.ok) {
      m = await r.json();
      // Le manifeste doit décrire les grilles de ce code (taille des tuiles, marge de découpe au moins égale au rayon de
      // lecture); la subdivision (z) se lit dans son seul relevé des tuiles subdivisées.
      const ok = m && m.v === TILES_V && m.release === release && Array.isArray(m.covered) && m.grids && Object.keys(GRIDS).every((g) => m.grids[g] && m.grids[g].deg === GRIDS[g].deg && m.grids[g].margin >= GRIDS[g].radius);
      if (!ok) m = null;
    } else if (r.status !== 404 && r.status !== 400) throw new Error('HTTP ' + r.status);
  } catch (e) { m = null; }
  MEM = { release, at: Date.now(), m };
  return m;
}
export async function fetchTile(path) { // null: tuile absente (vide); lève si injoignable ou illisible
  const r = await fetch(`${TILES_URL}/${path}`, { signal: AbortSignal.timeout(8000) });
  if (r.status === 404 || r.status === 400) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status} (${path})`);
  const buf = Buffer.from(await r.arrayBuffer());
  const t = JSON.parse(gunzipSync(buf).toString('utf8'));
  if (!t || t.v !== TILES_V) throw new Error(`tuile de format ${t && t.v} (${path})`);
  t.bytes = buf.length;
  return t;
}
// Feuilles du quadtree d'une grille qui touchent un cadre, d'après le manifeste (tuiles subdivisées).
export function leavesFor(m, grid, box) {
  const split = new Set((m.split && m.split[grid]) || []), out = [];
  const visit = (z, ix, iy) => {
    if (!boxesMeet(tileBox(grid, z, ix, iy), box)) return;
    if (z < 8 && split.has(tileKey(z, ix, iy))) { for (const [cx, cy] of [[2 * ix, 2 * iy], [2 * ix + 1, 2 * iy], [2 * ix, 2 * iy + 1], [2 * ix + 1, 2 * iy + 1]]) visit(z + 1, cx, cy); }
    else out.push([z, ix, iy]);
  };
  const [ax, ay] = tileAt(grid, 0, box[0], box[1]), [bx, by] = tileAt(grid, 0, box[2], box[3]);
  for (let iy = ay; iy <= by; iy++) for (let ix = ax; ix <= bx; ix++) visit(0, ix, iy);
  return out;
}
const decodeRow = (r) => { const d = { ...r, geom: decodeGeom(r.g), bb: r.bb.map(Math.fround) }; delete d.g; return d; };
// Lignes d'Overture pour le lieu, lues des tuiles: { b, p, s, l, u, w, paths, bytes, ms }, ou null hors couverture ou
// quand le manifeste est illisible (le serveur relit alors les Parquet). Une tuile injoignable lève.
export async function readTiles(lat, lng, release) {
  const m = await manifest(release);
  if (!m) return null;
  if (!m.covered.some(([x0, y0, x1, y1]) => lng >= x0 && lng < x1 && lat >= y0 && lat < y1)) return null;
  const t0 = Date.now();
  const mLat = 111320, mLng = 111320 * Math.cos(lat * Math.PI / 180);
  const out = { b: [], p: [], s: [], l: [], u: [], w: [], paths: [], bytes: 0 };
  await Promise.all(['f', 'w'].map(async (grid) => {
    const r = GRIDS[grid].radius, box = [lng - r / mLng, lat - r / mLat, lng + r / mLng, lat + r / mLat];
    const [hx, hy] = [lng, lat];
    const leaves = leavesFor(m, grid, box);
    // La tuile du lieu d'abord: ses grandes entités découpées (x) sont les seules gardées.
    leaves.sort((a, b) => (boxesMeet(tileBox(grid, b[0], b[1], b[2]), [hx, hy, hx, hy]) ? 1 : 0) - (boxesMeet(tileBox(grid, a[0], a[1], a[2]), [hx, hy, hx, hy]) ? 1 : 0));
    const tiles = await Promise.all(leaves.map(([z, ix, iy]) => fetchTile(tilePath(release, grid, z, ix, iy))));
    const seen = {};
    tiles.forEach((t, i) => {
      out.paths.push(tilePath(release, grid, ...leaves[i]).slice(release.length + 1) + (t ? '' : ' (vide)'));
      if (!t) return;
      out.bytes += t.bytes;
      for (const k of Object.keys(out)) {
        if (!Array.isArray(t[k])) continue;
        const s = seen[k] || (seen[k] = new Set());
        for (const row of t[k]) {
          if (row.x) { if (i !== 0) continue; } else { if (s.has(row.o)) continue; s.add(row.o); }
          out[k].push(decodeRow(row));
        }
      }
    });
  }));
  out.ms = Date.now() - t0;
  return out;
}
