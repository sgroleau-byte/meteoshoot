#!/usr/bin/env node
// Découpage d'Overture en tuiles pour la vue 3D (v633.268, 3 novembre 2026). Voir l'en-tête de api/overture-tiles.js.
//
// Lit les Parquet d'Overture (version RELEASE de api/scene3d.js, fichiers désignés par api/overture-index.json) par
// morceaux de 1 degré, range chaque entité dans les tuiles dont le cadre agrandi la touche, écrit les tuiles (gzip) dans
// un dossier hors du dépôt et, avec --upload, les envoie dans le seau public « overture » du stockage Supabase, puis le
// manifeste (couverture, tuiles subdivisées). Un morceau n'est marqué fait qu'une fois ses tuiles envoyées: relancer
// reprend là où ça s'est arrêté. Le manifeste n'est écrit que si tout a réussi. À refaire à chaque changement de RELEASE.
//
//   node scripts/overture-tiles.mjs --upload                         sud du Québec (cadre par défaut), envoi au seau
//   node scripts/overture-tiles.mjs --bbox -71.6,46.7,-71.1,47.1     autre cadre (lng ouest, lat sud, lng est, lat nord)
//   node scripts/overture-tiles.mjs --only f|w                       une seule grille (f: bâtiments, rues, sol; w: eau)
//   node scripts/overture-tiles.mjs --redo                           refait les morceaux déjà faits
//   node scripts/overture-tiles.mjs --jobs 8                         envois en même temps (8 par défaut)
//   node scripts/overture-tiles.mjs --chunk 1                        taille des morceaux en degrés (1 par défaut)
//   node scripts/overture-tiles.mjs --split-kb 300                   au-delà (gzip), une tuile est subdivisée en quatre
//   node scripts/overture-tiles.mjs --parallel 3                     morceaux lus en même temps (3 par défaut)
//   node scripts/overture-tiles.mjs --out /dossier                   dossier des tuiles (_METEOSHOOT/overture-tuiles/<release> par défaut)
//
// Clé de service Supabase pour l'envoi: variable SUPABASE_SERVICE_KEY, sinon demandée au client Supabase connecté
// (supabase projects api-keys). Jamais affichée ni écrite.

import duckdb from 'duckdb';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { gzipSync } from 'zlib';
import { execSync } from 'child_process';
import { TILES_V, GRIDS, tileAt, tileBox, expandBox, boxesMeet, boxInside, tileKey, tilePath, f32s, wkbToGeom, polysOf, linesOf, clipRing, clipLine, encodeGeom, nVertices, signedArea } from '../api/overture-tiles.js';

const ROOT = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const UPLOAD = args.includes('--upload'), REDO = args.includes('--redo');
const JOBS = Math.max(1, parseInt(opt('--jobs', '8'), 10) || 8);
const CHUNK = Number(opt('--chunk', '1')) || 1;
if (Math.abs(CHUNK / 0.1 - Math.round(CHUNK / 0.1)) > 1e-9) { console.error('--chunk doit être un multiple de 0,1 degré (les morceaux doivent s\'aligner sur les deux grilles)'); process.exit(1); }
const SPLIT = (Number(opt('--split-kb', '300')) || 300) * 1024;
const PAR = Math.max(1, parseInt(opt('--parallel', '3'), 10) || 3);
const ONLY = opt('--only', null);
const BBOX = (opt('--bbox', '-80,44.9,-57,50.5')).split(',').map(Number);
const RELEASE = opt('--release', read('api/scene3d.js').match(/const RELEASE = '([^']+)'/)[1]);
const HTTPS_BASE = `https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/release/${RELEASE}`;
const INDEX = JSON.parse(read('api/overture-index.json'));
if (INDEX.release !== RELEASE) { console.error(`api/overture-index.json est pour ${INDEX.release}, pas ${RELEASE}: python3 scripts/overture-index.py ${RELEASE}`); process.exit(1); }
const OUT = opt('--out', new URL(`../overture-tuiles/${RELEASE}`, ROOT).pathname);
const SB_URL = read('src/shared/config.js').match(/https:\/\/[a-z0-9]+\.supabase\.co/)[0];
const BUCKET = 'overture';
const CLIP_MIN = 300; // sommets à partir desquels une entité est « grande »: rangée avec marge, découpée à la tuile agrandie, lue dans la tuile du lieu seulement (drapeau x)
const fmt = (ms) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
const ko = (b) => `${Math.round(b / 1024)} Ko`;

// Colonnes et filtres par type (les alias sont ceux que api/scene3d.js lit). Le cadre Overture (float32) est gardé tel
// quel pour que le serveur applique exactement le filtre de la requête DuckDB.
const SPEC = {
  f: [
    { k: 'b', path: 'theme=buildings/type=building', cols: ['id', 'height', 'num_floors', 'subtype', 'class', 'src'], sel: 'id, height, num_floors, subtype, class, sources[1].dataset AS src', where: '', noClip: true },
    { k: 'p', path: 'theme=buildings/type=building_part', cols: ['height', 'num_floors', 'min_height', 'min_floor', 'building_id', 'src'], sel: 'height, num_floors, min_height, min_floor, building_id, sources[1].dataset AS src', where: '', noClip: true },
    { k: 's', path: 'theme=transportation/type=segment', cols: ['class', 'subclass', 'name'], sel: 'class, subclass, names.primary AS name', where: `subtype IN ('road','rail')` },
    { k: 'l', path: 'theme=base/type=land', cols: ['subtype', 'class'], sel: 'subtype, class', where: `class IN ('tree','tree_row','wood','forest','grass','scrub','shrub','heath','meadow','wetland')` },
    { k: 'u', path: 'theme=base/type=land_use', cols: ['subtype', 'class'], sel: 'subtype, class', where: `class IN ('park','pitch','playground','track','recreation_ground','grass','garden','cemetery','golf_course','parking','orchard','vineyard','sports_centre','stadium','dog_park','grave_yard','village_green','common')` },
  ],
  w: [
    { k: 'w', path: 'theme=base/type=water', cols: ['subtype', 'class'], sel: 'subtype, class', where: `(class IS NULL OR class <> 'wastewater') AND (subtype IS NULL OR subtype <> 'wastewater')` },
  ],
};
const fileIdx = new Map(); // chemin/fichier -> rang dans l'index (ordre des lignes, comme la lecture directe)
for (const [path, list] of Object.entries(INDEX.types)) list.forEach(([name], i) => fileIdx.set(`${path}/${name}`, i));
function filesFor(path, [x0, y0, x1, y1]) {
  return INDEX.types[path].filter(([, fx0, fy0, fx1, fy1]) => fx0 <= x1 && fx1 >= x0 && fy0 <= y1 && fy1 >= y0).map(([name]) => `${path}/${name}`);
}

// ---------- DuckDB
const run = (con, sql, params = []) => new Promise((res, rej) => con.all(sql, ...params, (e, r) => (e ? rej(e) : res(r))));
async function getDb() {
  const db = await new Promise((resolve, reject) => { const d = new duckdb.Database(':memory:', (e) => (e ? reject(e) : resolve(d))); });
  const con = db.connect();
  await run(con, `SET extension_directory='/tmp/duckdb_ext'`);
  await run(con, `SET autoinstall_known_extensions=true`);
  await run(con, `SET autoload_known_extensions=true`);
  await run(con, `SET threads=8`);
  await run(con, `SET memory_limit='4GB'`);
  await run(con, `SET enable_object_cache=true`);
  con.close();
  return db;
}

// ---------- envoi au seau
function serviceKey() {
  if (process.env.SUPABASE_SERVICE_KEY) return process.env.SUPABASE_SERVICE_KEY;
  const ref = read('supabase/.temp/project-ref').trim();
  const out = execSync(`supabase projects api-keys --project-ref ${ref} -o json`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const k = JSON.parse(out).find((e) => e.name === 'service_role');
  if (!k || !k.api_key) throw new Error('clé de service introuvable: se connecter avec `supabase login` ou donner SUPABASE_SERVICE_KEY');
  return k.api_key;
}
const KEY = UPLOAD ? serviceKey() : '';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
async function ensureBucket() {
  const r = await fetch(`${SB_URL}/storage/v1/bucket/${BUCKET}`, { headers: H });
  if (r.ok) return;
  if (r.status !== 404 && r.status !== 400) throw new Error(`seau: HTTP ${r.status} ${await r.text()}`);
  const c = await fetch(`${SB_URL}/storage/v1/bucket`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: 20971520 }) });
  if (!c.ok) throw new Error(`création du seau: HTTP ${c.status} ${await c.text()}`);
  console.log(`seau public « ${BUCKET} » créé`);
}
async function upload(path, body, type, maxAge) {
  for (let k = 0; k < 6; k++) {
    try {
      const r = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${path}`, { method: 'POST', headers: { ...H, 'Content-Type': type, 'x-upsert': 'true', 'cache-control': `max-age=${maxAge}` }, body, signal: AbortSignal.timeout(60000) });
      if (r.ok) return;
      const txt = await r.text();
      if (r.status < 500 && r.status !== 429) throw new Error(`HTTP ${r.status} ${txt.slice(0, 160)}`);
      console.warn(`  envoi ${path}: HTTP ${r.status}, nouvel essai`);
    } catch (e) { if (k === 5) throw e; console.warn(`  envoi ${path}: ${e.message}, nouvel essai`); }
    await new Promise((r) => setTimeout(r, 1500 * (k + 1)));
  }
}
// File d'envois bornée (JOBS à la fois).
const queue = []; let active = 0;
function enqueue(fn) { return new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); pump(); }); }
function pump() { while (active < JOBS && queue.length) { const { fn, resolve, reject } = queue.shift(); active++; fn().then(resolve, reject).finally(() => { active--; pump(); }); } }

// ---------- état (reprise) et manifeste
mkdirSync(OUT, { recursive: true });
const PROG = `${OUT}/avancement.json`, MANI = `${OUT}/manifest.json`;
const prog = !REDO && existsSync(PROG) ? JSON.parse(readFileSync(PROG, 'utf8')) : { release: RELEASE, done: [], split: { f: [], w: [] }, files: 0, bytes: 0 };
if (prog.release !== RELEASE) { console.error(`${PROG} est pour ${prog.release}`); process.exit(1); }
const splitSets = { f: new Set(prog.split.f), w: new Set(prog.split.w) };
const saveProg = () => { prog.split = { f: [...splitSets.f].sort(), w: [...splitSets.w].sort() }; writeFileSync(PROG, JSON.stringify(prog)); };

// ---------- découpe des grandes entités à la tuile agrandie
function ringBox(r) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of r) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return [x0, y0, x1, y1]; }
function clipped(geom, [x0, y0, x1, y1]) {
  const polys = polysOf(geom);
  if (polys.length) {
    const out = [], ob = [], oa = [];
    for (const rings of polys) {
      const r0 = rings[0]; ob.push(ringBox(r0)); oa.push(signedArea(r0));
      const c = clipRing(r0, x0, y0, x1, y1);
      if (c.length < 3) { out.push([[]]); continue; } // souche: garde sa place (ordre et tirage des arbres), ne dessine rien
      const holes = []; for (let i = 1; i < rings.length; i++) { const h = clipRing(rings[i], x0, y0, x1, y1); if (h.length >= 3) holes.push(h); }
      out.push([c, ...holes]);
    }
    return { g: ['MG', out], ob, oa, x: 1 };
  }
  const lines = linesOf(geom);
  if (lines.length) return { g: ['ML', lines.flatMap((l) => clipLine(l, x0, y0, x1, y1))], x: 1 };
  return { g: encodeGeom(geom) };
}

// Identifiants des bâtiments auxquels une partie de bâtiment se rattache: les seuls que le serveur utilise (outlines),
// donc les seuls gardés dans les tuiles (36 caractères par bâtiment sinon).
let partIds = null;
async function loadPartIds(db) {
  const path = 'theme=buildings/type=building_part', q = expandBox(BBOX, GRIDS.f.margin * 1.05);
  const files = filesFor(path, q);
  partIds = new Set();
  if (!files.length) return;
  const con = db.connect();
  const rows = await run(con, `SELECT DISTINCT building_id FROM read_parquet([${files.map((f) => `'${HTTPS_BASE}/${f}'`).join(',')}], hive_partitioning=0) WHERE building_id IS NOT NULL AND bbox.xmin <= ? AND bbox.xmax >= ? AND bbox.ymin <= ? AND bbox.ymax >= ?`, [q[2], q[0], q[3], q[1]]);
  con.close();
  for (const r of rows) partIds.add(String(r.building_id));
  console.log(`${partIds.size} bâtiments rattachés à des parties`);
}

// ---------- un morceau: lecture des types de la grille, rangement dans les tuiles du morceau, écriture
const stats = { rows: 0, files: 0, bytes: 0, clipped: 0, big: 0 };
async function doChunk(db, grid, cbox) {
  const G = GRIDS[grid], t0 = Date.now();
  const [ix0, iy0] = tileAt(grid, 0, cbox[0] + 1e-9, cbox[1] + 1e-9), [ix1, iy1] = tileAt(grid, 0, cbox[2] - 1e-9, cbox[3] - 1e-9);
  const tiles = []; // tuiles de base du morceau, avec leur cadre agrandi
  for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) { const box = tileBox(grid, 0, ix, iy); tiles.push({ ix, iy, box, ebox: expandBox(box, G.margin), rows: {} }); }
  const byIx = new Map(); for (const t of tiles) { if (!byIx.has(t.ix)) byIx.set(t.ix, []); byIx.get(t.ix).push(t); }
  const qbox = expandBox(cbox, G.margin * 1.05);
  const counts = {};
  for (const sp of SPEC[grid]) {
    const files = filesFor(sp.path, qbox);
    counts[sp.k] = 0;
    if (!files.length) continue;
    const con = db.connect();
    const sql = `SELECT ${sp.sel}, bbox.xmin AS bx0, bbox.ymin AS by0, bbox.xmax AS bx1, bbox.ymax AS by1, geometry, filename, file_row_number AS rn FROM read_parquet([${files.map((f) => `'${HTTPS_BASE}/${f}'`).join(',')}], hive_partitioning=0, filename=true, file_row_number=true) WHERE bbox.xmin <= ? AND bbox.xmax >= ? AND bbox.ymin <= ? AND bbox.ymax >= ?${sp.where ? ` AND ${sp.where}` : ''}`;
    const stream = con.stream(sql, qbox[2], qbox[0], qbox[3], qbox[1]);
    let lastO = -1, disorder = 0;
    for await (const row of stream) {
      const bb = [row.bx0, row.by0, row.bx1, row.by1];
      const fi = fileIdx.get(`${sp.path}/${String(row.filename).split('/').pop()}`);
      if (fi == null) throw new Error(`fichier hors index: ${row.filename}`);
      const o = fi * 4294967296 + Number(row.rn);
      if (o <= lastO) disorder++; lastO = o;
      const geom = wkbToGeom(row.geometry), nv = nVertices(geom);
      const big = !sp.noClip && nv > CLIP_MIN;
      const base = { o, bb: bb.map(f32s) };
      if (big) { base.x = 1; stats.big++; }
      for (const c of sp.cols) { const v = row[c]; if (v != null) base[c] = typeof v === 'bigint' ? Number(v) : v; }
      if (sp.k === 'b' && base.id != null && !partIds.has(String(base.id))) delete base.id;
      if (sp.k === 's' && base.name != null) base.name = String(base.name).slice(0, 60);
      let verbatim = null;
      // Petite entité: tuiles de base que touche son cadre. Grande: tuiles dont le cadre agrandi de la marge le touche
      // (colonnes candidates d'après le cadre agrandi), découpée à ce cadre agrandi quand elle en déborde.
      const [cx0, cy0, cx1, cy1] = big ? expandBox(bb, G.margin * 1.05) : bb;
      const [jx0, jy0] = tileAt(grid, 0, cx0, cy0), [jx1, jy1] = tileAt(grid, 0, cx1, cy1);
      for (let jx = Math.max(jx0, ix0); jx <= Math.min(jx1, ix1); jx++) {
        const col = byIx.get(jx); if (!col) continue;
        for (const t of col) {
          if (t.iy < jy0 || t.iy > jy1 || !boxesMeet(bb, big ? t.ebox : t.box)) continue;
          let s;
          if (!big || boxInside(bb, t.ebox)) s = verbatim || (verbatim = JSON.stringify({ ...base, g: encodeGeom(geom) }));
          else { s = JSON.stringify({ ...base, ...clipped(geom, t.ebox) }); stats.clipped++; }
          (t.rows[sp.k] || (t.rows[sp.k] = [])).push({ bb, o, big, s });
        }
      }
      counts[sp.k]++;
    }
    con.close();
    if (disorder) console.warn(`  ${sp.k}: ${disorder} lignes hors de l'ordre des fichiers (tri à la lecture)`);
    stats.rows += counts[sp.k];
  }
  // Écriture (et envoi) des tuiles, subdivision des trop lourdes.
  const pending = []; let written = 0, bytes = 0, nSplit = 0;
  const emit = (z, ix, iy, rows) => {
    const body = `{"v":${TILES_V},"release":"${RELEASE}","grid":"${grid}","z":${z},"ix":${ix},"iy":${iy}` + Object.keys(rows).sort().map((k) => `,"${k}":[${rows[k].map((r) => r.s).join(',')}]`).join('') + '}';
    const gz = gzipSync(body);
    if (gz.length > SPLIT && z < G.maxZ) {
      splitSets[grid].add(tileKey(z, ix, iy)); nSplit++;
      for (const [cx, cy] of [[2 * ix, 2 * iy], [2 * ix + 1, 2 * iy], [2 * ix, 2 * iy + 1], [2 * ix + 1, 2 * iy + 1]]) {
        const box = tileBox(grid, z + 1, cx, cy), ebox = expandBox(box, G.margin);
        const sub = {}; let n = 0;
        for (const [k, arr] of Object.entries(rows)) { const f = arr.filter((r) => boxesMeet(r.bb, r.big ? ebox : box)); if (f.length) { sub[k] = f; n += f.length; } }
        if (n) emit(z + 1, cx, cy, sub);
      }
      return;
    }
    splitSets[grid].delete(tileKey(z, ix, iy));
    const rel = tilePath(RELEASE, grid, z, ix, iy), file = `${OUT}/${rel.slice(RELEASE.length + 1)}`;
    mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true });
    writeFileSync(file, gz);
    written++; bytes += gz.length;
    if (UPLOAD) pending.push(enqueue(() => upload(rel, gz, 'application/gzip', 86400)));
  };
  for (const t of tiles) {
    // Les lignes arrivent déjà dans l'ordre d'origine (fichier, puis ligne); tri par sécurité: le serveur suit cet ordre.
    for (const arr of Object.values(t.rows)) arr.sort((a, b) => a.o - b.o);
    if (Object.keys(t.rows).length) emit(0, t.ix, t.iy, t.rows);
  }
  await Promise.all(pending);
  stats.files += written; stats.bytes += bytes;
  console.log(`  ${grid} ${cbox.join(',')}: ${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ')}, ${written} tuiles (${ko(bytes)}${nSplit ? `, ${nSplit} subdivisées` : ''}), ${fmt(Date.now() - t0)}`);
}

// ---------- morceaux du cadre
function* chunks(bbox, step) {
  const x0 = Math.floor(bbox[0] / step) * step, y0 = Math.floor(bbox[1] / step) * step;
  for (let y = y0; y < bbox[3]; y += step) for (let x = x0; x < bbox[2]; x += step) yield [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6, Math.round((x + step) * 1e6) / 1e6, Math.round((y + step) * 1e6) / 1e6];
}

async function main() {
  const t0 = Date.now();
  console.log(`Overture ${RELEASE}, cadre ${BBOX.join(',')}, dossier ${OUT}${UPLOAD ? `, envoi au seau ${BUCKET}` : ' (sans envoi)'}`);
  if (UPLOAD) await ensureBucket();
  const db = await getDb();
  const grids = ONLY ? [ONLY] : ['f', 'w'];
  if (grids.includes('f')) await loadPartIds(db);
  const all = []; for (const g of grids) for (const c of chunks(BBOX, CHUNK)) all.push([g, c]);
  const todo = all.filter(([g, c]) => !prog.done.includes(`${g}:${c[0]},${c[1]}`));
  console.log(`${all.length} morceaux, ${all.length - todo.length} déjà faits`);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < todo.length) {
      const [g, c] = todo[next++];
      await doChunk(db, g, c);
      prog.done.push(`${g}:${c[0]},${c[1]}`); prog.files = stats.files; prog.bytes = stats.bytes;
      saveProg();
      done++; if (done % 10 === 0) console.log(`${done} / ${todo.length} morceaux, ${fmt(Date.now() - t0)}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PAR, todo.length) }, worker));
  // Manifeste: couverture (cadres des deux grilles faits), tuiles subdivisées; fusionné avec le précédent.
  const complete = ['f', 'w'].every((g) => [...chunks(BBOX, CHUNK)].every((c) => prog.done.includes(`${g}:${c[0]},${c[1]}`)));
  if (!complete) { console.log(`grille ${ONLY} faite; le manifeste attend l'autre grille`); return; }
  const prev = existsSync(MANI) ? JSON.parse(readFileSync(MANI, 'utf8')) : null;
  const covered = (prev && prev.release === RELEASE && prev.covered) || [];
  if (!covered.some((b) => b.join(',') === BBOX.join(','))) covered.push(BBOX);
  const m = { v: TILES_V, release: RELEASE, grids: GRIDS, covered, split: { f: [...splitSets.f].sort(), w: [...splitSets.w].sort() }, generated: new Date().toISOString(), files: stats.files, bytes: stats.bytes };
  writeFileSync(MANI, JSON.stringify(m));
  if (UPLOAD) await upload(`${RELEASE}/manifest.json`, JSON.stringify(m), 'application/json', 600);
  console.log(`terminé en ${fmt(Date.now() - t0)}: ${stats.rows} entités (${stats.big} grandes), ${stats.files} tuiles (${ko(stats.bytes)}), ${stats.clipped} découpes, subdivisions f ${splitSets.f.size}, w ${splitSets.w.size}; manifeste ${UPLOAD ? 'envoyé' : 'écrit'} (${covered.length} cadre${covered.length > 1 ? 's' : ''})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
