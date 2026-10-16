// Fonction serveur (Vercel): instantané des prévisions de nuages pour la vérification privée (16 octobre 2026). Pour 33
// aéroports canadiens avec observateur (ceux du banc, tools/clouds), calcule exactement ce que l'app affiche (ICON brut,
// couverture combinée, puis correction par le ciel observé des premières heures) et relève les prévisions publiées par
// Environnement Canada pour la ville la plus proche (horaire sur 24 h, par période sur 6 jours). Appelée toutes les 6 h par
// la fonction Supabase cloud-verif, qui range l'instantané dans la table privée cloud_verif; la comparaison au ciel
// observé se fait plus tard (tools/clouds/verif_live.py). Réservée à cette fonction (jeton partagé VERIF_SNAPSHOT_TOKEN).
//
// GET /api/verif-snapshot  ->  { issued, stations: [{ id, lat, lon, f: { t0, icon, iconLow, comb, combLow, now, nowLow }, eccc }] }
// Essai local: node api/verif-snapshot.js --test

import { readFileSync } from 'node:fs';
import { applyBlend, BLEND_MEMBERS, MEMBER_API } from '../src/weather/blend.js';
import { applyObservedToHourly } from '../src/weather/nowcast.js';
import { clearDirHour } from '../src/weather/solar.js';
import { goesAt } from './goes.js';
import { nearbyObs } from './metar.js';
import { openMeteoUrl } from './om.js';

export const maxDuration = 120;
const STATIONS = [
  ['CYQB', 46.791, -71.396], ['CYBG', 48.331, -70.989], ['CYGP', 48.777, -64.478], ['CYGR', 47.425, -61.775], ['CYMX', 45.68, -74.038],
  ['CYND', 45.52, -75.563], ['CYOY', 46.9003, -71.5033], ['CYRJ', 48.523, -72.266], ['CYUL', 45.468, -73.742], ['CYUY', 48.209, -78.83],
  ['CYVO', 48.056, -77.779], ['CYYY', 48.609, -68.208], ['CYZV', 50.217, -66.26], ['CYEG', 53.308, -113.592], ['CYGK', 44.223, -76.599],
  ['CYHZ', 44.8781, -63.5136], ['CYOW', 45.307, -75.66], ['CYQM', 46.107, -64.682], ['CYQR', 50.427, -104.67], ['CYQT', 48.374, -89.33],
  ['CYQY', 46.166, -60.049], ['CYSB', 46.622, -80.799], ['CYSJ', 45.309, -65.886], ['CYTS', 48.568, -81.378], ['CYVR', 49.183, -123.168],
  ['CYWG', 49.916, -97.249], ['CYXE', 52.172, -106.695], ['CYXU', 43.039, -81.162], ['CYXX', 49.027, -122.377], ['CYYC', 51.116, -114.011],
  ['CYYG', 46.289, -63.128], ['CYYT', 47.627, -52.748], ['CYYZ', 43.679, -79.629],
];
const HOURS = 49; // de l'heure en cours à +48 h

async function om(path, attempt = 0) {
  const res = await fetch(openMeteoUrl(path), { signal: AbortSignal.timeout(45000) }); // serveurs réservés avec la clé du forfait
  if ((res.status === 429 || res.status >= 500) && attempt < 3) { await new Promise((r) => setTimeout(r, 4000 * (attempt + 1))); return om(path, attempt + 1); }
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const j = await res.json(); return Array.isArray(j) ? j : [j];
}

// Ville d'Environnement Canada la plus proche (pages météo des villes, données ouvertes GeoMet)
const ecccSite = new Map();
async function eccc(id, lat, lon) {
  let site = ecccSite.get(id);
  if (!site) {
    const r = await fetch(`https://api.weather.gc.ca/collections/citypageweather-realtime/items?f=json&lang=fr&limit=30&bbox=${(lon - 0.6).toFixed(2)},${(lat - 0.45).toFixed(2)},${(lon + 0.6).toFixed(2)},${(lat + 0.45).toFixed(2)}`, { signal: AbortSignal.timeout(20000) });
    const j = await r.json(); let best = null;
    for (const f of j.features || []) { const [x, y] = f.geometry.coordinates, d = Math.hypot((x - lon) * Math.cos((lat * Math.PI) / 180), y - lat); if (!best || d < best.d) best = { d, f }; }
    if (!best) return null;
    site = { id: best.f.id, name: best.f.properties.name?.fr, km: Math.round(best.d * 111) }; ecccSite.set(id, site);
    return pickEccc(site, best.f.properties);
  }
  const r = await fetch(`https://api.weather.gc.ca/collections/citypageweather-realtime/items/${site.id}?f=json&lang=fr`, { signal: AbortSignal.timeout(20000) });
  return pickEccc(site, (await r.json()).properties);
}
const v = (x) => (x && typeof x === 'object' && 'fr' in x ? x.fr : x);
function pickEccc(site, p) {
  const hg = p.hourlyForecastGroup || {}, fg = p.forecastGroup || {};
  return {
    site: site.id, name: site.name, km: site.km,
    hIssued: v(hg.timestamp), hourly: (hg.hourlyForecasts || []).map((h) => ({ t: h.timestamp, icon: h.iconCode?.value ?? null })),
    pIssued: v(fg.timestamp), periods: (fg.forecasts || []).map((f) => ({ name: v(f.period?.textForecastName), icon: f.abbreviatedForecast?.icon?.value ?? null, sky: v(f.cloudPrecip), abbr: v(f.abbreviatedForecast?.textSummary) })),
  };
}

export async function snapshot() {
  const model = JSON.parse(readFileSync(new URL('../src/weather/blendModel.json', import.meta.url), 'utf8'));
  const lat = STATIONS.map((s) => s[1]).join(','), lon = STATIONS.map((s) => s[2]).join(',');
  const q = `latitude=${lat}&longitude=${lon}&timezone=GMT&forecast_days=4`;
  // Requêtes l'une après l'autre (l'offre d'Open-Meteo refuse les requêtes simultanées quand le service est chargé)
  const icon = await om(`dwd-icon?${q}&hourly=cloudcover,cloudcover_low,direct_radiation`);
  const gfs = await om(`gfs?${q}&hourly=cloudcover,cloudcover_low`);
  const mem = await om(`forecast?${q}&hourly=cloud_cover,cloud_cover_low&models=${BLEND_MEMBERS.map((m) => MEMBER_API[m]).join(',')}`);
  const now = Date.now(), h0 = Math.floor(now / 3600000) * 3600000;
  const out = [];
  for (let k = 0; k < STATIONS.length; k++) {
    const [id, la, lo] = STATIONS[k], I = icon[k], G = gfs[k], M = mem[k];
    if (!I || !I.hourly) continue;
    const hourly = { time: I.hourly.time, cloudcover: I.hourly.cloudcover.slice(), cloudcover_low: I.hourly.cloudcover_low.slice(), direct_radiation: I.hourly.direct_radiation.slice(), model: I.hourly.time.map(() => 'icon') };
    const gfsHourIdx = {}; if (G && G.hourly) G.hourly.time.forEach((t, i) => { gfsHourIdx[t] = i; });
    applyBlend(hourly, { model, gfs: G, gfsHourIdx, members: M, lat: la, lng: lo, tzOffsetMin: 0, now });
    let obs = null;
    try { obs = { goes: await goesAt(la, lo), metar: await nearbyObs(la, lo, 150) }; } catch (e) { obs = null; }
    // Deux corrections par le ciel observé: avec l'aéroport lui-même (un projet à l'aéroport) et sans lui (le cas courant
    // d'un projet loin de l'aéroport: satellite et aéroports voisins seulement), pour ne pas se juger sur sa propre vérité
    const far = { time: hourly.time, cloudcover: hourly.cloudcover.slice(), cloudcover_low: hourly.cloudcover_low.slice(), direct_radiation: hourly.direct_radiation.slice(), cloudcoverIcon: hourly.cloudcoverIcon, cloudLowIcon: hourly.cloudLowIcon };
    const obsFar = obs && { goes: obs.goes, metar: obs.metar && { ...obs.metar, stations: (obs.metar.stations || []).filter((s) => s.id !== id) } };
    const opts = { lat: la, lng: lo, tzOffsetMin: 0, elev: I.elevation ?? 0, now, clearDir: (t) => clearDirHour(t, la, lo) };
    applyObservedToHourly(hourly, obs, opts);
    applyObservedToHourly(far, obsFar, opts);
    const i0 = hourly.time.findIndex((t) => Date.parse(t + ':00Z') >= h0); if (i0 < 0) continue;
    const sl = (a) => a.slice(i0, i0 + HOURS).map((x) => (x == null ? null : Math.round(x)));
    let ec = null; try { ec = await eccc(id, la, lo); } catch (e) { ec = { error: String(e.message || e) }; }
    out.push({
      id, lat: la, lon: lo,
      f: { t0: hourly.time[i0] + ':00Z', icon: sl(hourly.cloudcoverIcon), iconLow: sl(hourly.cloudLowIcon), comb: sl(hourly.cloudcoverModel), combLow: sl(hourly.cloudLowModel), now: sl(hourly.cloudcover).slice(0, 8), nowLow: sl(hourly.cloudcover_low).slice(0, 8), nowFar: sl(far.cloudcover).slice(0, 8), nowFarLow: sl(far.cloudcover_low).slice(0, 8) },
      obsUsed: !!(obs && (obs.goes?.point || obs.metar?.stations?.length)),
      eccc: ec,
    });
  }
  return { issued: new Date(now).toISOString(), version: 'v633.215', stations: out };
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
  // Réservé à la fonction Supabase cloud-verif (jeton partagé): l'instantané utilise la clé payante d'Open-Meteo
  const tok = (process.env.VERIF_SNAPSHOT_TOKEN || '').trim();
  if (!tok || req.headers['x-verif-token'] !== tok) { res.statusCode = 401; res.end(JSON.stringify({ error: 'refusé' })); return; }
  try {
    const out = await snapshot();
    res.statusCode = 200;
    res.end(JSON.stringify(out));
  } catch (e) {
    console.error('[verif-snapshot]', e); res.statusCode = 502; res.end(JSON.stringify({ error: String((e && e.message) || e) }));
  }
}

if (process.argv.includes('--test') && import.meta.url === `file://${process.argv[1]}`) {
  const t0 = Date.now();
  snapshot().then((o) => {
    console.log(o.issued, o.stations.length, 'stations', Date.now() - t0, 'ms', JSON.stringify(o).length, 'octets');
    const s = o.stations[0]; console.log(s.id, 'ICON', s.f.icon.slice(0, 12).join(' '), '| comb', s.f.comb.slice(0, 12).join(' '), '| now', s.f.now.join(' '));
    console.log('EC', s.eccc?.name, s.eccc?.km, 'km', s.eccc?.hourly?.slice(0, 6).map((h) => h.icon).join(' '), '|', s.eccc?.periods?.slice(0, 4).map((p) => p.name + ':' + p.icon).join(' '));
  }).catch((e) => { console.error(e); process.exit(1); });
}
