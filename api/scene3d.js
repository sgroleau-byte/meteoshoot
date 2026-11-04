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
//   (gravel, même forme que paved) recalée sur le LiDAR (imgShift, mètres est et nord); gravelDitch: nombre d'entrées lues
//   dans le fossé LiDAR (api/driveways.js, v633.238), le reste vient de la couleur de l'image.
// v14 (3 novembre 2026): plus d'ajouts LiDAR là où OpenStreetMap domine les contours (lidarAdd: 0 quand les ajouts sont coupés).
// v15 (3 novembre 2026): dans les zones mixtes, plus d'ajout LiDAR dans un parc, sur une voie ferrée, en forme de cime, ni de
//   petite plaque en zone dense (api/footprints.js, tri sur l'imagerie à Limoilou et Sillery).
// v16 (3 novembre 2026): cours intérieures: bld[i][7] = anneaux intérieurs du contour (m locaux, 30 m² et plus), que le moteur
//   creuse dans les murs et le toit (le Parlement est un contour à trou dans OpenStreetMap; avant, un bloc plein).
// v17 (3 novembre 2026): parties de bâtiment d'Overture (type=building_part, tracés OpenStreetMap des ailes, tours et
//   volumes d'un même édifice): chacune est un bâtiment de la scène avec bld[i][8] = hauteur de sa base (0 au sol, sinon un
//   volume posé sur un autre); un contour couvert par ses parties au sol (PART_COVER) est retiré, les parties le remplacent.
// v6 (8 octobre 2026): arbres mesurés par LiDAR jusqu'à 350 m (api/trees.js): trees[i] = [x, n, h, r, k] (hauteur,
//   rayon de couronne, k code d'essence (0 feuillu, 1 conifère; depuis le 23 octobre 2026 aussi 2 à 6, voir api/trees.js); près d'un bâtiment, plus dx, dn: centre mesuré de la couronne, et
//   o: 1 si le relevé montre du feuillage au-dessus du toit voisin); treesSrc { date, res, essences }. Restent au format [x, n] (taille
//   tirée au sort par le client) les arbres d'Overture là où le LiDAR ne voit pas, et les boisés au-delà de 350 m.
//   canopy: hauteur de la canopée des boisés en grille de 3 m (sous-bois dessiné sous les cimes), voir api/trees.js.
// v18 (4 novembre 2026): couverture du sol mondiale (api/landcover.js: ESA WorldCover 10 m et ESA CCI 300 m) dans cover
//   { near, far: parts du sol (arbres, arbustes, herbe, cultures, bâti, sol nu, eau) dans 350 m et 1,5 km; leaf: parts des
//   arbres de la région par feuillage (ne conifères persistants, be feuillus persistants, nd mélèzes, bd feuillus caducs);
//   ground: teinte du sol sec vue sur l'imagerie Esri (api/paved.js) et sa part; src }. Les arbres sans mesure (Overture,
//   et ceux semés sur les pixels « arbres » de WorldCover hors de la vue du LiDAR) portent une essence tirée au sort
//   d'après leaf: [x, n, k] ou [x, n, k, h] (h: hauteur en terrain aride, arbustes et sol nu à 20 % et plus dans 1,5 km).
//   Avant, à Sedona (Arizona), des feuillus en couleurs d'automne sur de l'herbe verte: genévriers et roche rouge en réalité.
// v19 (4 novembre 2026): LiDAR américain (api/lidar3dep.js): aux États-Unis, hauteurs, empreintes, toits et arbres mesurés sur
//   les tuiles 2 m de l'USGS (Planetary Computer) comme au Canada sur le LiDAR de Ressources naturelles Canada; treesSrc.agency.
// v20 (4 novembre 2026, v633.275): environs à 800 m (voir R_BLD et R_NEAR): bâtiments, rues, boisés et parcs plus loin pour la
//   vue de drone, sans trottoirs, entrées, stationnements, parties de bâtiment ni mesures LiDAR au-delà de 450 à 500 m.
// Couche Overture gardée à part (3 novembre 2026, v633.267): la lecture d'Overture (13 s sur 28 en production) ne dépend
//   que du lieu, de la version d'Overture (RELEASE) et des règles de ce fichier (BASE_V); elle est gardée dans le cache partagé
//   sous la clé « ovt_lat_lng » (écrite par le client ou le script de préchauffage, lue ici avec la clé publique). Une nouvelle
//   version des environs (SCENE_V, règles LiDAR) ne refait donc que les mesures. La scène renvoyée porte `base` seulement
//   quand la couche vient d'être lue (à garder), jamais dans la scène mise en cache. GET ...&stage=base renvoie la couche seule.
// Tuiles Overture (v633.268): la lecture d'Overture se fait d'abord dans des tuiles pré-découpées (api/overture-tiles.js,
//   stockage Supabase), DuckDB restant le repli hors couverture; ms.base dit d'où vient la couche: 'cache', 'tuiles' ou 'duckdb'.
// Essai local: node api/scene3d.js --test 46.8367 -71.2336 [--no-cache] [--duckdb]

import duckdb from 'duckdb';
import { readFileSync } from 'fs';
import { lidarHeights } from './heights.js';
import { lidarTrees, readCanopy, R_TREES } from './trees.js';
import { lidarFootprints } from './footprints.js';
import { lidarRoofs } from './roofs.js';
import { appleShift } from './satshift.js';
import { pavedFromImagery, PAVED_ATTRIBUTION, builtShare, DENSE_SHARE } from './paved.js';
import { SUPABASE_URL, SUPABASE_KEY } from '../src/shared/config.js';
import { wkbToGeom, polysOf, linesOf, pointsOf, signedArea, clipRing, readTiles } from './overture-tiles.js';
import { readLandCover } from './landcover.js';

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
// Rayons de lecture d'Overture (m). Depuis la v633.275 (Stéphane: des environs plus larges pour la vue de drone, comme
// Shadowmap qui fait apparaître les bâtiments en se déplaçant), bâtiments, rues, boisés et parcs vont jusqu'à 800 m, avec
// moins de détail au-delà de R_NEAR: ni trottoirs, sentiers, entrées ni stationnements, contours simplifiés au mètre,
// parties de bâtiment et mesures LiDAR seulement jusqu'à R_LIDAR_BLD (l'ancien rayon), arbres des boisés plus clairsemés.
const R_BLD = 800, R_ROAD = 800, R_TREE = 340, R_WOOD = 800, R_GREEN = 800, R_WATER = 2500;
const R_NEAR = 500, R_LIDAR_BLD = 450;
const FAR_WOOD_KEEP = 0.5; // part des arbres de boisé tirés au-delà de R_NEAR qui sont gardés
const PART_COVER = 0.6; // part de la surface d'un contour couverte par ses parties au sol à partir de laquelle le contour s'efface (v17)
// Version de la couche Overture (bld avant LiDAR, rues, arbres d'Overture, parcs, stationnements, eau): à bumper quand le
// traitement d'Overture change (parties, largeurs de rues, eau...), pas pour une règle LiDAR. RELEASE la périme aussi.
export const BASE_V = 2; // 2: environs à 800 m (v633.275)
// Aléa fixe d'un point (0..1): mêmes arbres à chaque calcul.
const hashOf = (x, n, k) => { const v = Math.sin(x * 127.1 + n * 311.7 + k * 74.7) * 43758.5453; return v - Math.floor(v); };
const log = (m) => console.log('[scene3d]', m);
const baseKey = (lat, lng) => `ovt_${Number(lat).toFixed(5)}_${Number(lng).toFixed(5)}`;
// Couche Overture du cache partagé (lecture publique), sinon null: périmée, absente ou cache injoignable (4 s au plus).
async function cachedBase(lat, lng) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/scene3d_cache?select=data&key=eq.${baseKey(lat, lng)}`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, signal: AbortSignal.timeout(4000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const rows = await r.json(), b = rows[0] && rows[0].data;
    if (b && b.v === BASE_V && b.release === RELEASE && Array.isArray(b.bld) && Array.isArray(b.osm)) return b;
    if (b) log(`couche Overture du cache périmée (v${b.v}, ${b.release})`);
    return null;
  } catch (e) { log(`couche Overture: cache partagé illisible (${e && e.message})`); return null; }
}

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

// ---------- géométrie (coordonnées locales en mètres: x vers l'est, n vers le nord); lecture WKB, polysOf, linesOf,
// pointsOf, signedArea et clipRing viennent de overture-tiles.js (partagés avec le découpage en tuiles)

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
const round0 = (r) => r.map(p => [Math.round(p[0]), Math.round(p[1])]); // au mètre: contours lointains, déjà simplifiés au mètre
function pointInRing(p, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------- couche Overture: lecture des Parquet et mise en forme (bâtiments avant LiDAR, rues, arbres, parcs, stationnements, eau)
// Lecture d'abord dans les tuiles pré-découpées (api/overture-tiles.js, v633.268: deux petits fichiers du stockage
// Supabase, même filtre par cadre et même ordre des lignes que la requête DuckDB), sinon dans les Parquet par DuckDB
// (lieu hors couverture, tuiles injoignables, ou opts.force = 'duckdb'; opts.force = 'tiles' refuse le repli: vérification).
export async function overtureBase(lat, lng, opts = {}) {
  const mLat = 111320, mLng = 111320 * Math.cos(lat * Math.PI / 180);
  const X = (lon, la) => [(lon - lng) * mLng, (la - lat) * mLat];
  const bboxFor = (r) => [lng - r / mLng, lat - r / mLat, lng + r / mLng, lat + r / mLat];
  const t0 = Date.now();
  let tiles = null;
  if (opts.force !== 'duckdb') {
    try { tiles = await readTiles(lat, lng, RELEASE); } catch (e) { log(`tuiles Overture injoignables (${e && e.message}), lecture des Parquet`); }
    if (!tiles && opts.force === 'tiles') throw new Error('lieu hors des tuiles Overture');
  }
  let bRows, pRows, sRows, lRows, uRows, wRows;
  if (tiles) {
    // Même filtre que la requête DuckDB (cadre Overture de chaque entité), même ordre (fichier Parquet, puis ligne).
    const pick = (rows, radius) => { const [x0, y0, x1, y1] = bboxFor(radius); return rows.filter((r) => r.bb[0] <= x1 && r.bb[2] >= x0 && r.bb[1] <= y1 && r.bb[3] >= y0).sort((a, b) => a.o - b.o); };
    bRows = pick(tiles.b, R_BLD); pRows = pick(tiles.p, R_BLD); sRows = pick(tiles.s, R_ROAD); lRows = pick(tiles.l, R_WOOD); uRows = pick(tiles.u, R_GREEN); wRows = pick(tiles.w, R_WATER);
    log(`tuiles Overture ${tiles.paths.join(' + ')} (${Math.round(tiles.bytes / 1024)} Ko, ${tiles.ms} ms)`);
  } else {
    const db = await getDb();
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
    [bRows, pRows, sRows, lRows, uRows, wRows] = await Promise.all([
      query('theme=buildings/type=building', 'id, height, num_floors, subtype, class, sources[1].dataset AS src', R_BLD),
      query('theme=buildings/type=building_part', 'height, num_floors, min_height, min_floor, building_id, sources[1].dataset AS src', R_BLD),
      query('theme=transportation/type=segment', 'class, subclass, names.primary AS name', R_ROAD),
      query('theme=base/type=land', 'subtype, class', R_WOOD),
      query('theme=base/type=land_use', 'subtype, class', R_GREEN),
      query('theme=base/type=water', 'subtype, class', R_WATER),
    ]);
  }
  const tq = Date.now() - t0, src = tiles ? 'tuiles' : 'duckdb';
  const geomOf = (row) => row.geom || wkbToGeom(row.geometry);
  { const srcs = new Map(); for (const r of bRows) { const k = String(r.src || '?'); srcs.set(k, (srcs.get(k) || 0) + 1); } console.log('[scene3d] sources des bâtiments:', [...srcs].map(([k, n]) => `${k} ${n}`).join(', ')); }
  const loc = (ring) => ring.map(([lon, la]) => X(lon, la));

  // Bâtiments: hauteur mesurée si connue, sinon étages, sinon 7,5 m. Remisés (petits, dépendances) en gris.
  let bld = []; let osmIdx = new Set(); // tracés OpenStreetMap (à la main, exacts): jamais remplacés par le LiDAR
  const outlines = new Map(), outArea = new Map(); // id d'Overture -> indice et genre du contour; indice -> surface au sol (pour les parties)
  for (const row of bRows) {
    for (const rings of polysOf(geomOf(row))) {
      let r = simplifyRing(loc(rings[0]), 0.3);
      if (r.length < 3) continue;
      const area = Math.abs(signedArea(r));
      if (area < 12) continue;
      const c = centroid(r), far = Math.hypot(c[0], c[1]) > R_NEAR;
      if (Math.hypot(c[0], c[1]) > R_BLD) continue;
      if (far) { r = simplifyRing(r, 1); if (r.length < 3) continue; } // au loin: contour au mètre (scène plus légère)
      // Cours intérieures (v16): anneaux intérieurs de 30 m² et plus, mis au net comme le contour.
      const rnd_ = far ? round0 : round1;
      const holes = []; for (let i = 1; i < rings.length; i++) { const hr = simplifyRing(loc(rings[i]), far ? 1 : 0.3); if (hr.length >= 3 && Math.abs(signedArea(hr)) >= 30) holes.push(rnd_(ccw(hr))); }
      let h = row.height != null ? Number(row.height) : row.num_floors ? Number(row.num_floors) * 3.1 : 7.5;
      h = Math.max(2.8, Math.min(h, 120));
      const fl = row.num_floors ? Number(row.num_floors) : Math.max(1, Math.round(h / 3.1));
      const st = row.subtype || '', cl = row.class || '';
      const kind = (st === 'outbuilding' || cl === 'garage' || cl === 'shed' || area < 45) ? 2
        : ['medical', 'education', 'civic', 'commercial', 'industrial', 'service', 'transportation'].includes(st) ? 1 : 0;
      if (/OpenStreetMap/i.test(String(row.src || ''))) osmIdx.add(bld.length);
      const entry = [rnd_(ccw(r)), Math.round(h * 10) / 10, fl, kind];
      if (holes.length) entry[7] = holes; // [4] mesuré, [5] empreinte LiDAR et [6] toit sont posés plus loin
      if (row.id) { outlines.set(String(row.id), { i: bld.length, kind }); outArea.set(bld.length, area - holes.reduce((sa, hr) => sa + Math.abs(signedArea(hr)), 0)); }
      bld.push(entry);
    }
  }
  // Parties de bâtiment (v17): ailes, tours et volumes tracés dans OpenStreetMap pour un même édifice (le Parlement en a
  // une vingtaine, le contour n'étant que l'enveloppe). Chacune devient un bâtiment (hauteur propre, genre du contour
  // parent), bld[i][8] = hauteur de sa base (un volume posé sur un autre démarre plus haut). Un contour dont les parties au
  // sol couvrent PART_COVER de la surface s'efface: les parties le remplacent (sinon, murs confondus qui scintillent).
  let nParts = 0; const covered = new Map();
  for (const row of pRows) {
    const par = row.building_id ? outlines.get(String(row.building_id)) : null;
    for (const rings of polysOf(geomOf(row))) {
      const r = simplifyRing(loc(rings[0]), 0.3);
      if (r.length < 3) continue;
      const area = Math.abs(signedArea(r));
      if (area < 12) continue;
      const c = centroid(r);
      if (Math.hypot(c[0], c[1]) > R_LIDAR_BLD) continue; // parties (ailes, tours d'un même édifice): près du sujet seulement
      let h = row.height != null ? Number(row.height) : row.num_floors ? Number(row.num_floors) * 3.1 : par ? bld[par.i][1] : 7.5;
      h = Math.max(2.8, Math.min(h, 120));
      const base = row.min_height != null ? Math.max(0, Math.min(Number(row.min_height), h - 1)) : row.min_floor ? Math.max(0, Math.min(Number(row.min_floor) * 3.1, h - 1)) : 0;
      const fl = row.num_floors ? Number(row.num_floors) : Math.max(1, Math.round((h - base) / 3.1));
      if (/OpenStreetMap/i.test(String(row.src || ''))) osmIdx.add(bld.length);
      if (par && base === 0) covered.set(par.i, (covered.get(par.i) || 0) + area);
      const entry = [round1(ccw(r)), Math.round(h * 10) / 10, fl, par ? par.kind : 0]; entry[8] = Math.round(base * 10) / 10;
      bld.push(entry); nParts++;
    }
  }
  let dropped = 0;
  if (nParts) {
    const drop = new Set(); covered.forEach((a, i) => { if (a >= PART_COVER * (outArea.get(i) || Infinity)) drop.add(i); }); dropped = drop.size;
    if (drop.size) { const old = osmIdx, nb = []; osmIdx = new Set(); bld.forEach((b, i) => { if (drop.has(i)) return; if (old.has(i)) osmIdx.add(nb.length); nb.push(b); }); bld = nb; }
    console.log(`[scene3d] parties de bâtiment: ${nParts}, ${dropped} contours couverts retirés`);
  }

  // Rues: largeur selon la classe; k: 0 asphalte, 1 trottoir ou sentier, 2 voie ferrée.
  const W = { motorway: 20, trunk: 16, primary: 14, secondary: 12, tertiary: 10, residential: 8, unknown: 7, living_street: 6, service: 4.5, footway: 2, cycleway: 2.5, path: 1.6, track: 3, standard_gauge: 3 };
  const roads = [];
  for (const row of sRows) {
    const cl = row.class, sc = row.subclass;
    if (!(cl in W) || ['crosswalk', 'cycle_crossing', 'steps'].includes(sc)) continue;
    let w = W[cl]; if (sc === 'driveway') w = 3; if (sc === 'alley' || sc === 'parking_aisle') w = 4;
    const k = cl === 'standard_gauge' ? 2 : ['footway', 'cycleway', 'path'].includes(cl) ? 1 : 0;
    for (const line of linesOf(geomOf(row))) {
      const p = simplify(loc(line), 0.4);
      if (p.length < 2 || !p.some(q => Math.hypot(q[0], q[1]) <= R_ROAD)) continue;
      // Au-delà de R_NEAR: ni trottoirs, pistes et sentiers, ni entrées, ruelles et allées (invisibles de si loin).
      if ((k === 1 || w <= 4.5) && !p.some(q => Math.hypot(q[0], q[1]) <= R_NEAR)) continue;
      const road = { w, k, p: round1(p) };
      if (k === 0 && row.name) road.n = String(row.name).slice(0, 60); // nom de la rue: repère d'orientation pour l'analyse des façades
      roads.push(road);
    }
  }

  // Arbres (isolés, alignements, boisés tirés au sort) et pelouses.
  const trees = [], green = [], rnd = mulberry(7);
  for (const row of lRows) {
    const g = geomOf(row), cl = row.class;
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
      for (const [k, rings] of polysOf(g).entries()) {
        const r = loc(rings[0]);
        if (cl === 'grass') { const s = simplifyRing(r, 0.5); if (s.length >= 3) green.push({ k: 'grass', p: round1(ccw(s)) }); continue; }
        // Boisé découpé à la tuile (row.ob, row.oa: cadre et aire du contour d'origine, en degrés): même nombre de tirages et
        // même cadre de tirage que sur le contour entier, donc les mêmes arbres; les tirages hors de la tuile agrandie
        // tombent de toute façon au-delà de R_WOOD.
        const area = row.oa ? Math.abs(row.oa[k]) * mLng * mLat : Math.abs(signedArea(r)); let n = Math.min(220, Math.floor(area / 40)), tries = 0;
        // Au-delà de R_NEAR (v633.275): un compte à part, à demi-densité, pour ne pas appauvrir le boisé près du sujet.
        let nFar = Math.floor(n * FAR_WOOD_KEEP);
        let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
        if (row.ob) { [minx, miny] = X(row.ob[k][0], row.ob[k][1]); [maxx, maxy] = X(row.ob[k][2], row.ob[k][3]); }
        else for (const p of r) { minx = Math.min(minx, p[0]); miny = Math.min(miny, p[1]); maxx = Math.max(maxx, p[0]); maxy = Math.max(maxy, p[1]); }
        while ((n > 0 || nFar > 0) && tries < 4000) {
          tries++;
          const q = [minx + rnd() * (maxx - minx), miny + rnd() * (maxy - miny)];
          const dq = Math.hypot(q[0], q[1]);
          if (dq > R_WOOD || !pointInRing(q, r)) continue;
          if (dq <= R_NEAR) { if (n <= 0) continue; n--; } else { if (nFar <= 0) continue; nFar--; }
          trees.push([Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10]);
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
    for (const rings of polysOf(geomOf(row))) {
      const r = simplifyRing(loc(rings[0]), 0.5);
      if (r.length < 3) continue;
      const c = centroid(r);
      if (Math.hypot(c[0], c[1]) > R_GREEN) continue;
      if (isParking && Math.hypot(c[0], c[1]) > R_NEAR) continue; // stationnements: proches seulement
      if (isParking) asphalt.push(round1(ccw(r))); else green.push({ k, p: round1(ccw(r)) });
    }
  }

  // Eau: polygones découpés au cadre, avec leurs îles.
  const water = [];
  const wb = R_WATER - 1;
  for (const row of wRows) {
    if (row.class === 'wastewater' || row.subtype === 'wastewater') continue;
    for (const rings of polysOf(geomOf(row))) {
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

  return { base: { v: BASE_V, release: RELEASE, bld, osm: [...osmIdx], roads, trees, green, asphalt, water }, tq, src };
}

// ---------- construction de la scène
// opts.dbg (banc seulement): objet rempli avec fp (mesures des toits hors empreinte, api/footprints.js) et osm (indices des tracés OpenStreetMap).
// opts.noCache: ne pas lire la couche Overture du cache partagé. opts.force: 'duckdb' ou 'tiles' (voir overtureBase).
export async function buildScene(lat, lng, opts = {}) {
  const t0 = Date.now();
  let base = opts.noCache ? null : await cachedBase(lat, lng), fromCache = !!base, tq = 0, src = null;
  if (!base) { const r = await overtureBase(lat, lng, { force: opts.force }); base = r.base; tq = r.tq; src = r.src; }
  else log(`couche Overture lue du cache partagé (${base.bld.length} bâtiments, ${Date.now() - t0} ms)`);
  // Copie de travail: la suite modifie bld en place (empreintes, hauteurs, toits); la couche renvoyée reste celle d'Overture.
  const work = structuredClone(base);
  let bld = work.bld; const osmIdx = new Set(work.osm), roads = work.roads, trees = work.trees, green = work.green, asphalt = work.asphalt, water = work.water;
  // Surfaces pavées d'après l'imagerie satellite (stationnements, aires, cours), là où les cartes ne les ont pas.
  // En même temps: hauteur réelle des bâtiments par LiDAR (modifie bld en place, après la lecture des surfaces pavées
  // qui n'utilise que les empreintes).
  // lidarErr: lecture LiDAR échouée (catalogue ou mosaïque indisponible): la scène sert quand même, mais n'est gardée
  // ni par le réseau de Vercel ni dans le cache partagé, pour être recalculée au prochain affichage.
  let paved = [], gravel = [], gravelDitch = 0, imgShift = [0, 0], pavedSrc = null, lidarBld = 0, lidarErr = false, lt = null, lidarFp = 0, apple = null, appleRoof = null, appleErr = false, ground = null, cover = null;
  // Délai global des lectures LiDAR: un serveur de Ressources naturelles Canada bloqué ne doit pas faire échouer toute la
  // scène (60 s pour la fonction, dont 15 à 20 s pour Overture): après 50 s depuis le début, on sert sans ces mesures.
  const deadline = t0 + 50000;
  const inTime = (p, what) => { let tm; const t = new Promise((_, rej) => { tm = setTimeout(() => rej(new Error(`${what}: délai dépassé`)), Math.max(1000, deadline - Date.now())); }); return Promise.race([p, t]).finally(() => clearTimeout(tm)); };
  // D'abord la fenêtre LiDAR (±350 m) et les empreintes réelles des bâtiments qu'on en tire: les surfaces au sol, les
  // hauteurs et les arbres s'appuient ensuite sur ces empreintes.
  const win = await inTime(readCanopy(lat, lng, log), 'LiDAR').catch((e) => { lidarErr = true; console.warn('[scene3d] fenêtre LiDAR indisponible:', e && e.message); return null; });
  // Ajouts LiDAR (toit hors de toute empreinte) seulement là où les contours d'Overture viennent surtout du tracé automatique
  // sur images (Microsoft, hors des villes: carrés approximatifs, bâtiments manquants; à Stoneham la maison du projet n'y
  // était pas). Là où OpenStreetMap domine (tracés à la main, complets en ville), un toit hors empreinte est presque toujours
  // un arbre: Assemblée nationale, 3 novembre 2026, 33 arbres sur 36 ajouts (boulevard, pelouses, talus boisé), dont un
  // « immeuble » de 12 m. Les remplacements (vraie forme d'un carré Microsoft) restent permis partout. Version 14.
  // Zones mixtes (v633.262, version 15): parmi les ajouts restants, pas de toit dans un parc ou une pelouse d'Overture (une
  // cime), pas de toit sur une voie ferrée (un wagon), pas de cime bombée, et en zone dense (même critère que les surfaces
  // pavées) pas de petite plaque (remise aussi souvent fausse que vraie). Voir l'en-tête de footprints.js.
  const osmShare = bld.length ? osmIdx.size / bld.length : 0, noAdd = bld.length >= 20 && osmShare >= 0.9, dense = builtShare(bld) > DENSE_SHARE;
  log(`contours OpenStreetMap: ${Math.round(osmShare * 100)} % de ${bld.length} bâtiments${noAdd ? ', ajouts LiDAR coupés' : ''}${dense ? ', zone dense' : ''}`);
  if (opts.dbg) { opts.dbg.osm = [...osmIdx]; opts.dbg.fp = []; }
  if (win) { try { const fp = lidarFootprints(win, win.fr, bld, log, bld.map((_, i) => osmIdx.has(i)), { noAdd, dense, green: green.map(g => g.p), rail: roads.filter(r => r.k === 2).map(r => r.p), dbg: opts.dbg ? opts.dbg.fp : null }); bld = fp.bld; lidarFp = fp.replaced + fp.added; } catch (e) { console.warn('[scene3d] empreintes LiDAR:', e && e.message); } }
  // Pentes des toits (v633.179): surface LiDAR ajustée dans chaque empreinte (bld[i][6], voir api/roofs.js).
  let roofs = 0;
  if (win) { try { roofs = lidarRoofs(win, bld, log).n; } catch (e) { console.warn('[scene3d] toits LiDAR:', e && e.message); } }
  await Promise.all([
    pavedFromImagery(lat, lng, bld, roads, log, { win, water }).then((r) => { paved = r.paved; gravel = r.gravel || []; gravelDitch = r.ditch || 0; imgShift = r.shift || [0, 0]; pavedSrc = r.dense ? null : PAVED_ATTRIBUTION; ground = r.ground || null; }).catch((e) => console.warn('[scene3d] surfaces pavées indisponibles:', e && e.message)),
    // Calage de l'image Plans d'Apple sur les empreintes (v633.183): appleShift dans la scène, appliqué tel quel par le navigateur.
    // appleShift reste l'ancien critère (les versions 633.242 et avant l'appliquent telles quelles: une pose qu'elles
    // écrivent reste dans ce repère); appleRoof est le calage par les toits (v633.243). Échec (pas de clé, image refusée,
    // délai): appleErr, la scène n'est pas gardée et le prochain affichage la redemande.
    inTime(appleShift(lat, lng, bld, log), 'calage Plans').then((r) => { if (!r) { appleErr = true; return; } apple = r.old; appleRoof = r.shift; }).catch((e) => { appleErr = true; console.warn('[scene3d] calage Plans d\'Apple indisponible:', e && e.message); }),
    // Hauteurs LiDAR jusqu'à R_LIDAR_BLD seulement (v633.275): au-delà, hauteur d'Overture; la fenêtre lue resterait
    // sinon trois fois plus grande (1,6 km de côté). Les entrées sont les mêmes objets: la mesure les modifie en place.
    inTime(lidarHeights(lat, lng, bld.filter((b) => Math.hypot(...centroid(b[0])) <= R_LIDAR_BLD), log), 'hauteurs').then((r) => { lidarBld = r.measured; if (r.failed) lidarErr = true; }).catch((e) => { lidarErr = true; console.warn('[scene3d] hauteurs LiDAR indisponibles:', e && e.message); }),
    // Les empreintes ne changent pas pendant la mesure des hauteurs: le masque des toits peut se faire en même temps.
    // Couverture du sol mondiale (v18): sans réponse (serveur bloqué), la scène est servie sans elle, comme les mesures LiDAR.
    inTime(readLandCover(lat, lng, log), 'couverture du sol').then((r) => { cover = r; }).catch((e) => console.warn('[scene3d] couverture du sol indisponible:', e && e.message)),
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
    treesSrc = { date: lt.date, res: lt.res, essences: lt.essences, n: lt.trees.length, agency: lt.agency || 'rncan' };
    canopy = lt.canopy;
  }
  // Arbres sans mesure (v18): essence d'après le feuillage de la région (CCI), hauteur basse en terrain aride; puis semis
  // d'un arbre par pixel « arbres » de WorldCover (10 m, un par 100 m²) hors de la vue du LiDAR et loin des arbres déjà là.
  let seeded = 0, coverOut = null;
  if (cover) {
    const leaf = cover.leaf, far = cover.far || {}, arid = (far.shrub || 0) + (far.bare || 0) + (far.moss || 0) >= 0.2;
    // En terrain aride, les conifères persistants (genévriers, pins pignons) sont bas et ronds: couronne de feuillu persistant
    // (7) plutôt que le cône d'une épinette; sans arbre connu à 15 km (désert), persistants aussi.
    const essOf = (x, n) => { if (!leaf) return arid ? 7 : 0; const u = hashOf(x, n, 1); return u < leaf.ne ? (arid ? 7 : 1) : u < leaf.ne + leaf.be ? 7 : u < leaf.ne + leaf.be + leaf.nd ? 5 : 0; };
    const sized = (x, n, k) => (arid ? [x, n, k, Math.round((3.5 + 4.5 * hashOf(x, n, 2)) * 10) / 10] : k ? [x, n, k] : [x, n]);
    treesOut = treesOut.map((t) => (t.length === 2 ? sized(t[0], t[1], essOf(t[0], t[1])) : t));
    if (cover.grid) {
      const g = Buffer.from(cover.grid.d, 'base64'), N = cover.grid.n, res = cover.grid.res, half = cover.grid.half;
      const cell = 8, buckets = new Map(), bk = (x, n) => `${Math.floor(x / cell)},${Math.floor(n / cell)}`;
      const near = (x, n) => { for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const b = buckets.get(`${Math.floor(x / cell) + di},${Math.floor(n / cell) + dj}`); if (b) for (const [qx, qn] of b) if (Math.hypot(qx - x, qn - n) < 7) return true; } return false; };
      for (const t of treesOut) { const k = bk(t[0], t[1]); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(t); }
      // Du plus proche au plus loin (v633.275: le plafond de 5000 arbres coupait du nord au sud et laissait le sud vide);
      // au-delà de R_NEAR, un pixel sur quatre (un arbre par 400 m² au lieu de 100).
      const cand = [];
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const v = g[j * N + i]; if (v !== 10 && v !== 95) continue;
        const cx = -half + (i + 0.5) * res, cn = half - (j + 0.5) * res, dc = Math.hypot(cx, cn);
        if (dc > R_WOOD + res || (dc > R_NEAR && (i & 1 || j & 1))) continue;
        cand.push([dc, i, j]);
      }
      cand.sort((a, b) => a[0] - b[0]);
      for (const [, i, j] of cand) {
        if (treesOut.length >= 5000) break;
        const x = Math.round((-half + (i + 0.5 + (hashOf(i, j, 3) - 0.5) * 0.8) * res) * 10) / 10, n = Math.round((half - (j + 0.5 + (hashOf(i, j, 4) - 0.5) * 0.8) * res) * 10) / 10;
        const d = Math.hypot(x, n); if (d > R_WOOD || d < 2) continue;
        if (lt && lt.trees && d <= R_TREES && lt.covered(x, n)) continue; // le LiDAR a déjà mesuré ce qui pousse ici
        if (near(x, n) || !clearOfBld([x, n])) continue;
        const t = sized(x, n, essOf(x, n)); treesOut.push(t); seeded++; const k = bk(x, n); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(t);
      }
    }
    coverOut = { v: cover.v, near: cover.near || null, far: cover.far || null, leaf, ground, src: cover.src, arid: arid ? 1 : 0 };
    log(`couverture du sol: ${seeded} arbres semés d'après WorldCover${arid ? ', terrain aride' : ''}${leaf ? `, persistants ${Math.round((leaf.ne + leaf.be) * 100)} %` : ''}`);
  } else if (ground) coverOut = { v: 1, ground, src: [] };
  const scene = { v: 20, release: RELEASE, origin: [lat, lng], bld, roads, trees: treesOut, treesSrc, canopy, green, asphalt, water, paved, gravel, gravelDitch, imgShift, appleShift: apple, appleRoof, pavedSrc, lidarBld, lidarFp, lidarAdd: noAdd ? 0 : 1, roofs, cover: coverOut, ms: { query: tq, base: fromCache ? 'cache' : src, total: Date.now() - t0, indexed: !!INDEX } };
  if (!fromCache) scene.base = base; // à garder par le client (clé ovt_), jamais dans la scène mise en cache
  if (lidarErr) scene.lidarErr = true;
  if (appleErr) { scene.appleErr = true; scene.lidarErr = true; } // lidarErr aussi: les versions 633.242 et antérieures ne connaissent que lui pour ne pas garder la scène
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
    if (url.searchParams.get('stage') === 'base') { // couche Overture seule (script de préchauffage)
      const base = (await cachedBase(lat, lng)) || (await overtureBase(lat, lng)).base;
      res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=2592000');
      res.end(JSON.stringify({ base })); return;
    }
    const scene = await buildScene(lat, lng);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', scene.lidarErr || scene.appleErr ? 'no-store' : 'public, max-age=86400, s-maxage=2592000');
    res.end(JSON.stringify(scene));
  } catch (e) {
    console.error('[scene3d]', e);
    res.statusCode = 502; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: String(e && e.message || e) }));
  }
}

if (process.argv.includes('--test')) {
  const i = process.argv.indexOf('--test');
  const lat = parseFloat(process.argv[i + 1] || '46.8367'), lng = parseFloat(process.argv[i + 2] || '-71.2336');
  const dbg = {};
  buildScene(lat, lng, { dbg, noCache: process.argv.includes('--no-cache'), force: process.argv.includes('--duckdb') ? 'duckdb' : undefined }).then((s) => {
    const j = JSON.stringify(s);
    console.log({ bld: s.bld.length, lidarFp: s.lidarFp, lidarAdd: s.lidarAdd, roofs: s.roofs, appleShift: s.appleShift, roads: s.roads.length, trees: s.trees.length, lidarTrees: s.treesSrc && s.treesSrc.n, conifers: s.trees.filter(t => t[4] === 1 || t[4] === 5 || (t.length <= 4 && (t[2] === 1 || t[2] === 5))).length, cover: s.cover && { ...s.cover, near: undefined, far: s.cover.far && Object.entries(s.cover.far).filter(([k, v]) => k !== 'n' && v >= 0.05).map(([k, v]) => `${k} ${Math.round(v * 100)}`).join(' ') }, green: s.green.length, asphalt: s.asphalt.length, water: s.water.length, paved: s.paved.length, gravel: s.gravel.length, imgShift: s.imgShift, bytes: j.length, ms: s.ms });
    if (process.argv.includes('--out')) { const f = process.argv[process.argv.indexOf('--out') + 1]; import('fs').then(fs => { fs.writeFileSync(f, j); fs.writeFileSync(f.replace(/\.json$/, '') + '.dbg.json', JSON.stringify(dbg)); }); }
  }).catch((e) => { console.error(e); process.exit(1); });
}
