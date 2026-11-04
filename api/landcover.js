// Couverture du sol autour d'un lieu (4 novembre 2026), pour la vue 3D hors du Québec: à Sedona (Arizona), l'app
// dessinait une forêt de feuillus en couleurs d'automne sur de l'herbe verte, là où il n'y a que des genévriers, des pins
// pignons et de la roche rouge. Deux cartes mondiales, lues par plages d'octets comme le LiDAR (api/cog.js):
// 1) ESA WorldCover 2021 (10 m, Sentinel-1 et 2, licence CC BY 4.0): ce qu'il y a au sol, pixel par pixel: arbres (10),
//    arbustes (20), herbe (30), cultures (40), bâti (50), sol nu ou végétation clairsemée (60), neige (70), eau (80),
//    milieu humide (90), mangrove (95), mousses (100). Tuiles de 3° x 3° sur S3 (seau public esa-worldcover).
// 2) ESA CCI Land Cover 2020 (300 m, licence libre, servie par Microsoft Planetary Computer avec un jeton anonyme):
//    le type de feuillage des arbres de la région: feuillus persistants (50), feuillus caducs (60 à 62), conifères
//    persistants (70 à 72), conifères caducs (80 à 82, mélèzes), mixte (90), arbustes persistants (121) ou caducs (122).
//    Trop grossière pour placer un arbre, assez fine pour dire si les arbres du coin perdent leurs feuilles.
// Sortie: { near: parts dans 350 m, far: parts dans 1,5 km (relief lointain), leaf: { ne, be, nd, bd } parts des arbres de
// la région (conifères et feuillus, persistants et caducs, voir leafType), grid: classes WorldCover en grille de 10 m sur
// ±R_GRID m (arbres semés hors LiDAR), src }.
// Essai local: node api/landcover.js 34.87 -111.76
import { openCog, readWindow } from './cog.js';

const UA = 'MeteoShoot (www.meteoshoot.com)';
export const R_GRID = 500; // m: grille WorldCover gardée dans la scène
const R_NEAR = 350, R_FAR = 1500;
const WC = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map';
const CCI_TOKEN = 'https://planetarycomputer.microsoft.com/api/sas/v1/token/landcoverdata/esa-cci-lc';
const CCI = 'https://landcoverdata.blob.core.windows.net/esa-cci-lc/cog/v2.1.1';

const pad = (v, n) => String(Math.abs(v)).padStart(n, '0');
// Tuile WorldCover: 3° x 3°, nommée par son coin sud-ouest (N33W114 couvre 33 à 36° N, 114 à 111° W).
function wcTile(lat, lng) {
  const la = Math.floor(lat / 3) * 3, lo = Math.floor(lng / 3) * 3;
  return `${WC}/ESA_WorldCover_10m_2021_v200_${la >= 0 ? 'N' : 'S'}${pad(la, 2)}${lo >= 0 ? 'E' : 'W'}${pad(lo, 3)}_Map.tif`;
}
// Tuile CCI: 45° x 45°, nommée par son coin sud-ouest (N00W135: 0 à 45° N, 135 à 90° W).
function cciTile(lat, lng) {
  const la = Math.floor(lat / 45) * 45, lo = Math.floor(lng / 45) * 45;
  const name = `${la >= 0 ? 'N' : 'S'}${pad(la, 2)}${lo >= 0 ? 'E' : 'W'}${pad(lo, 3)}`;
  return `${CCI}/${name}/2020/C3S-LC-L4-LCCS-Map-300m-P1Y-2020-v2.1.1-${name}-lccs_class.tif`;
}
// Jeton de lecture anonyme du Planetary Computer (valable environ une journée, renouvelé une heure avant sa fin).
let token = null, tokenP = null;
function cciToken() { // une demande à la fois, trois essais sur 429 (voir token3dep dans api/lidar3dep.js)
  if (token && token.exp - Date.now() > 3600e3) return Promise.resolve(token.t);
  if (tokenP) return tokenP;
  tokenP = (async () => {
    for (let k = 0; ; k++) {
      const r = await fetch(CCI_TOKEN, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
      if (r.ok) { const j = await r.json(); token = { t: j.token, exp: Date.parse(j['msft:expiry']) || Date.now() + 3600e3 }; return token.t; }
      if (r.status !== 429 || k >= 3) throw new Error(`jeton CCI ${r.status}`);
      await new Promise((res) => setTimeout(res, 700 * (k + 1)));
    }
  })();
  tokenP.catch(() => {}).finally(() => { tokenP = null; });
  return tokenP;
}

// Fenêtre de classes d'une carte en degrés (WGS84, pixels carrés en degrés): grille autour de (lat, lng) sur ±half m.
async function classWindow(url, lat, lng, half, lv = 0) {
  const cog = await openCog(url), L = cog.levels[lv];
  const mLat = 111320, mLng = 111320 * Math.cos(lat * Math.PI / 180);
  const dLat = half / mLat, dLng = half / mLng;
  const c0 = Math.max(0, Math.floor((lng - dLng - L.x0) / L.res)), c1 = Math.min(L.width, Math.ceil((lng + dLng - L.x0) / L.res));
  const r0 = Math.max(0, Math.floor((L.y0 - lat - dLat) / L.res)), r1 = Math.min(L.height, Math.ceil((L.y0 - lat + dLat) / L.res));
  if (c1 - c0 < 1 || r1 - r0 < 1) throw new Error('fenêtre hors de la tuile');
  const win = await readWindow(cog, lv, c0, r0, c1, r1, 6);
  // Position en mètres (x est, n nord) du centre de chaque pixel.
  const xOf = (c) => (L.x0 + (c0 + c + 0.5) * L.res - lng) * mLng, nOf = (r) => (L.y0 - (r0 + r + 0.5) * L.res - lat) * mLat;
  return { ...win, res: L.res, xOf, nOf, mPx: L.res * mLat };
}

const WC_CLASS = { 10: 'tree', 20: 'shrub', 30: 'grass', 40: 'crop', 50: 'built', 60: 'bare', 70: 'snow', 80: 'water', 90: 'wet', 95: 'tree', 100: 'moss' };
function shares(win, R) {
  const n = {}; let tot = 0;
  for (let r = 0; r < win.h; r++) for (let c = 0; c < win.w; c++) {
    if (Math.hypot(win.xOf(c), win.nOf(r)) > R) continue;
    const v = win.data[r * win.w + c]; if (v !== v) continue;
    const k = WC_CLASS[v] || 'other'; n[k] = (n[k] || 0) + 1; tot++;
  }
  const out = {}; for (const k in n) out[k] = Math.round(n[k] / tot * 1000) / 1000;
  return { n: tot, ...out };
}

// Type de feuillage des arbres de la région (CCI 300 m) dans 15 km (en deçà, trop peu de pixels arborés et les parcs
// d'une ville pèsent trop: à Toronto, 5 km donnaient 56 % de persistants, 15 km en donnent 19 %, ce qui est juste).
// Parts, parmi les pixels arborés: ne conifères persistants (70 à 72), be feuillus persistants (50, arbustes 121),
// nd conifères caducs (80 à 82, mélèzes), bd feuillus caducs (60 à 62, arbustes 122); la forêt mixte (90) compte pour
// moitié conifères persistants, moitié feuillus caducs. Les mosaïques (100, 110) ne disent rien du feuillage: ignorées.
// Sans pixel arboré à 15 km (désert): null.
const NE = new Set([70, 71, 72]), BE = new Set([50, 121]), ND = new Set([80, 81, 82]), BD = new Set([60, 61, 62, 122]);
async function leafType(lat, lng, log) {
  const url = cciTile(lat, lng) + '?' + await cciToken();
  const win = await classWindow(url, lat, lng, 15000);
  let ne = 0, be = 0, nd = 0, bd = 0;
  for (let i = 0; i < win.data.length; i++) {
    const v = win.data[i]; if (v !== v) continue;
    if (NE.has(v)) ne++; else if (BE.has(v)) be++; else if (ND.has(v)) nd++; else if (BD.has(v)) bd++; else if (v === 90) { ne += 0.5; bd += 0.5; }
  }
  const n = ne + be + nd + bd;
  if (n < 1) { log('feuillage CCI: aucun arbre à 15 km'); return null; }
  const r = (v) => Math.round(v / n * 100) / 100;
  const out = { ne: r(ne), be: r(be), nd: r(nd), bd: r(bd), n: Math.round(n) };
  log(`feuillage CCI à 15 km: ${Math.round((ne + be) / n * 100)} % persistants (${Math.round(ne / n * 100)} % conifères, ${Math.round(be / n * 100)} % feuillus), ${Math.round(nd / n * 100)} % mélèzes, ${Math.round(bd / n * 100)} % feuillus caducs (${out.n} pixels arborés)`);
  return out;
}

export async function readLandCover(lat, lng, log = () => {}) {
  const t0 = Date.now();
  const [wc, leaf] = await Promise.all([
    classWindow(wcTile(lat, lng), lat, lng, R_FAR).catch((e) => { log(`WorldCover: ${e.message}`); return null; }),
    leafType(lat, lng, log).catch((e) => { log(`feuillage CCI: ${e.message}`); return null; }),
  ]);
  if (!wc && !leaf) return null;
  const out = { v: 1, src: [] };
  if (wc) {
    out.near = shares(wc, R_NEAR); out.far = shares(wc, R_FAR);
    // Grille de 10 m sur ±R_GRID: classes WorldCover (octet), lignes du nord au sud, colonnes d'ouest en est, en base 64.
    const N = Math.round(2 * R_GRID / wc.mPx), g = new Uint8Array(N * N), pxX = wc.xOf(1) - wc.xOf(0);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -R_GRID + (i + 0.5) * wc.mPx, n = R_GRID - (j + 0.5) * wc.mPx;
      const c = Math.floor((x - (wc.xOf(0) - pxX / 2)) / pxX), r = Math.floor((wc.nOf(0) + wc.mPx / 2 - n) / wc.mPx);
      const v = (c >= 0 && r >= 0 && c < wc.w && r < wc.h) ? wc.data[r * wc.w + c] : NaN;
      g[j * N + i] = v === v ? v : 0;
    }
    out.grid = { n: N, res: Math.round(wc.mPx * 100) / 100, half: R_GRID, d: Buffer.from(g).toString('base64') };
    out.src.push('ESA WorldCover 2021');
    log(`WorldCover ${wc.w}x${wc.h} px: ${Object.entries(out.near).filter(([k]) => k !== 'n').map(([k, v]) => `${k} ${Math.round(v * 100)} %`).join(', ')} dans 350 m`);
  }
  if (leaf) { out.leaf = leaf; out.src.push('ESA CCI Land Cover 2020'); }
  out.ms = Date.now() - t0;
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('landcover.js')) {
  const lat = parseFloat(process.argv[2] || '46.8367'), lng = parseFloat(process.argv[3] || '-71.2336');
  readLandCover(lat, lng, (m) => console.log('  ' + m)).then((r) => { if (r) { const { grid, ...rest } = r; console.log(JSON.stringify(rest), grid && `grille ${grid.n}x${grid.n}`); } else console.log('aucune donnée'); }).catch((e) => { console.error(e); process.exit(1); });
}
