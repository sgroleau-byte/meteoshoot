// LiDAR américain (4 novembre 2026), pendant du LiDAR de Ressources naturelles Canada (api/terrain.js, api/heights.js,
// api/trees.js). Stéphane, devant un projet à Sedona: « pour le relief, est-ce que ça peut être plus précis? ».
//
// Deux sources de l'USGS (programme 3DEP), gratuites, lues par plages d'octets avec api/cog.js:
// 1) Modèle numérique de terrain à 1 m (sol nu): GeoTIFF LZW à prédicteur flottant sur le seau S3 prd-tnm, tuiles de
//    10 km en UTM NAD83 (10 012 pixels, marge de 6 m), aperçus à 2, 4, 8, 16 et 32 m. Index officiel TNM Access (0,4 s).
//    Plusieurs relevés se superposent souvent (Sedona: 2019 et 2023): le plus récent d'abord. Sert au relief.
// 2) Tuiles à 2 m du Planetary Computer de Microsoft (collections 3dep-lidar-dtm et 3dep-lidar-dsm: sol nu et surface
//    avec toits et cimes), LERC compressé en zstd, 4097 pixels (8 km) en UTM, jeton anonyme d'une journée (comme la
//    carte CCI de api/landcover.js). Servent aux hauteurs des bâtiments, aux empreintes et aux arbres. Attention: une
//    tuile peut couvrir le cadre et rester vide dans une marge (à Sedona, la chapelle tombe dans une bande sans données
//    de la tuile 2-4): la mosaïque ne garde que les pixels valides.
// Hors des États-Unis contigus (inUS), rien n'est interrogé.
import { openCog, readWindow } from './cog.js';

const UA = 'MeteoShoot (www.meteoshoot.com)';
const STAC = 'https://planetarycomputer.microsoft.com/api/stac/v1/search';
const TOKEN = 'https://planetarycomputer.microsoft.com/api/sas/v1/token/usgslidareuwest/usgs-3dep-cogs';
const TNM = 'https://tnmaccess.nationalmap.gov/api/v1/products';
export const inUS = (lat, lng) => lat >= 24 && lat <= 49.6 && lng >= -125 && lng <= -66.5;
// Le cadre des États-Unis contigus recouvre tout le sud du Canada (Québec, Ontario, Prairies): au nord de 41,6° (pointe
// Pelée), le LiDAR de Ressources naturelles Canada est lu d'abord, et l'USGS seulement s'il n'a aucun pixel ici. Le
// catalogue canadien répond aussi près de la frontière (ses tuiles font 500 km: Boston y figure, vide), donc la frontière
// se règle par les pixels lus, pas par le catalogue ni par un tracé approximatif.
export const maybeCanada = (lat, lng) => lat >= 41.6 && lng > -141 && lng < -52;

// Jeton anonyme du Planetary Computer: une seule demande à la fois (six couches partent ensemble au démarrage d'une
// fonction: six demandes simultanées valaient un 429 en production le 4 novembre 2026), et trois essais espacés sur 429.
let token = null, tokenP = null;
export function token3dep() {
  if (token && token.exp - Date.now() > 3600e3) return Promise.resolve(token.t);
  if (tokenP) return tokenP;
  tokenP = (async () => {
    for (let k = 0; ; k++) {
      const r = await fetch(TOKEN, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
      if (r.ok) { const j = await r.json(); token = { t: j.token, exp: Date.parse(j['msft:expiry']) || Date.now() + 3600e3 }; return token.t; }
      if (r.status !== 429 || k >= 3) throw new Error(`jeton 3DEP ${r.status}`);
      await new Promise((res) => setTimeout(res, 700 * (k + 1)));
    }
  })();
  tokenP.catch(() => {}).finally(() => { tokenP = null; });
  return tokenP;
}

// ---------- UTM (NAD83 sur GRS80, assimilé à WGS84: l'écart est centimétrique)
const A = 6378137, F = 1 / 298.257222101, E2 = 2 * F - F * F, K0 = 0.9996;
const rad = (d) => d * Math.PI / 180;
export function toUTM(zone, lat, lng) {
  const p = rad(lat), l = rad(lng) - rad(zone * 6 - 183), ep2 = E2 / (1 - E2);
  const N = A / Math.sqrt(1 - E2 * Math.sin(p) ** 2), T = Math.tan(p) ** 2, C = ep2 * Math.cos(p) ** 2, Aa = Math.cos(p) * l;
  const M = A * ((1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256) * p - (3 * E2 / 8 + 3 * E2 * E2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * p) + (15 * E2 * E2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * p) - (35 * E2 ** 3 / 3072) * Math.sin(6 * p));
  const E = 500000 + K0 * N * (Aa + (1 - T + C) * Aa ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * Aa ** 5 / 120);
  const Nn = K0 * (M + N * Math.tan(p) * (Aa * Aa / 2 + (5 - T + 9 * C + 4 * C * C) * Aa ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * Aa ** 6 / 720));
  return [E, lat < 0 ? Nn + 1e7 : Nn];
}
// Zone UTM d'après le code EPSG de la tuile (NAD83: 269xx; NAD83(2011): 6330 + zone; WGS84 nord: 326xx), sinon null.
function utmZone(projjson) {
  const find = (o) => { if (!o || typeof o !== 'object') return null; if (o.id && o.id.authority === 'EPSG' && o.type === 'ProjectedCRS') return o.id.code; for (const k of Object.keys(o)) { const v = find(o[k]); if (v) return v; } return null; };
  const code = find(projjson); if (!code) return null;
  if (code >= 26901 && code <= 26923) return code - 26900;
  if (code >= 6330 && code <= 6352) return code - 6329;
  if (code >= 32601 && code <= 32660) return code - 32600;
  return null;
}

// ---------- catalogues (mis en mémoire par cadre)
// Les index répondent d'ordinaire en moins d'une seconde mais s'endorment parfois (TNM Access: un délai de 15 s vu le 4
// novembre 2026): 12 s, puis un second essai.
async function fetchAgain(url, init) {
  try { return await fetch(url, { ...init, signal: AbortSignal.timeout(12000) }); }
  catch (e) { return fetch(url, { ...init, signal: AbortSignal.timeout(12000) }); }
}
const cache = new Map();
function cached(key, make) { if (cache.has(key)) return cache.get(key); const p = make(); cache.set(key, p); p.catch(() => cache.delete(key)); return p; }

// Tuiles 2 m du Planetary Computer qui touchent le cadre [lng0, lat0, lng1, lat1]: [{ id, zone, dtm, dsm, date, pip: true, tok: true }],
// du relevé le plus récent au plus ancien.
export function items2m(bbox) {
  return cached('2m:' + bbox.map((v) => v.toFixed(3)).join(','), async () => {
    const r = await fetchAgain(STAC, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify({ collections: ['3dep-lidar-dtm', '3dep-lidar-dsm'], bbox, limit: 200 }) });
    if (!r.ok) throw new Error(`catalogue 3DEP ${r.status}`);
    const j = await r.json(), by = new Map();
    for (const f of j.features || []) {
      const id = f.id.replace(/-(dtm|dsm|hag)-/, '-'), kind = f.collection.endsWith('dtm') ? 'dtm' : 'dsm';
      const href = f.assets && f.assets.data && f.assets.data.href; if (!href) continue;
      const zone = utmZone(f.properties && f.properties['proj:projjson']); if (!zone) continue;
      const date = String((f.properties && f.properties.end_datetime) || '').slice(0, 10);
      const it = by.get(id) || { id, zone, date, bbox: f.bbox, pip: true, tok: true }; it[kind] = href; by.set(id, it);
    }
    return [...by.values()].filter((it) => it.dtm && it.dsm).sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
  });
}

// Tuiles 1 m de l'USGS (sol nu) qui touchent le cadre: [{ id, zone, dtm, date, pip: false }], du relevé le plus récent au plus
// ancien. Tous les relevés sont gardés, pas seulement le plus récent par tuile: un relevé récent ne couvre pas toujours
// toute la tuile (Sedona: NorthCentral 2023 laisse un coin vide que Coconino 2019 remplit), la mosaïque comble les trous
// avec le suivant. Titre de l'index: « USGS 1 Meter 12 x42y386 AZ_NorthCentral_B23 » (zone UTM, colonne et rangée).
export function items1m(bbox) {
  return cached('1m:' + bbox.map((v) => v.toFixed(3)).join(','), async () => {
    const q = `${TNM}?datasets=${encodeURIComponent('Digital Elevation Model (DEM) 1 meter')}&bbox=${bbox.map((v) => v.toFixed(5)).join(',')}&prodFormats=GeoTIFF&max=60`;
    const r = await fetchAgain(q, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!r.ok) throw new Error(`index USGS ${r.status}`);
    const text = await r.text(); let j;
    try { j = JSON.parse(text); } catch (e) { throw new Error(`index USGS: réponse non JSON (${r.headers.get('content-type')}, ${text.slice(0, 80).replace(/\s+/g, ' ')})`); }
    // Service dégradé (vu le 4 novembre 2026: HTTP 200 avec { error: « Expecting value » } pour toute requête): une erreur,
    // pas une absence de tuiles, sinon le relief à 10 m serait mis en cache pour de bon.
    if (j.error || !Array.isArray(j.items)) throw new Error(`index USGS: ${j.error || j.toastMessage || 'réponse sans liste'}`);
    const out = [];
    for (const it of j.items || []) {
      const m = /USGS 1 Meter (\d+) (x\d+y\d+) (\S+)/.exec(it.title || ''); if (!m || !it.downloadURL) continue;
      out.push({ id: `${m[3]} ${m[2]}`, zone: Number(m[1]), dtm: it.downloadURL, date: String(it.publicationDate || it.lastUpdated || '').slice(0, 10), pip: false });
    }
    return out.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
  });
}

// Mosaïque d'une couche (kind: dtm ou dsm) sur le cadre projeté [E0, N0, E1, N1] (UTM de la zone des tuiles), au niveau dont
// la résolution atteint res: fenêtre lue dans chaque tuile qui la touche, premier pixel valide gardé (les tuiles sont
// classées du relevé le plus récent au plus ancien). Même format que window1m (api/heights.js): { data, w, h, x0, y0, res,
// c0: 0, r0: 0, tiles }, ou null sans pixel valide.
// log: erreurs (une tuile illisible); info: avancement (pixels lus par tuile), par défaut le même journal.
export async function windowMosaic(items, kind, E0, N0, E1, N1, res = 1, log = () => {}, info = log) {
  const list = items.filter((it) => it[kind]);
  if (!list.length) return null;
  const tok = list.some((it) => it.tok) ? await token3dep() : null;
  let grid = null;
  for (const it of list) {
    let cog; try { cog = await openCog(it.tok ? `${it[kind]}?${tok}` : it[kind]); } catch (e) { log(`USGS ${it.id}: ${e.message}`); continue; }
    let lv = 0; for (let k = 0; k < cog.levels.length; k++) if (cog.levels[k].res <= res * 1.01) lv = k;
    const L = cog.levels[lv], half = it.pip ? cog.levels[0].res / 2 : 0;
    // Tuiles « pixel = point » (Planetary Computer): le point d'amarrage est le centre du premier pixel, le bord un demi-pixel plus loin.
    const LX0 = L.x0 - half, LY0 = L.y0 + half;
    if (!grid) { // grille de sortie alignée sur le pas de la première tuile
      const r = L.res, x0 = Math.floor(E0 / r) * r, x1 = Math.ceil(E1 / r) * r, y1 = Math.ceil(N1 / r) * r, y0 = Math.floor(N0 / r) * r;
      const w = Math.round((x1 - x0) / r), h = Math.round((y1 - y0) / r);
      if (w < 2 || h < 2) return null;
      grid = { data: new Float32Array(w * h).fill(NaN), w, h, x0, y0: y1, res: r, c0: 0, r0: 0, tiles: 0, missing: w * h };
    } else if (Math.abs(L.res - grid.res) > 1e-6) continue; // autre pas (aperçus d'un autre relevé): on ne mélange pas
    if (!grid.missing) break;
    const r = grid.res;
    const c0 = Math.max(0, Math.floor((grid.x0 - LX0) / r)), c1 = Math.min(L.width, Math.ceil((grid.x0 + grid.w * r - LX0) / r));
    const r0 = Math.max(0, Math.floor((LY0 - grid.y0) / r)), r1 = Math.min(L.height, Math.ceil((LY0 - (grid.y0 - grid.h * r)) / r));
    if (c1 - c0 < 1 || r1 - r0 < 1) continue;
    let win; try { win = await readWindow(cog, lv, c0, r0, c1, r1); } catch (e) { log(`USGS ${it.id}: ${e.message}`); continue; }
    grid.tiles += win.tiles;
    const dx = Math.round((LX0 + c0 * r - grid.x0) / r), dy = Math.round((grid.y0 - (LY0 - r0 * r)) / r);
    let filled = 0;
    for (let j = 0; j < win.h; j++) { const gj = j + dy; if (gj < 0 || gj >= grid.h) continue; for (let i = 0; i < win.w; i++) { const gi = i + dx; if (gi < 0 || gi >= grid.w) continue; const v = win.data[j * win.w + i]; const k = gj * grid.w + gi; if (v === v && grid.data[k] !== grid.data[k]) { grid.data[k] = v; filled++; } } }
    grid.missing -= filled;
    info(`USGS ${it.id} ${kind} ${r} m: ${filled} pixels (${win.tiles} tuiles)`);
  }
  if (!grid || grid.missing === grid.w * grid.h) return null;
  return grid;
}

// Source LiDAR américaine autour d'un lieu (cadre en degrés): { zone, proj, list1m, list2m, date, failed } ou null hors
// couverture. Les deux index sont interrogés ensemble; une erreur de l'un n'empêche pas l'autre (signalée dans log et failed).
export async function source3dep(lat, lng, bbox, log = () => {}) {
  if (!inUS(lat, lng)) return null;
  const [a, b] = await Promise.allSettled([items1m(bbox), items2m(bbox)]);
  if (a.status === 'rejected') log(`index USGS 1 m: ${a.reason && a.reason.message}`);
  if (b.status === 'rejected') log(`catalogue 3DEP 2 m: ${b.reason && b.reason.message}`);
  const l1 = a.status === 'fulfilled' ? a.value : [], l2 = b.status === 'fulfilled' ? b.value : [];
  if (!l1.length && !l2.length) { log('USGS: pas de LiDAR ici'); return null; }
  const zone = (l1[0] || l2[0]).zone;
  const list1m = l1.filter((it) => it.zone === zone), list2m = l2.filter((it) => it.zone === zone);
  return { zone, proj: (la, ln) => toUTM(zone, la, ln), list1m, list2m, date: (list1m[0] || list2m[0]).date, failed: a.status === 'rejected' || b.status === 'rejected' };
}

if (process.argv[1] && process.argv[1].endsWith('lidar3dep.js')) {
  const lat = parseFloat(process.argv[2] || '34.8320'), lng = parseFloat(process.argv[3] || '-111.7668');
  const mLat = 111320, mLng = 111320 * Math.cos(lat * Math.PI / 180), R = 360;
  const bbox = [lng - R / mLng, lat - R / mLat, lng + R / mLng, lat + R / mLat];
  source3dep(lat, lng, bbox, console.log).then(async (src) => {
    if (!src) { console.log('aucune source USGS'); return; }
    console.log('zone UTM', src.zone, '1 m:', src.list1m.map((it) => `${it.id} (${it.date})`), '2 m:', src.list2m.map((it) => `${it.id} (${it.date})`));
    const [E, N] = src.proj(lat, lng); console.log('UTM', E.toFixed(1), N.toFixed(1));
    const stat = (g) => { if (!g) return null; let mn = Infinity, mx = -Infinity, n = 0; for (const v of g.data) { if (v !== v) continue; n++; mn = Math.min(mn, v); mx = Math.max(mx, v); } return { w: g.w, h: g.h, res: g.res, valid: n, min: Math.round(mn * 10) / 10, max: Math.round(mx * 10) / 10, tiles: g.tiles }; };
    let t0 = Date.now();
    const d1 = await windowMosaic(src.list1m, 'dtm', E - R, N - R, E + R, N + R, 1, console.log); console.log('1 m', stat(d1), 'ms', Date.now() - t0);
    t0 = Date.now();
    const [dtm, dsm] = await Promise.all([windowMosaic(src.list2m, 'dtm', E - R, N - R, E + R, N + R, 2, console.log), windowMosaic(src.list2m, 'dsm', E - R, N - R, E + R, N + R, 2, console.log)]);
    console.log('2 m dtm', stat(dtm), 'dsm', stat(dsm), 'ms', Date.now() - t0);
    if (dtm && dsm) { let above = 0; for (let i = 0; i < dtm.data.length; i++) if (dsm.data[i] - dtm.data[i] > 3) above++; console.log('pixels à plus de 3 m au-dessus du sol (arbres, bâtiments):', above, 'sur', dtm.data.length); }
  }).catch((e) => { console.error(e); process.exit(1); });
}
