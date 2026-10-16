// Fonction serveur (Vercel): nuages vus par le satellite GOES-19 (GOES-Est) au-dessus d'un lieu, maintenant (15 octobre
// 2026). Produit « couches de couverture nuageuse » (CCL) de niveau 2 de la NOAA, secteur CONUS (jusqu'à environ 50,7° N:
// Québec, Montréal, Gaspé, Sept-Îles, Val-d'Or), toutes les 5 minutes, cellules d'environ 10 km, en ligne environ 5 minutes
// après la prise de vue sur le stockage ouvert d'Amazon (noaa-goes19). Fraction nuageuse totale et en cinq tranches
// d'altitude au-dessus de la mer: 0 à 1,5 km, 1,5 à 3, 3 à 5,5, 5,5 à 7,3, plus de 7,3 km.
// Le satellite voit le dessus des nuages: des nuages bas sous un voile d'altitude lui échappent (l'appelant garde alors le
// modèle pour les nuages bas); la nuit, il ne voit qu'en infrarouge (nuages bas moins sûrs).
// Rend aussi la ligne vers le soleil (0 à 350 km): au coucher, un nuage à 1,5 km cache le soleil à 40 km, un cirrus à 300 km.
//
// GET /api/goes?lat=46.84&lng=-71.28  ->  { scan, ageMin, point, area, sun: { el, az, line: [{ km, ... }] }, sunset: {...} }
// Essai local: node api/goes.js --test 46.84 -71.28

import h5wasm from 'h5wasm/node';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import SunCalc from 'suncalc';

export const maxDuration = 30;
const BUCKET = 'https://noaa-goes19.s3.amazonaws.com';
const PRODUCT = 'ABI-L2-CCLC';
const LAYER_H = [800, 2200, 4200, 6400, 9500]; // altitude typique du dessus de chaque tranche (m), pour la parallaxe
const SAT_LON = -75.2; // GOES-Est

// Dernier fichier, gardé 2 minutes par l'instance (tous les lieux partagent le même fichier)
let cache = null; // { key, at, file, info }
const doy = (d) => String(Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5)).padStart(3, '0');
async function listHour(d) {
  const p = `${PRODUCT}/${d.getUTCFullYear()}/${doy(d)}/${String(d.getUTCHours()).padStart(2, '0')}/`;
  const x = await (await fetch(`${BUCKET}/?list-type=2&prefix=${p}`, { signal: AbortSignal.timeout(6000) })).text();
  return [...x.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
}
// at: date de rejeu (banc, tests): fichier le plus proche de cette heure; sinon le dernier
let inflight = null; // une seule lecture à la fois pour le fichier courant (requêtes simultanées de plusieurs lieux)
async function latestFile(at = null) {
  if (!at && cache && Date.now() - cache.at < 120000) return cache;
  if (!at) { if (!inflight) inflight = readFile(null).finally(() => { inflight = null; }); return inflight; }
  return readFile(at);
}
async function readFile(at) {
  await h5wasm.ready;
  const now = at ? new Date(at) : new Date();
  let keys = await listHour(now); if (!keys.length) keys = await listHour(new Date(now - 3600000));
  if (!keys.length) throw new Error('aucun fichier GOES récent');
  const sk = (k) => { const m = k.match(/_s(\d{4})(\d{3})(\d{2})(\d{2})/); return m ? Date.UTC(+m[1], 0, +m[2], +m[3], +m[4]) : 0; };
  const key = at ? keys.filter((k) => sk(k) <= now.getTime()).sort().at(-1) || keys.sort()[0] : keys.sort().at(-1);
  if (cache && cache.key === key) { cache.at = Date.now(); return cache; }
  const buf = new Uint8Array(await (await fetch(`${BUCKET}/${key}`, { signal: AbortSignal.timeout(12000) })).arrayBuffer());
  const path = join(tmpdir(), `ccl_${Date.now()}_${Math.random().toString(36).slice(2)}.nc`); writeFileSync(path, buf);
  let f, req, rpol, H, lon0, xs, xo, ys, yo, shape, arr, tcfScale, tcfOff;
  try {
    f = new h5wasm.File(path, 'r');
    const pa = f.get('goes_imager_projection').attrs, g = (k) => +[].concat(pa[k].value)[0];
    req = g('semi_major_axis'); rpol = g('semi_minor_axis'); H = g('perspective_point_height') + req; lon0 = (g('longitude_of_projection_origin') * Math.PI) / 180;
    const ax = (n) => { const a = f.get(n).attrs; return [+[].concat(a.scale_factor.value)[0], +[].concat(a.add_offset.value)[0]]; };
    [xs, xo] = ax('x'); [ys, yo] = ax('y');
    shape = f.get('TCF').shape; // [rangées, colonnes]
    // Tableaux entiers en mémoire (0,4 Mo compressés, quelques Mo décompressés): lectures rapides ensuite
    arr = {}; for (const k of ['TCF', 'CF1', 'CF2', 'CF3', 'CF4', 'CF5']) arr[k] = f.get(k).value;
    tcfScale = +[].concat(f.get('TCF').attrs.scale_factor.value)[0]; tcfOff = +[].concat((f.get('TCF').attrs.add_offset || { value: 0 }).value)[0];
  } finally { try { if (f) f.close(); } catch (e) { /* rien */ } try { unlinkSync(path); } catch (e) { /* rien */ } }
  const scan = (key.match(/_s(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})/) || []).slice(1);
  const scanDate = scan.length ? new Date(Date.UTC(+scan[0], 0, +scan[1], +scan[2], +scan[3], +scan[4])) : null;
  const e2 = (req * req - rpol * rpol) / (req * req);
  const ij = (la, lo) => {
    const phi = (la * Math.PI) / 180, lam = (lo * Math.PI) / 180, pc = Math.atan(((rpol * rpol) / (req * req)) * Math.tan(phi));
    const rc = rpol / Math.sqrt(1 - e2 * Math.cos(pc) ** 2);
    const sx = H - rc * Math.cos(pc) * Math.cos(lam - lon0), sy = -rc * Math.cos(pc) * Math.sin(lam - lon0), sz = rc * Math.sin(pc);
    const x = Math.asin(-sy / Math.hypot(sx, sy, sz)), y = Math.atan(sz / sx);
    return [Math.round((x - xo) / xs), Math.round((y - yo) / ys)];
  };
  const entry = { key, at: Date.now(), info: { arr, shape, ij, tcfScale, tcfOff, scanDate } };
  if (!at) cache = entry;
  return entry;
}

// Décalage de parallaxe: un nuage à h mètres paraît déplacé à l'opposé du satellite de h fois la tangente de l'angle de visée
function parallax(lat, lng, h) {
  const R = 6371, Hs = 35786, la = (lat * Math.PI) / 180, dl = ((lng - SAT_LON) * Math.PI) / 180;
  const c = Math.acos(Math.cos(la) * Math.cos(dl)); // angle au centre entre le point et le point sous le satellite
  const vza = Math.atan2(Math.sin(c), Math.cos(c) - R / (R + Hs));
  const d = (h / 1000) * Math.tan(vza); // km
  const az = Math.atan2(Math.sin(dl) * Math.cos(0), Math.cos(0) * Math.sin(la) - Math.sin(0) * Math.cos(la) * Math.cos(dl)); // direction depuis le point sous le satellite
  return [lat + (d * Math.cos(az)) / 111.2, lng + (d * Math.sin(az)) / (111.2 * Math.cos(la))];
}

function sample(info, lat, lng, half = 1) {
  const { arr, shape, ij, tcfScale, tcfOff } = info, [nr, nc] = shape;
  const out = {};
  const layer = (k, h) => {
    const [pl, pg] = h ? parallax(lat, lng, h) : [lat, lng]; const [i, j] = ij(pl, pg);
    let s = 0, n = 0;
    for (let jj = j - half; jj <= j + half; jj++) for (let ii = i - half; ii <= i + half; ii++) {
      if (jj < 0 || ii < 0 || jj >= nr || ii >= nc) continue;
      const v = arr[k][jj * nc + ii];
      if (k === 'TCF' ? v === 65535 || v < 0 : v === 255 || v < 0) continue;
      s += k === 'TCF' ? v * tcfScale + tcfOff : v / 100; n++;
    }
    return n ? s / n : null;
  };
  out.tcf = layer('TCF', 2500);
  const cf = ['CF1', 'CF2', 'CF3', 'CF4', 'CF5'].map((k, i) => layer(k, LAYER_H[i]));
  if (out.tcf == null || cf.some((v) => v == null)) return null; // hors du secteur
  const u = (a, b) => 1 - (1 - a) * (1 - b); // recouvrement au hasard
  out.cf = cf.map((v) => Math.round(v * 100));
  out.low = Math.round(u(cf[0], cf[1]) * 100); out.mid = Math.round(cf[2] * 100); out.high = Math.round(u(cf[3], cf[4]) * 100);
  out.tcf = Math.round(out.tcf * 100);
  return out;
}

const KMS = [0, 10, 20, 40, 60, 100, 150, 250, 350];
function lineToward(info, lat, lng, azDeg) {
  const a = (azDeg * Math.PI) / 180;
  return KMS.map((km) => ({ km, ...(sample(info, lat + (km * Math.cos(a)) / 111.2, lng + (km * Math.sin(a)) / (111.2 * Math.cos((lat * Math.PI) / 180)), 0) || { out: true }) }));
}
const azOf = (date, lat, lng) => { const p = SunCalc.getPosition(date, lat, lng); return { el: Math.round(((p.altitude * 180) / Math.PI) * 10) / 10, az: Math.round(((((p.azimuth * 180) / Math.PI) + 180) % 360) * 10) / 10 }; };

export async function goesAt(lat, lng, at = null) {
  const { info } = await latestFile(at);
  const point = sample(info, lat, lng, 1);
  if (!point) return { outside: true, scan: info.scanDate };
  const now = at ? new Date(at) : new Date(), s = azOf(now, lat, lng), st = SunCalc.getTimes(now, lat, lng), ss = azOf(st.sunset, lat, lng), sr = azOf(st.sunrise, lat, lng);
  return {
    scan: info.scanDate, ageMin: info.scanDate ? Math.round((now - info.scanDate) / 6000) / 10 : null,
    point, area: sample(info, lat, lng, 3),
    sun: { ...s, line: s.el > -6 ? lineToward(info, lat, lng, s.az) : null },
    sunset: { at: st.sunset, az: ss.az, line: lineToward(info, lat, lng, ss.az) },
    sunrise: { at: st.sunrise, az: sr.az, line: lineToward(info, lat, lng, sr.az) },
  };
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const lat = parseFloat(url.searchParams.get('lat')), lng = parseFloat(url.searchParams.get('lng'));
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json');
  if (!(lat >= -85 && lat <= 85 && lng >= -180 && lng <= 180)) { res.statusCode = 400; res.end(JSON.stringify({ error: 'lat/lng invalides' })); return; }
  try {
    const at = url.searchParams.get('at'); // rejeu (banc): ISO
    const out = await goesAt(lat, lng, at && !isNaN(Date.parse(at)) ? at : null);
    res.statusCode = 200; res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=240, stale-while-revalidate=300');
    res.end(JSON.stringify(out));
  } catch (e) {
    console.error('[goes]', e); res.statusCode = 502; res.end(JSON.stringify({ error: String((e && e.message) || e) }));
  }
}

if (process.argv.includes('--test') && import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--test');
  const lat = parseFloat(process.argv[i + 1] || '46.84'), lng = parseFloat(process.argv[i + 2] || '-71.28');
  const t0 = Date.now();
  goesAt(lat, lng, process.argv[i + 3] || null).then((o) => { console.log(JSON.stringify(o, null, 1).slice(0, 2500)); console.log((Date.now() - t0) + ' ms'); }).catch((e) => { console.error(e); process.exit(1); });
}
