#!/usr/bin/env node
// Préchauffage du cache partagé de la vue 3D (3 novembre 2026, v633.266).
//
// Chaque changement de version des environs (SCENE_V dans src/scene3d/data.js) ou du relief (TERRAIN_V dans
// src/scene3d/terrain.js) périme le cache partagé scene3d_cache: à la prochaine ouverture de la 3D, chaque projet
// repasse par le calcul serveur (environ 30 s pour les environs, 7 s pour le relief). Ce script fait ce calcul
// d'avance, une fois la production déployée, pour tous les lieux des projets (tables projects et projects_dev, projets
// exemples, lieux déjà en cache), et range le résultat dans scene3d_cache exactement comme l'app le ferait. Au clic sur
// 3D, tout est déjà là.
//
//   node scripts/scene3d-warm.mjs                 lieux dont le cache est périmé ou absent
//   node scripts/scene3d-warm.mjs --force         tous les lieux, même à jour
//   node scripts/scene3d-warm.mjs --dry-run       liste seulement, sans appel au serveur
//   node scripts/scene3d-warm.mjs --jobs 2        lieux calculés en même temps (3 par défaut)
//   node scripts/scene3d-warm.mjs --base https://meteoshoot-dev.vercel.app   autre déploiement (www.meteoshoot.com par défaut)
//   node scripts/scene3d-warm.mjs --only 47.01031,-71.37338                   un seul lieu
//
// Clé de service Supabase (lecture des projets, écriture du cache): variable SUPABASE_SERVICE_KEY, sinon demandée au
// client Supabase connecté (supabase projects api-keys). Jamais affichée ni écrite.
// Le serveur garde aussi chaque réponse 30 jours dans le cache de Vercel (par adresse, version comprise).

import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const ROOT = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const FORCE = args.includes('--force'), DRY = args.includes('--dry-run');
const JOBS = Math.max(1, parseInt(opt('--jobs', '3'), 10) || 3);
const BASE = opt('--base', 'https://www.meteoshoot.com').replace(/\/$/, '');
const ONLY = opt('--only', null);

const SCENE_V = Number(read('src/scene3d/data.js').match(/const SCENE_V = (\d+)/)[1]);
const TERRAIN_V = Number(read('src/scene3d/terrain.js').match(/TERRAIN_V = (\d+)/)[1]);
const SB_URL = read('src/shared/config.js').match(/https:\/\/[a-z0-9]+\.supabase\.co/)[0];
const TBL = 'scene3d_cache';

function serviceKey() {
  if (process.env.SUPABASE_SERVICE_KEY) return process.env.SUPABASE_SERVICE_KEY;
  const ref = read('supabase/.temp/project-ref').trim();
  const out = execSync(`supabase projects api-keys --project-ref ${ref} -o json`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const k = JSON.parse(out).find((e) => e.name === 'service_role');
  if (!k || !k.api_key) throw new Error('clé de service introuvable: se connecter avec `supabase login` ou donner SUPABASE_SERVICE_KEY');
  return k.api_key;
}
const KEY = DRY ? '' : serviceKey();
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
async function sb(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : null; // écriture avec return=minimal: 201 sans corps
}

// Même clé que l'app (sceneKey dans src/scene3d/data.js): 5 décimales.
const r5 = (v) => Number(Number(v).toFixed(5));
const keyOf = (lat, lng) => `${Number(lat).toFixed(5)}_${Number(lng).toFixed(5)}`;
const fmt = (ms) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;

// Mêmes règles que l'app pour juger une entrée utilisable (usable dans data.js, loadTerrain dans terrain.js).
const sceneOk = (d) => !!(d && d.bld && (d.v || 1) >= SCENE_V && !d.appleErr && !d.lidarErr && Array.isArray(d.appleRoof));
const terrainOk = (t) => !!(t && t.h && (t.v || 1) >= TERRAIN_V);

async function lieux() {
  const seen = new Map();
  const add = (lat, lng, from) => { if (!(lat >= -85 && lat <= 85 && lng >= -180 && lng <= 180)) return; const k = keyOf(lat, lng); if (!seen.has(k)) seen.set(k, { key: k, lat: r5(lat), lng: r5(lng), from }); };
  if (ONLY) { const [a, b] = ONLY.split(',').map(Number); add(a, b, 'option --only'); return [...seen.values()]; }
  // Projets exemples (compte vide): trois lieux publics de Québec.
  for (const m of read('src/projects/samples.js').matchAll(/lat:\s*(-?\d+\.\d+),\s*lng:\s*(-?\d+\.\d+)/g)) add(Number(m[1]), Number(m[2]), 'exemple');
  if (!DRY) {
    for (const t of ['projects', 'projects_dev']) {
      try {
        const rows = await sb(`${t}?select=lat,lng&lat=not.is.null&lng=not.is.null`);
        for (const r of rows) add(r.lat, r.lng, t);
      } catch (e) { console.warn(`  table ${t} illisible: ${e.message}`); }
    }
    // Lieux déjà passés par la 3D (entrées du cache, périmées ou non), sans les préfixes relief et horizon.
    const rows = await sb(`${TBL}?select=key,lat,lng&key=not.like.dem_*&key=not.like.hor_*`);
    for (const r of rows) add(r.lat, r.lng, 'cache');
  }
  return [...seen.values()];
}

async function cached(key) {
  const rows = await sb(`${TBL}?select=key,data&key=in.(${key},dem_${key})`);
  const m = new Map(rows.map((r) => [r.key, r.data]));
  return { scene: m.get(key) || null, dem: m.get('dem_' + key) || null };
}
async function store(key, lat, lng, version, data) {
  await sb(TBL, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ key, lat, lng, version, data }]) });
}
async function getJson(url) {
  const t0 = Date.now();
  const r = await fetch(url, { headers: { 'User-Agent': 'MeteoShoot scene3d-warm' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return { j, ms: Date.now() - t0 };
}

async function warm(l) {
  const out = [];
  const c = DRY ? { scene: null, dem: null } : await cached(l.key);
  // Environs
  if (!FORCE && sceneOk(c.scene)) out.push('environs en cache');
  else if (DRY) out.push(`environs à calculer (${c.scene ? 'périmés' : 'absents'})`);
  else {
    try {
      const { j, ms } = await getJson(`${BASE}/api/scene3d?lat=${l.lat}&lng=${l.lng}&v=${SCENE_V}`);
      if (!j || !j.bld) throw new Error('réponse invalide');
      delete j.ms;
      if (!sceneOk(j)) out.push(`environs incomplets (${j.appleErr ? 'calage Plans manquant' : j.lidarErr ? 'LiDAR manquant' : 'version ' + j.v}), non gardés, ${fmt(ms)}`);
      else { await store(l.key, l.lat, l.lng, SCENE_V, j); out.push(`environs ${fmt(ms)} (${j.bld.length} bât., ${j.trees.length} arbres)`); }
    } catch (e) { out.push(`environs: ÉCHEC ${e.message}`); }
  }
  // Relief
  if (!FORCE && terrainOk(c.dem)) out.push('relief en cache');
  else if (DRY) out.push(`relief à calculer (${c.dem ? 'périmé' : 'absent'})`);
  else {
    try {
      const { j, ms } = await getJson(`${BASE}/api/terrain?lat=${l.lat}&lng=${l.lng}&v=${TERRAIN_V}`);
      if (!j || !j.h || !j.ax) throw new Error('réponse invalide');
      delete j.ms;
      if (j.src && j.src.partial) out.push(`relief incomplet (source en panne), non gardé, ${fmt(ms)}`);
      else { await store('dem_' + l.key, l.lat, l.lng, TERRAIN_V, j); out.push(`relief ${fmt(ms)}`); }
    } catch (e) { out.push(`relief: ÉCHEC ${e.message}`); }
  }
  return out;
}

const list = await lieux();
console.log(`${list.length} lieux, environs v${SCENE_V}, relief v${TERRAIN_V}, serveur ${BASE}${DRY ? ' (essai à blanc)' : ''}${FORCE ? ' (tout recalculer)' : ''}`);
let i = 0, fails = 0; const t0 = Date.now();
await Promise.all(Array.from({ length: Math.min(JOBS, list.length) }, async () => {
  while (i < list.length) {
    const l = list[i++];
    const res = await warm(l);
    if (res.some((s) => s.includes('ÉCHEC'))) fails++;
    console.log(`${l.key.padEnd(20)} ${l.from.padEnd(13)} ${res.join(' · ')}`);
  }
}));
console.log(`terminé en ${fmt(Date.now() - t0)}${fails ? `, ${fails} lieu(x) en échec` : ''}`);
process.exit(fails ? 1 : 0);
