#!/usr/bin/env node
// Vérification des tuiles Overture (v633.268): pour chaque lieu du banc (tools/batiments/lieux.txt) couvert par les
// tuiles, la couche Overture lue des tuiles doit être celle que DuckDB lit dans les Parquet (mêmes bâtiments, rues,
// arbres, parcs, stationnements; eau à la découpe près). Rapporte ce qui diffère.
//
//   node scripts/overture-tiles-check.mjs                      tous les lieux du banc
//   node scripts/overture-tiles-check.mjs --only 47.01031,-71.37338
//   OVERTURE_TILES_URL=http://localhost:8080 node scripts/overture-tiles-check.mjs   tuiles servies ailleurs

import { readFileSync } from 'fs';
import { overtureBase } from '../api/scene3d.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const ONLY = opt('--only', null);
const ROOT = new URL('..', import.meta.url);
let lieux = readFileSync(new URL('tools/batiments/lieux.txt', ROOT), 'utf8').trim().split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => p.length === 3).map(([name, lat, lng]) => ({ name, lat: Number(lat), lng: Number(lng) }));
if (ONLY) { const [lat, lng] = ONLY.split(',').map(Number); lieux = [{ name: ONLY, lat, lng }]; }
const fmt = (ms) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;

// Écart entre deux tableaux de la couche: identique, ou description de la première différence.
function diff(a, b) {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja === jb) return null;
  if (a.length !== b.length) return `${a.length} contre ${b.length}`;
  for (let i = 0; i < a.length; i++) if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return `rang ${i} (${JSON.stringify(a[i]).slice(0, 80)} / ${JSON.stringify(b[i]).slice(0, 80)})`;
  return 'ordre';
}
const area = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; s += p[0] * q[1] - q[0] * p[1]; } return Math.abs(s / 2); };
const waterArea = (w) => w.reduce((s, p) => s + area(p.o) - p.h.reduce((t, h) => t + area(h), 0), 0);

let bad = 0;
for (const l of lieux) {
  let t, d;
  try { const t0 = Date.now(); t = await overtureBase(l.lat, l.lng, { force: 'tiles' }); t.ms = Date.now() - t0; }
  catch (e) { console.log(`${l.name}: ${e.message}`); continue; }
  { const t0 = Date.now(); d = await overtureBase(l.lat, l.lng, { force: 'duckdb' }); d.ms = Date.now() - t0; }
  const out = [];
  for (const k of ['bld', 'osm', 'roads', 'trees', 'green', 'asphalt']) { const e = diff(t.base[k], d.base[k]); if (e) out.push(`${k}: ${e}`); }
  const ew = diff(t.base.water, d.base.water);
  if (ew) { const at = waterArea(t.base.water), ad = waterArea(d.base.water); out.push(`eau: ${ew}; surface ${Math.round(at)} contre ${Math.round(ad)} m² (${(100 * Math.abs(at - ad) / Math.max(ad, 1)).toFixed(2)} %)`); }
  const same = !out.length;
  if (!same) bad++;
  console.log(`${l.name}: ${same ? 'identique' : 'DIFFÉRENT'} (tuiles ${fmt(t.ms)}, DuckDB ${fmt(d.ms)}; ${t.base.bld.length} bâtiments, ${t.base.roads.length} rues, ${t.base.trees.length} arbres, ${t.base.water.length} plans d'eau)${out.length ? '\n  ' + out.join('\n  ') : ''}`);
}
console.log(bad ? `${bad} lieu(x) différent(s)` : 'tout identique');
process.exit(bad ? 1 : 0);
