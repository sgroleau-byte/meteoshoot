// Fonction serveur (Vercel): les environs d'un lieu pour la vue 3D de la fiche projet.
// Source: Overture Maps (données ouvertes: empreintes de bâtiments Microsoft et OpenStreetMap avec
// hauteur estimée, rues, arbres, parcs, eau), lues directement dans les fichiers Parquet publiés
// sur S3 avec DuckDB, filtrées par un cadre autour du lieu. Le résultat (environ 100 Ko) est
// converti en mètres autour du lieu; le client le met en cache dans Supabase (scene3d_cache),
// donc chaque lieu n'est calculé qu'une fois.
//
// GET /api/scene3d?lat=46.8367&lng=-71.2336  ->  { v, release, origin, bld, roads, trees, green, asphalt, water }
// v2 (5 octobre 2026): les rues portent leur nom (n) quand Overture le connaît.
// v3 (6 octobre 2026): surfaces pavées (paved) détectées sur l'imagerie satellite Esri (api/paved.js), hors zone dense.
// v4 (6 octobre 2026): surfaces pavées avec leurs trous ({ o, h }), asphalte neutre jusqu'à 0,16 de saturation.
// v5 (7 octobre 2026): hauteur réelle des bâtiments par LiDAR (api/heights.js): bld[i][4] vaut 1 quand la hauteur
//   et les étages viennent de la mesure (surface moins sol nu), lidarBld donne le nombre de bâtiments mesurés.
// v7 (9 octobre 2026): empreintes réelles des bâtiments par LiDAR (api/footprints.js): bld[i][5] vaut 1 quand la forme vient
//   du relevé (remplace le carré d'Overture, ou bâtiment ajouté), lidarFp en compte; entrées en gravier d'après l'imagerie
//   (gravel, même forme que paved) recalée sur le LiDAR (imgShift, mètres est et nord).
// v6 (8 octobre 2026): arbres mesurés par LiDAR jusqu'à 350 m (api/trees.js): trees[i] = [x, n, h, r, k] (hauteur,
//   rayon de couronne, k 1 conifère ou 0 feuillu; près d'un bâtiment, plus dx, dn: centre mesuré de la couronne, et
//   o: 1 si le relevé montre du feuillage au-dessus du toit voisin); treesSrc { date, res, essences }. Restent au format [x, n] (taille
//   tirée au sort par le client) les arbres d'Overture là où le LiDAR ne voit pas, et les boisés au-delà de 350 m.
//   canopy: hauteur de la canopée des boisés en grille de 3 m (sous-bois dessiné sous les cimes), voir api/trees.js.
// Essai local: node api/scene3d.js --test 46.8367 -71.2336

import duckdb from 'duckdb';
import { readFileSync } from 'fs';
import { lidarHeights } from './heights.js';
import { lidarTrees, readCanopy, R_TREES } from './trees.js';
import { lidarFootprints } from './footprints.js';
import { lidarRoofs } from './roofs.js';
import { pavedFromImagery, PAVED_ATTRIBUTION } from './paved.js';

export const maxDuration = 60;

const RELEASE = '2026-09-23.1';
const BASE = `s3://overturemaps-us-west-2/release/${RELEASE}`;
// Avec l'index, les fichiers sont lus en HTTPS direct (pas de signature S3: sur Vercel, les identifiants AWS de la
// fonction et sa région us-east-1 faussaient les requêtes S3 vers ce seau public d'us-west-2).
const HTTPS_BASE = `https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/release/${RELEASE}`;
// Index des fichiers par cadre (scripts/overture-index.mjs): on n'ouvre que ceux qui touchent le lieu.
let INDEX = null;
try { INDEX = JSON.parse(readFileSync(new URL('./overture-index.json', import.meta.url), 'utf8')); if (INDEX.release !== RELEASE) INDEX = null; } catch (e) { INDEX = null; }
function filesFor(path, [x0, y0, x1, y1]) {
  const list = INDEX && INDEX.types[path];
  if (!list) return null;
  return list.filter(([, fx0, fy0, fx1, fy1]) => fx0 <= x1 && fx1 >= x0 && fy0 <= y1 && fy1 >= y0).map(([name]) => `${HTTPS_BASE}/${path}/${name}`);
}
const R_BLD = 450, R_ROAD = 500, R_TREE = 340, R_WOOD = 500, R_GREEN = 500, R_WATER = 2500;

let dbPromise = null;
function getDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const db = new duckdb.Database(':memory:', (e) => (e ? reject(e) : resolve(db)));
    }).then(async (db) => {
      const con = db.connect();
      await run(con, `SET extension_directory='/tmp/duckdb_ext'`);
      await run(con, `SET autoinstall_known_extensions=true`);
      await run(con, `SET autoload_known_extensions=true`);
      await run(con, `SET s3_region='us-west-2'`);
      // Secret anonyme pour le seau public (sans lui, DuckDB signerait avec les identifiants AWS ambiants).
      await run(con, `CREATE OR REPLACE SECRET overture (TYPE S3, PROVIDER config, REGION 'us-west-2', SCOPE 's3://overturemaps-us-west-2')`).catch(() => {});
      await run(con, `SET threads=8`);
      await run(con, `SET memory_limit='768MB'`);
      await run(con, `SET enable_object_cache=true`);
      return db;
    });
  }
  return dbPromise;
}
const run = (con, sql, params = []) => new Promise((res, rej) => con.all(sql, ...params, (e, r) => (e ? rej(e) : res(r))));

// ---------- géométrie (coordonnées locales en mètres: x vers l'est, n vers le nord)
function wkbToGeom(buf) {
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
const polysOf = (g) => g.t === 'Poly' ? [g.c] : g.t === 'MPoly' ? g.c : g.t === 'Coll' ? g.c.flatMap(polysOf) : [];
const linesOf = (g) => g.t === 'Line' ? [g.c] : g.t === 'MLine' ? g.c : g.t === 'Coll' ? g.c.flatMap(linesOf) : [];
const pointsOf = (g) => g.t === 'Point' ? [g.c] : g.t === 'MPoint' ? g.c : g.t === 'Coll' ? g.c.flatMap(pointsOf) : [];

const signedArea = (r) => { let a = 0; for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const centroid = (r) => { let x = 0, y = 0; for (const p of r) { x += p[0]; y += p[1]; } return [x / r.length, y / r.length]; };
const dist2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
function segDist2(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
  return dist2(p, [a[0] + t * dx, a[1] + t * dy]);
}
// Douglas-Peucker (ligne ouverte)
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const t2 = tol * tol, keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop(); let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) { const d = segDist2(pts[i], pts[s], pts[e]); if (d > maxD) { maxD = d; idx = i; } }
    if (maxD > t2 && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function simplifyRing(r, tol) {
  const open = r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r.slice();
  if (open.length < 4) return open;
  const s = simplify([...open, open[0]], tol); s.pop();
  return s.length >= 3 ? s : open;
}
const ccw = (r) => (signedArea(r) < 0 ? r.slice().reverse() : r);
const round1 = (r) => r.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
function pointInRing(p, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
// Découpe d'un anneau par un rectangle (Sutherland-Hodgman)
function clipRing(r, minx, miny, maxx, maxy) {
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
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------- construction de la scène
export async function buildScene(lat, lng) {
  const db = await getDb();
  const mLat = 111320, mLng = 111320 * Math.cos(lat * Math.PI / 180);
  const X = (lon, la) => [(lon - lng) * mLng, (la - lat) * mLat];
  const bboxFor = (r) => [lng - r / mLng, lat - r / mLat, lng + r / mLng, lat + r / mLat];
  const query = async (path, cols, radius) => {
    const [x0, y0, x1, y1] = bboxFor(radius);
    const files = filesFor(path, [x0, y0, x1, y1]);
    if (files && files.length === 0) return [];
    const src = files ? `[${files.map(f => `'${f}'`).join(',')}]` : `'${BASE}/${path}/*'`;
    const con = db.connect();
    try {
      return await run(con, `SELECT ${cols}, geometry FROM read_parquet(${src}, hive_partitioning=0) WHERE bbox.xmin <= ? AND bbox.xmax >= ? AND bbox.ymin <= ? AND bbox.ymax >= ?`, [x1, x0, y1, y0]);
    } finally { con.close(); }
  };
  const t0 = Date.now();
  const [bRows, sRows, lRows, uRows, wRows] = await Promise.all([
    query('theme=buildings/type=building', 'height, num_floors, subtype, class, sources[1].dataset AS src', R_BLD),
    query('theme=transportation/type=segment', 'class, subclass, names.primary AS name', R_ROAD),
    query('theme=base/type=land', 'subtype, class', R_WOOD),
    query('theme=base/type=land_use', 'subtype, class', R_GREEN),
    query('theme=base/type=water', 'subtype, class', R_WATER),
  ]);
  const tq = Date.now() - t0;
  { const srcs = new Map(); for (const r of bRows) { const k = String(r.src || '?'); srcs.set(k, (srcs.get(k) || 0) + 1); } console.log('[scene3d] sources des bâtiments:', [...srcs].map(([k, n]) => `${k} ${n}`).join(', ')); }
  const loc = (ring) => ring.map(([lon, la]) => X(lon, la));

  // Bâtiments: hauteur mesurée si connue, sinon étages, sinon 7,5 m. Remisés (petits, dépendances) en gris.
  let bld = []; const osmIdx = new Set(); // tracés OpenStreetMap (à la main, exacts): jamais remplacés par le LiDAR
  for (const row of bRows) {
    for (const rings of polysOf(wkbToGeom(row.geometry))) {
      let r = simplifyRing(loc(rings[0]), 0.3);
      if (r.length < 3) continue;
      const area = Math.abs(signedArea(r));
      if (area < 12) continue;
      const c = centroid(r);
      if (Math.hypot(c[0], c[1]) > R_BLD) continue;
      let h = row.height != null ? Number(row.height) : row.num_floors ? Number(row.num_floors) * 3.1 : 7.5;
      h = Math.max(2.8, Math.min(h, 120));
      const fl = row.num_floors ? Number(row.num_floors) : Math.max(1, Math.round(h / 3.1));
      const st = row.subtype || '', cl = row.class || '';
      const kind = (st === 'outbuilding' || cl === 'garage' || cl === 'shed' || area < 45) ? 2
        : ['medical', 'education', 'civic', 'commercial', 'industrial', 'service', 'transportation'].includes(st) ? 1 : 0;
      if (/OpenStreetMap/i.test(String(row.src || ''))) osmIdx.add(bld.length);
      bld.push([round1(ccw(r)), Math.round(h * 10) / 10, fl, kind]);
    }
  }

  // Rues: largeur selon la classe; k: 0 asphalte, 1 trottoir ou sentier, 2 voie ferrée.
  const W = { motorway: 20, trunk: 16, primary: 14, secondary: 12, tertiary: 10, residential: 8, unknown: 7, living_street: 6, service: 4.5, footway: 2, cycleway: 2.5, path: 1.6, track: 3, standard_gauge: 3 };
  const roads = [];
  for (const row of sRows) {
    const cl = row.class, sc = row.subclass;
    if (!(cl in W) || ['crosswalk', 'cycle_crossing', 'steps'].includes(sc)) continue;
    let w = W[cl]; if (sc === 'driveway') w = 3; if (sc === 'alley' || sc === 'parking_aisle') w = 4;
    const k = cl === 'standard_gauge' ? 2 : ['footway', 'cycleway', 'path'].includes(cl) ? 1 : 0;
    for (const line of linesOf(wkbToGeom(row.geometry))) {
      const p = simplify(loc(line), 0.4);
      if (p.length < 2 || !p.some(q => Math.hypot(q[0], q[1]) <= R_ROAD)) continue;
      const road = { w, k, p: round1(p) };
      if (k === 0 && row.name) road.n = String(row.name).slice(0, 60); // nom de la rue: repère d'orientation pour l'analyse des façades
      roads.push(road);
    }
  }

  // Arbres (isolés, alignements, boisés tirés au sort) et pelouses.
  const trees = [], green = [], rnd = mulberry(7);
  for (const row of lRows) {
    const g = wkbToGeom(row.geometry), cl = row.class;
    if (cl === 'tree') {
      for (const pt of pointsOf(g)) { const p = X(pt[0], pt[1]); if (Math.hypot(p[0], p[1]) <= R_TREE) trees.push([Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]); }
    } else if (cl === 'tree_row') {
      for (const line of linesOf(g)) {
        const p = loc(line); let acc = 4;
        for (let i = 0; i < p.length - 1; i++) {
          const a = p[i], b = p[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          while (acc <= L) { const t = acc / L, q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; if (Math.hypot(q[0], q[1]) <= R_TREE) trees.push([Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10]); acc += 8; }
          acc -= L;
        }
      }
    } else if (cl === 'wood' || cl === 'forest' || cl === 'grass') {
      for (const rings of polysOf(g)) {
        const r = loc(rings[0]);
        if (cl === 'grass') { const s = simplifyRing(r, 0.5); if (s.length >= 3) green.push({ k: 'grass', p: round1(ccw(s)) }); continue; }
        const area = Math.abs(signedArea(r)); let n = Math.min(220, Math.floor(area / 40)), tries = 0;
        let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
        for (const p of r) { minx = Math.min(minx, p[0]); miny = Math.min(miny, p[1]); maxx = Math.max(maxx, p[0]); maxy = Math.max(maxy, p[1]); }
        while (n > 0 && tries < 4000) {
          tries++;
          const q = [minx + rnd() * (maxx - minx), miny + rnd() * (maxy - miny)];
          if (pointInRing(q, r) && Math.hypot(q[0], q[1]) <= R_WOOD) { trees.push([Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10]); n--; }
        }
      }
    }
  }

  // Parcs, terrains de jeu, stationnements.
  const GK = { park: 'park', pitch: 'pitch', playground: 'play', track: 'pitch', recreation_ground: 'park', grass: 'grass', garden: 'park', cemetery: 'park', golf_course: 'pitch' };
  const asphalt = [];
  for (const row of uRows) {
    const cl = row.class, k = GK[cl];
    const isParking = cl === 'parking';
    if (!k && !isParking) continue;
    for (const rings of polysOf(wkbToGeom(row.geometry))) {
      const r = simplifyRing(loc(rings[0]), 0.5);
      if (r.length < 3) continue;
      const c = centroid(r);
      if (Math.hypot(c[0], c[1]) > R_GREEN) continue;
      if (isParking) asphalt.push(round1(ccw(r))); else green.push({ k, p: round1(ccw(r)) });
    }
  }

  // Eau: polygones découpés au cadre, avec leurs îles.
  const water = [];
  const wb = R_WATER - 1;
  for (const row of wRows) {
    if (row.class === 'wastewater' || row.subtype === 'wastewater') continue;
    for (const rings of polysOf(wkbToGeom(row.geometry))) {
      let outer = clipRing(loc(rings[0]), -wb, -wb, wb, wb);
      outer = simplifyRing(outer, 2);
      if (outer.length < 3 || Math.abs(signedArea(outer)) < 5000) continue;
      const holes = [];
      for (let i = 1; i < rings.length; i++) {
        let h = simplifyRing(clipRing(loc(rings[i]), -wb, -wb, wb, wb), 2);
        if (h.length >= 3 && Math.abs(signedArea(h)) > 200) holes.push(round1(h));
      }
      water.push({ o: round1(ccw(outer)), h: holes });
    }
  }

  // Surfaces pavées d'après l'imagerie satellite (stationnements, aires, cours), là où les cartes ne les ont pas.
  // En même temps: hauteur réelle des bâtiments par LiDAR (modifie bld en place, après la lecture des surfaces pavées
  // qui n'utilise que les empreintes).
  // lidarErr: lecture LiDAR échouée (catalogue ou mosaïque indisponible): la scène sert quand même, mais n'est gardée
  // ni par le réseau de Vercel ni dans le cache partagé, pour être recalculée au prochain affichage.
  let paved = [], gravel = [], imgShift = [0, 0], pavedSrc = null, lidarBld = 0, lidarErr = false, lt = null, lidarFp = 0;
  const log = (m) => console.log('[scene3d]', m);
  // Délai global des lectures LiDAR: un serveur de Ressources naturelles Canada bloqué ne doit pas faire échouer toute la
  // scène (60 s pour la fonction, dont 15 à 20 s pour Overture): après 50 s depuis le début, on sert sans ces mesures.
  const deadline = t0 + 50000;
  const inTime = (p, what) => { let tm; const t = new Promise((_, rej) => { tm = setTimeout(() => rej(new Error(`${what}: délai dépassé`)), Math.max(1000, deadline - Date.now())); }); return Promise.race([p, t]).finally(() => clearTimeout(tm)); };
  // D'abord la fenêtre LiDAR (±350 m) et les empreintes réelles des bâtiments qu'on en tire: les surfaces au sol, les
  // hauteurs et les arbres s'appuient ensuite sur ces empreintes.
  const win = await inTime(readCanopy(lat, lng, log), 'LiDAR').catch((e) => { lidarErr = true; console.warn('[scene3d] fenêtre LiDAR indisponible:', e && e.message); return null; });
  if (win) { try { const fp = lidarFootprints(win, win.fr, bld, log, bld.map((_, i) => osmIdx.has(i))); bld = fp.bld; lidarFp = fp.replaced + fp.added; } catch (e) { console.warn('[scene3d] empreintes LiDAR:', e && e.message); } }
  // Pentes des toits (v633.179): surface LiDAR ajustée dans chaque empreinte (bld[i][6], voir api/roofs.js).
  let roofs = 0;
  if (win) { try { roofs = lidarRoofs(win, bld, log).n; } catch (e) { console.warn('[scene3d] toits LiDAR:', e && e.message); } }
  await Promise.all([
    pavedFromImagery(lat, lng, bld, roads, log).then((r) => { paved = r.paved; gravel = r.gravel || []; imgShift = r.shift || [0, 0]; pavedSrc = r.dense ? null : PAVED_ATTRIBUTION; }).catch((e) => console.warn('[scene3d] surfaces pavées indisponibles:', e && e.message)),
    inTime(lidarHeights(lat, lng, bld, log), 'hauteurs').then((r) => { lidarBld = r.measured; if (r.failed) lidarErr = true; }).catch((e) => { lidarErr = true; console.warn('[scene3d] hauteurs LiDAR indisponibles:', e && e.message); }),
    // Les empreintes ne changent pas pendant la mesure des hauteurs: le masque des toits peut se faire en même temps.
    inTime(lidarTrees(lat, lng, bld, log, win), 'arbres').then((r) => { lt = r; if (r.failed) lidarErr = true; }).catch((e) => { lidarErr = true; console.warn('[scene3d] arbres LiDAR indisponibles:', e && e.message); }),
  ]);
  lidarBld += bld.filter(b => b[5] === 1).length; // les empreintes LiDAR sont mesurées aussi
  // Arbres mesurés là où le LiDAR voit; ceux d'Overture ailleurs (trou de couverture, au-delà de 350 m), sauf dans un
  // bâtiment ou à moins de 1 m d'un mur (les boisés sont semés au hasard, sans tenir compte des bâtiments).
  const boxes = bld.map(([r]) => { let x0 = Infinity, n0 = Infinity, x1 = -Infinity, n1 = -Infinity; for (const [x, n] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); n0 = Math.min(n0, n); n1 = Math.max(n1, n); } return [x0 - 1, n0 - 1, x1 + 1, n1 + 1]; });
  const segD = (x, n, a, b) => { const dx = b[0] - a[0], dn = b[1] - a[1], l2 = dx * dx + dn * dn || 1e-9, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (n - a[1]) * dn) / l2)); return Math.hypot(x - a[0] - t * dx, n - a[1] - t * dn); };
  const clearOfBld = ([x, n]) => !bld.some(([r], k) => { const b = boxes[k]; if (x < b[0] || x > b[2] || n < b[1] || n > b[3]) return false; if (pointInRing([x, n], r)) return true; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (segD(x, n, r[j], r[i]) < 1) return true; return false; });
  let treesOut = trees.filter(clearOfBld), treesSrc = null, canopy = null;
  if (lt && lt.trees) {
    treesOut = lt.trees.concat(treesOut.filter(([x, n]) => Math.hypot(x, n) > R_TREES || !lt.covered(x, n)));
    treesSrc = { date: lt.date, res: lt.res, essences: lt.essences, n: lt.trees.length };
    canopy = lt.canopy;
  }
  const scene = { v: 9, release: RELEASE, origin: [lat, lng], bld, roads, trees: treesOut, treesSrc, canopy, green, asphalt, water, paved, gravel, imgShift, pavedSrc, lidarBld, lidarFp, roofs, ms: { query: tq, total: Date.now() - t0, indexed: !!INDEX } };
  if (lidarErr) scene.lidarErr = true;
  return scene;
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const lat = parseFloat(url.searchParams.get('lat')), lng = parseFloat(url.searchParams.get('lng'));
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!(lat >= -85 && lat <= 85 && lng >= -180 && lng <= 180)) {
    res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'lat/lng invalides' })); return;
  }
  try {
    const scene = await buildScene(lat, lng);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', scene.lidarErr ? 'no-store' : 'public, max-age=86400, s-maxage=2592000');
    res.end(JSON.stringify(scene));
  } catch (e) {
    console.error('[scene3d]', e);
    res.statusCode = 502; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: String(e && e.message || e) }));
  }
}

if (process.argv.includes('--test')) {
  const i = process.argv.indexOf('--test');
  const lat = parseFloat(process.argv[i + 1] || '46.8367'), lng = parseFloat(process.argv[i + 2] || '-71.2336');
  buildScene(lat, lng).then((s) => {
    const j = JSON.stringify(s);
    console.log({ bld: s.bld.length, lidarFp: s.lidarFp, roofs: s.roofs, roads: s.roads.length, trees: s.trees.length, lidarTrees: s.treesSrc && s.treesSrc.n, conifers: s.trees.filter(t => t[4] === 1).length, green: s.green.length, asphalt: s.asphalt.length, water: s.water.length, paved: s.paved.length, gravel: s.gravel.length, imgShift: s.imgShift, bytes: j.length, ms: s.ms });
    if (process.argv.includes('--out')) { import('fs').then(fs => fs.writeFileSync(process.argv[process.argv.indexOf('--out') + 1], j)); }
  }).catch((e) => { console.error(e); process.exit(1); });
}
