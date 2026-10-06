// Fonction serveur (Vercel): le relief autour d'un lieu pour la vue 3D de la fiche projet.
// Sources gratuites, de la plus fine à la plus grossière, fondues l'une dans l'autre:
//   - LiDAR de Ressources naturelles Canada (modèle numérique de terrain haute résolution, mosaïques à 1 m et 2 m,
//     GeoTIFF optimisés pour le nuage sur S3, lus par tuiles avec api/cog.js): 2 m jusqu'à 640 m du lieu, 4 m jusqu'à
//     1,3 km, 32 m jusqu'à 6 km;
//   - modèle numérique d'élévation du Canada (20 m) par les tuiles Terrain Tiles d'AWS (format terrarium): 13 m par
//     pixel jusqu'à 5 km, 100 m par pixel jusqu'à 20 km, et partout où le LiDAR manque.
// Résultat: une grille non uniforme (même axe en x et en n: 2 m au centre, pas croissant de 12 % jusqu'à 500 m,
// 20 km de rayon), hauteurs en décimètres au-dessus du point le plus bas, encodées en base64 (Int16). Le client
// (src/scene3d/terrain.js) la garde dans le cache partagé Supabase, donc chaque lieu n'est calculé qu'une fois.
//
// GET /api/terrain?lat=46.1374&lng=-70.6695  ->  { v, origin, ax, hMin, h, src, ms }
// Essai local: node api/terrain.js --test 46.1374 -70.6695 [--png relief.png]

import { PNG } from 'pngjs';
import { openCog, readWindow } from './cog.js';

export const maxDuration = 60;
export const TERRAIN_V = 1;
const UA = 'MeteoShoot (www.meteoshoot.com)';

// ---------- grille locale: positions des noeuds le long d'un axe (mètres), symétrique autour de 0
export const FINE = 2, FINE_HALF = 256, GROW = 1.12, STEP_MAX = 500, EXTENT = 20000;
export function buildAxis() {
  const pos = []; let v = 0, s = FINE;
  while (v < FINE_HALF - 1e-9) { v += FINE; pos.push(v); }
  while (v < EXTENT - 1e-9) { s = Math.min(STEP_MAX, s * GROW); v = v + s * 1.5 >= EXTENT ? EXTENT : v + s; pos.push(Math.round(v * 100) / 100); }
  return [...pos.map(p => -p).reverse(), 0, ...pos];
}

// ---------- projection Lambert conique conforme du Canada (EPSG:3979, NAD83(CSRS) / Canada Atlas Lambert)
const A = 6378137, FL = 1 / 298.257222101, E2 = 2 * FL - FL * FL, EC = Math.sqrt(E2);
const rad = (d) => d * Math.PI / 180;
const mOf = (p) => Math.cos(p) / Math.sqrt(1 - E2 * Math.sin(p) ** 2);
const tOf = (p) => Math.tan(Math.PI / 4 - p / 2) / Math.pow((1 - EC * Math.sin(p)) / (1 + EC * Math.sin(p)), EC / 2);
const P1 = rad(49), P2 = rad(77), P0 = rad(49), L0 = rad(-95);
const NN = (Math.log(mOf(P1)) - Math.log(mOf(P2))) / (Math.log(tOf(P1)) - Math.log(tOf(P2)));
const FF = mOf(P1) / (NN * Math.pow(tOf(P1), NN));
const RHO0 = A * FF * Math.pow(tOf(P0), NN);
export function toLCC(lat, lng) {
  const rho = A * FF * Math.pow(tOf(rad(lat)), NN), th = NN * (rad(lng) - L0);
  return [rho * Math.sin(th), RHO0 - rho * Math.cos(th)];
}

// ---------- couches: un raster { data, W, H, half, toPx(lat, lng) } et sa marge de validité
const FEATHER_PX = 4;
function finishLayer(layer) {
  // Distance (en pixels, bornée) à la donnée manquante la plus proche: le LiDAR se fond dans la couche du dessous
  // à ses limites de couverture au lieu d'y faire une marche.
  const { data, W, H } = layer, K = FEATHER_PX, dist = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) dist[i] = data[i] === data[i] ? K : 0;
  for (let y = 0; y < H; y++) { const r = y * W; for (let x = 1; x < W; x++) dist[r + x] = Math.min(dist[r + x], dist[r + x - 1] + 1); for (let x = W - 2; x >= 0; x--) dist[r + x] = Math.min(dist[r + x], dist[r + x + 1] + 1); }
  for (let x = 0; x < W; x++) { for (let y = 1; y < H; y++) dist[y * W + x] = Math.min(dist[y * W + x], dist[(y - 1) * W + x] + 1); for (let y = H - 2; y >= 0; y--) dist[y * W + x] = Math.min(dist[y * W + x], dist[(y + 1) * W + x] + 1); }
  layer.dist = dist;
  return layer;
}
// Échantillon bilinéaire (NaN si un des 4 pixels manque ou hors raster) et poids de validité (0..1).
export function sample(layer, lat, lng) {
  const [px, py] = layer.toPx(lat, lng); const x0 = Math.floor(px), y0 = Math.floor(py);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= layer.W || y0 + 1 >= layer.H) return [NaN, 0];
  const fx = px - x0, fy = py - y0, d = layer.data, i = y0 * layer.W + x0, W = layer.W;
  const a = d[i], b = d[i + 1], c = d[i + W], e = d[i + W + 1];
  if (a !== a || b !== b || c !== c || e !== e) return [NaN, 0];
  const v = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
  const ds = layer.dist, w = Math.min(ds[i], ds[i + 1], ds[i + W], ds[i + W + 1]) / FEATHER_PX;
  return [v, w];
}

// Terrain Tiles (AWS, terrarium): hauteur = (R * 256 + G + B / 256) - 32768.
const TERR = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const merc = (lat, lng, z) => { const n = 2 ** z, la = rad(lat); return [(lng + 180) / 360 * n, (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n]; };
export async function terrariumLayer(lat, lng, z, half, mLat, mLng, log) {
  const dLat = half / mLat, dLng = half / mLng;
  const [xa, ya] = merc(lat + dLat, lng - dLng, z), [xb, yb] = merc(lat - dLat, lng + dLng, z);
  const tx0 = Math.floor(xa), tx1 = Math.floor(xb), ty0 = Math.floor(ya), ty1 = Math.floor(yb);
  const W = (tx1 - tx0 + 1) * 256, H = (ty1 - ty0 + 1) * 256, data = new Float32Array(W * H).fill(NaN);
  const jobs = []; for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty]);
  let ok = 0;
  await Promise.all(jobs.map(async ([tx, ty]) => {
    try {
      const r = await fetch(`${TERR}/${z}/${tx}/${ty}.png`, { headers: { 'User-Agent': UA } }); if (!r.ok) return;
      const png = PNG.sync.read(Buffer.from(await r.arrayBuffer())); const p = png.data, ox = (tx - tx0) * 256, oy = (ty - ty0) * 256;
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) { const k = (y * 256 + x) * 4; data[(oy + y) * W + ox + x] = p[k] * 256 + p[k + 1] + p[k + 2] / 256 - 32768; }
      ok++;
    } catch (e) { log(`terrarium ${z}/${tx}/${ty}: ${e.message}`); }
  }));
  if (!ok) return null;
  return finishLayer({ name: `cdem z${z}`, data, W, H, half, tiles: jobs.length, toPx: (la, ln) => { const [x, y] = merc(la, ln, z); return [(x - tx0) * 256 - 0.5, (y - ty0) * 256 - 0.5]; } });
}

// LiDAR de Ressources naturelles Canada: mosaïques connues par le catalogue STAC, lues au niveau d'aperçu demandé.
const STAC = 'https://datacube.services.geo.ca/stac/api/collections';
const stacCache = new Map();
function hrdemUrls(coll, bbox) {
  const key = coll + bbox; if (stacCache.has(key)) return stacCache.get(key);
  const p = fetch(`${STAC}/${coll}/items?bbox=${bbox}&limit=10`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) })
    .then(r => (r.ok ? r.json() : { features: [] })).then(j => (j.features || []).map(f => f.assets && f.assets.dtm && f.assets.dtm.href).filter(Boolean));
  stacCache.set(key, p); p.catch(() => stacCache.delete(key)); return p;
}
// urls: mosaïques par ordre de préférence (1 m avant 2 m); on s'arrête dès qu'une couvre toute la fenêtre.
export async function hrdemLayers(urls, res, lat, lng, half, mLat, mLng, log) {
  const out = [];
  const corners = [[-half, -half], [half, -half], [half, half], [-half, half]].map(([x, n]) => toLCC(lat + n / mLat, lng + x / mLng));
  const E0 = Math.min(...corners.map(c => c[0])), E1 = Math.max(...corners.map(c => c[0])), N0 = Math.min(...corners.map(c => c[1])), N1 = Math.max(...corners.map(c => c[1]));
  for (const url of urls) {
    try {
      const cog = await openCog(url);
      // Niveau le plus fin dont la résolution atteint celle demandée (les aperçus sont des moyennes du 1 m).
      let lv = 0; for (let k = 0; k < cog.levels.length; k++) if (cog.levels[k].res <= res * 1.01) lv = k;
      const L = cog.levels[lv];
      const c0 = Math.max(0, Math.floor((E0 - L.x0) / L.res) - 1), c1 = Math.min(L.width, Math.ceil((E1 - L.x0) / L.res) + 1);
      const r0 = Math.max(0, Math.floor((L.y0 - N1) / L.res) - 1), r1 = Math.min(L.height, Math.ceil((L.y0 - N0) / L.res) + 1);
      if (c1 - c0 < 2 || r1 - r0 < 2) continue;
      const win = await readWindow(cog, lv, c0, r0, c1, r1);
      let valid = 0; for (let i = 0; i < win.data.length; i++) if (win.data[i] === win.data[i]) valid++;
      if (!valid) continue;
      out.push(finishLayer({ name: `lidar ${L.res} m`, data: win.data, W: win.w, H: win.h, half, tiles: win.tiles, res: L.res, toPx: (la, ln) => { const [E, N] = toLCC(la, ln); return [(E - L.x0) / L.res - c0 - 0.5, (L.y0 - N) / L.res - r0 - 0.5]; } }));
      if (valid === win.data.length) break;
    } catch (e) { log(`lidar ${res} m ${url.slice(-30)}: ${e.message}`); }
  }
  return out.reverse(); // la préférée en dernier: elle recouvre les autres
}

// ---------- construction
export async function buildTerrain(lat, lng, log = () => {}) {
  const t0 = Date.now();
  const mLat = 111320, mLng = 111320 * Math.cos(rad(lat));
  const ax = buildAxis(), N = ax.length;
  const bbox = (half) => [lng - half / mLng, lat - half / mLat, lng + half / mLng, lat + half / mLat].map(v => v.toFixed(4)).join(',');
  const [urls1, urls2] = await Promise.all([hrdemUrls('hrdem-mosaic-1m', bbox(6500)).catch(() => []), hrdemUrls('hrdem-mosaic-2m', bbox(6500)).catch(() => [])]);
  const lidarUrls = [...urls1, ...urls2.filter(u => !urls1.includes(u))];
  // Couches de la plus grossière à la plus fine; chacune recouvre la précédente là où elle a des données, avec un
  // fondu sur ses bords (15 % du demi-côté) et à ses trous.
  const [t10, t13, l32, l4, l2] = await Promise.all([
    terrariumLayer(lat, lng, 10, EXTENT * 1.03, mLat, mLng, log),
    terrariumLayer(lat, lng, 13, 5000, mLat, mLng, log),
    hrdemLayers(lidarUrls, 32, lat, lng, 6000, mLat, mLng, log),
    hrdemLayers(lidarUrls, 4, lat, lng, 1300, mLat, mLng, log),
    hrdemLayers(lidarUrls, 2, lat, lng, 640, mLat, mLng, log),
  ]);
  const layers = [t10, t13, ...l32, ...l4, ...l2].filter(Boolean);
  if (!layers.length) throw new Error('aucune source de relief');
  const tFetch = Date.now() - t0;
  const h = new Float32Array(N * N).fill(NaN);
  let fineN = 0, fineLidar = 0, lidarRes = null;
  for (let j = 0; j < N; j++) {
    const n = ax[j], la = lat + n / mLat;
    for (let i = 0; i < N; i++) {
      const x = ax[i], ln = lng + x / mLng, k = j * N + i, r = Math.max(Math.abs(x), Math.abs(n));
      let v = NaN, fromLidar = null;
      for (const L of layers) {
        if (r > L.half) continue;
        const [s, wv] = sample(L, la, ln); if (s !== s) continue;
        const we = Math.min(1, (L.half - r) / (0.15 * L.half)), w = Math.min(we, wv);
        if (v !== v) { v = s; if (L.res && w >= 0.999) fromLidar = L.res; continue; }
        v += w * (s - v); if (L.res && w >= 0.999) fromLidar = L.res;
      }
      h[k] = v;
      if (r <= FINE_HALF) { fineN++; if (fromLidar) { fineLidar++; if (!lidarRes || fromLidar < lidarRes) lidarRes = fromLidar; } }
    }
  }
  // Trous résiduels (hors de toute source): moyenne des voisins, sinon 0.
  for (let pass = 0; pass < 3; pass++) {
    let holes = 0;
    for (let k = 0; k < N * N; k++) if (h[k] !== h[k]) { let s = 0, c = 0; const i = k % N, j = (k - i) / N; [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]].forEach(([a, b]) => { if (a >= 0 && b >= 0 && a < N && b < N && h[b * N + a] === h[b * N + a]) { s += h[b * N + a]; c++; } }); if (c) h[k] = s / c; else holes++; }
    if (!holes) break;
  }
  let hMin = Infinity, hMax = -Infinity; for (let k = 0; k < N * N; k++) { if (h[k] !== h[k]) h[k] = 0; if (h[k] < hMin) hMin = h[k]; if (h[k] > hMax) hMax = h[k]; }
  hMin = Math.floor(hMin * 10) / 10;
  const q = new Int16Array(N * N); for (let k = 0; k < N * N; k++) q[k] = Math.max(0, Math.min(32767, Math.round((h[k] - hMin) * 10)));
  const b64 = Buffer.from(q.buffer).toString('base64');
  const src = { lidar: fineN ? Math.round(fineLidar / fineN * 100) / 100 : 0, lidarRes, cdem: !!(t10 || t13), layers: layers.map(L => `${L.name} (${L.tiles} tuiles)`) };
  return { v: TERRAIN_V, origin: [lat, lng], ax, hMin, hMax: Math.round(hMax * 10) / 10, h: b64, src, ms: { fetch: tFetch, total: Date.now() - t0 } };
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const lat = parseFloat(url.searchParams.get('lat')), lng = parseFloat(url.searchParams.get('lng'));
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!(lat >= -85 && lat <= 85 && lng >= -180 && lng <= 180)) {
    res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'lat/lng invalides' })); return;
  }
  try {
    const t = await buildTerrain(lat, lng, (m) => console.log('[terrain]', m));
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=2592000');
    res.end(JSON.stringify(t));
  } catch (e) {
    console.error('[terrain]', e);
    res.statusCode = 502; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: String(e && e.message || e) }));
  }
}

if (process.argv.includes('--test')) {
  const i = process.argv.indexOf('--test');
  const lat = parseFloat(process.argv[i + 1] || '46.8367'), lng = parseFloat(process.argv[i + 2] || '-71.2336');
  buildTerrain(lat, lng, (m) => console.log('  ', m)).then((t) => {
    const j = JSON.stringify(t);
    console.log({ nodes: t.ax.length, hMin: t.hMin, hMax: t.hMax, src: t.src, bytes: j.length, ms: t.ms });
    if (process.argv.includes('--png')) {
      // Ombrage du relief (±1 300 m, 5 m par pixel) pour vérifier à l'oeil: lumière du nord-ouest.
      const N = t.ax.length, ax = t.ax, q = new Int16Array(Buffer.from(t.h, 'base64').buffer, 0, N * N);
      const H = (x, n) => { const idx = (v) => { let lo = 0, hi = N - 2; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ax[m] <= v) lo = m; else hi = m - 1; } return lo; }; const i = idx(x), j = idx(n), u = (x - ax[i]) / (ax[i + 1] - ax[i]), v = (n - ax[j]) / (ax[j + 1] - ax[j]); const g = (a, b) => q[b * N + a] / 10; return (g(i, j) * (1 - u) + g(i + 1, j) * u) * (1 - v) + (g(i, j + 1) * (1 - u) + g(i + 1, j + 1) * u) * v; };
      const S = 521, step = 5, png = new PNG({ width: S, height: S });
      for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
        const x = (px - S / 2) * step, n = (S / 2 - py) * step; const dx = (H(x + step, n) - H(x - step, n)) / (2 * step), dn = (H(x, n + step) - H(x, n - step)) / (2 * step);
        const nx = -dx, ny = -dn, nz = 1, l = Math.hypot(nx, ny, nz); const sh = Math.max(0, (nx * -0.5 + ny * 0.5 + nz * 0.7071) / l); const v = Math.round(40 + 200 * sh);
        const k = (py * S + px) * 4; png.data[k] = v; png.data[k + 1] = v; png.data[k + 2] = v; png.data[k + 3] = 255;
        if (Math.abs(x) <= 2 && Math.abs(n) <= 2) { png.data[k] = 255; png.data[k + 1] = 40; png.data[k + 2] = 40; }
      }
      const f = process.argv[process.argv.indexOf('--png') + 1]; import('fs').then(fs => fs.writeFileSync(f, PNG.sync.write(png))); console.log('ombrage:', f);
    }
  }).catch((e) => { console.error(e); process.exit(1); });
}
