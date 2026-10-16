// Fonction serveur (Vercel): observations récentes des aéroports autour d'un lieu (15 octobre 2026), pour corriger les
// premières heures de la prévision des nuages avec le ciel réellement observé. Source: le service de données d'aviation
// de la NOAA (aviationweather.gov), qui relaie les METAR du Canada et des États-Unis avec leurs remarques (huitièmes par
// couche au Canada). Il n'envoie pas d'en-tête CORS, d'où ce relais.
// Son API limite à 100 requêtes par minute: on lit plutôt son fichier de toutes les stations (mis à jour chaque minute,
// environ 270 Ko), gardé 2 minutes par l'instance et partagé par tous les lieux; seul l'historique des 4 dernières heures
// de l'aéroport le plus proche passe par l'API (une requête par station, gardée 10 minutes).
//
// GET /api/metar?lat=46.84&lng=-71.28[&r=90]  ->  { stations: [{ id, name, lat, lon, elev, km, obs: [{ t, ...parseMetar }] }], at }
// Essai local: node api/metar.js --test 46.84 -71.28 [heure ISO de rejeu]

import { gunzipSync } from 'node:zlib';
import { parseMetar, kmBetween } from '../src/weather/metar.js';

const API = 'https://aviationweather.gov/api/data/metar';
const CACHE_CSV = 'https://aviationweather.gov/data/cache/metars.cache.csv.gz';
const UA = { 'User-Agent': 'MeteoShoot (meteoshoot.com)' };

// Une ligne CSV avec champs entre guillemets
const splitCsv = (line) => { const out = []; let cur = '', q = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; } else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; };

let latest = null; // { at, rows: [{ id, lat, lon, elev, t, raw, type }] }
async function latestAll() {
  if (latest && Date.now() - latest.at < 120000) return latest.rows;
  const res = await fetch(CACHE_CSV, { headers: UA, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`aviationweather ${res.status}`);
  const text = gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8');
  const lines = text.split('\n'); const head = splitCsv(lines[0]);
  const ix = (k) => head.indexOf(k), iRaw = ix('raw_text'), iId = ix('station_id'), iT = ix('observation_time'), iLa = ix('latitude'), iLo = ix('longitude'), iEl = ix('elevation_m'), iTy = ix('metar_type');
  const rows = [];
  for (let k = 1; k < lines.length; k++) {
    if (!lines[k]) continue; const c = splitCsv(lines[k]);
    const la = parseFloat(c[iLa]), lo = parseFloat(c[iLo]); if (!(la === la && lo === lo)) continue;
    rows.push({ id: c[iId], lat: la, lon: lo, elev: c[iEl] === '' ? null : parseFloat(c[iEl]), t: c[iT], raw: c[iRaw], type: c[iTy] });
  }
  latest = { at: Date.now(), rows };
  return rows;
}

const histCache = new Map(); // id -> { at, list }
async function history(id, at = null) {
  const key = id + (at || ''), h = histCache.get(key);
  if (h && Date.now() - h.at < 600000) return h.list;
  const res = await fetch(`${API}?ids=${id}&format=json&hours=4${at ? `&date=${new Date(at).toISOString().slice(0, 19)}Z` : ''}`, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return [];
  const list = await res.json();
  const out = (Array.isArray(list) ? list : []).map((m) => ({ t: m.reportTime ? new Date(m.reportTime).toISOString() : new Date(m.obsTime * 1000).toISOString(), raw: m.rawOb, type: m.metarType, name: m.name }));
  histCache.set(key, { at: Date.now(), list: out });
  if (histCache.size > 300) histCache.delete(histCache.keys().next().value);
  return out;
}

export async function nearbyObs(lat, lng, rKm = 90, at = null) {
  // Rejeu (banc, tests): l'API pour une heure passée; sinon le fichier de toutes les stations
  let rows;
  if (at) {
    const dLat = rKm / 111, dLng = rKm / (111 * Math.cos((lat * Math.PI) / 180));
    const bbox = [lat - dLat, lng - dLng, lat + dLat, lng + dLng].map((v) => v.toFixed(3)).join(',');
    const res = await fetch(`${API}?bbox=${bbox}&format=json&hours=1.5&date=${new Date(at).toISOString().slice(0, 19)}Z`, { headers: UA, signal: AbortSignal.timeout(10000) });
    const list = res.ok ? await res.json() : [];
    rows = (Array.isArray(list) ? list : []).map((m) => ({ id: m.icaoId, lat: m.lat, lon: m.lon, elev: m.elev ?? null, t: m.reportTime ? new Date(m.reportTime).toISOString() : new Date(m.obsTime * 1000).toISOString(), raw: m.rawOb, type: m.metarType, name: m.name }));
  } else rows = await latestAll();
  const by = new Map();
  for (const m of rows) {
    const km = kmBetween(lat, lng, m.lat, m.lon); if (km > rKm) continue;
    const p = parseMetar(m.raw); if (!p) continue; // station sans observation du ciel
    if (!by.has(m.id)) by.set(m.id, { id: m.id, name: m.name || m.id, lat: m.lat, lon: m.lon, elev: m.elev, km: Math.round(km * 10) / 10, obs: [] });
    by.get(m.id).obs.push({ t: new Date(m.t).toISOString(), special: m.type === 'SPECI', ...p });
  }
  const stations = [...by.values()].map((s) => ({ ...s, obs: s.obs.sort((a, b) => (a.t < b.t ? 1 : -1)).slice(0, 1) })).sort((a, b) => a.km - b.km);
  // Historique (4 h) de l'aéroport avec observateur le plus proche, pour les heures passées de la bande horaire
  const best = stations.find((s) => s.obs[0] && s.obs[0].human);
  if (best) {
    try {
      const hist = await history(best.id, at);
      if (hist.length && hist[0].name) best.name = hist[0].name;
      const seen = new Set(best.obs.map((o) => o.t));
      for (const h of hist) { const p = parseMetar(h.raw); if (p && !seen.has(h.t)) { best.obs.push({ t: h.t, special: h.type === 'SPECI', ...p }); seen.add(h.t); } }
      best.obs.sort((a, b) => (a.t < b.t ? 1 : -1));
    } catch (e) { /* historique facultatif */ }
  }
  return { stations, at: new Date().toISOString() };
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const lat = parseFloat(url.searchParams.get('lat')), lng = parseFloat(url.searchParams.get('lng'));
  const r = Math.min(150, Math.max(10, parseFloat(url.searchParams.get('r')) || 90));
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (!(lat >= -85 && lat <= 85 && lng >= -180 && lng <= 180)) { res.statusCode = 400; res.end(JSON.stringify({ error: 'lat/lng invalides' })); return; }
  try {
    const at = url.searchParams.get('at'); // rejeu (banc): ISO
    const out = await nearbyObs(lat, lng, r, at && !isNaN(Date.parse(at)) ? at : null);
    res.statusCode = 200;
    res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=300, stale-while-revalidate=600');
    res.end(JSON.stringify(out));
  } catch (e) {
    console.error('[metar]', e);
    res.statusCode = 502; res.end(JSON.stringify({ error: String((e && e.message) || e) }));
  }
}

if (process.argv.includes('--test')) {
  const i = process.argv.indexOf('--test');
  const lat = parseFloat(process.argv[i + 1] || '46.84'), lng = parseFloat(process.argv[i + 2] || '-71.28');
  const t0 = Date.now();
  nearbyObs(lat, lng, 90, process.argv[i + 3] || null).then((o) => {
    for (const s of o.stations) console.log(s.id, s.km + ' km', s.name, '|', s.obs.slice(0, 4).map((x) => `${x.t.slice(11, 16)} ${x.kind} tot ${x.tot} bas ${x.low} ${x.layers.map((l) => `${l.type || l.cover}${l.octas}@${l.baseM}`).join(' ')}`).join(' / '));
    console.log(Date.now() - t0, 'ms');
  }).catch((e) => { console.error(e); process.exit(1); });
}
