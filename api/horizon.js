// Fonction serveur (Vercel): profil d'horizon du relief réel autour d'un lieu (jusqu'à 20 km, courbure comprise depuis la v633.194), pour la barre « ombre du terrain » de la
// bande horaire de la fiche projet. Même relief que la vue 3D (buildTerrain de api/terrain.js: LiDAR de Ressources
// naturelles Canada, sinon modèle numérique d'élévation) et même calcul (src/scene3d/horizon.js), donc la barre de la
// fiche et celle de la 3D sont les mêmes, que la 3D ait été ouverte ou non. Avant (jusqu'à la v633.185), la fiche
// tirait son profil d'open-elevation (relevé grossier: 29 à 35° vers l'est à Stoneham contre 14 à 20° au LiDAR, d'où
// une « ombre du terrain » jusqu'à midi en octobre), corrigé seulement à l'ouverture de la 3D. Le client garde le
// résultat dans le cache partagé Supabase (scene3d_cache, clé « hor_ »), donc chaque lieu n'est calculé qu'une fois.
//
// GET /api/horizon?lat=46.1374&lng=-70.6695  ->  { v, origin, profile: [{ bearing, maxAngle }], eye, src, ms }
// Essai local: node api/horizon.js --test 46.1374 -70.6695

import { buildTerrain } from './terrain.js';
import { HORIZON_V, horizonProfile, gridSampler, farSampler, farHeights, combinedSampler } from '../src/scene3d/horizon.js';

export const maxDuration = 60;

export async function buildHorizon(lat, lng, log = () => {}) {
  const t0 = Date.now();
  const t = await buildTerrain(lat, lng, log);
  // Même grille que celle que la 3D reçoit (hauteurs quantifiées au décimètre): profil identique au sien.
  const N = t.ax.length, b = Buffer.from(t.h, 'base64'), q = new Int16Array(b.buffer, b.byteOffset, N * N);
  const H = new Float32Array(N * N); for (let k = 0; k < N * N; k++) H[k] = t.hMin + q[k] / 10;
  // Relief lointain polaire (v633.194) au-delà de 1 km, comme le client.
  const farFn = t.far ? farSampler(t.far, farHeights(t.far, (b64, n) => { const bb = Buffer.from(b64, 'base64'); return new Int16Array(bb.buffer, bb.byteOffset, n); })) : null;
  const hTri = combinedSampler(gridSampler(t.ax, H), farFn, t.far ? t.far.r0 : 0);
  return { v: HORIZON_V, origin: [lat, lng], profile: horizonProfile(hTri), eye: Math.round((hTri(0, 0) + 1.6) * 10) / 10, src: t.src, ms: { terrain: t.ms.total, total: Date.now() - t0 } };
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const lat = parseFloat(url.searchParams.get('lat')), lng = parseFloat(url.searchParams.get('lng'));
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!(lat >= -85 && lat <= 85 && lng >= -180 && lng <= 180)) {
    res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'lat/lng invalides' })); return;
  }
  try {
    const h = await buildHorizon(lat, lng, (m) => console.log('[horizon]', m));
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', h.src && h.src.partial ? 'public, max-age=300' : 'public, max-age=86400, s-maxage=2592000'); // relief incomplet: pas de cache durable
    res.end(JSON.stringify(h));
  } catch (e) {
    console.error('[horizon]', e);
    res.statusCode = 502; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: String(e && e.message || e) }));
  }
}

if (process.argv.includes('--test')) {
  const i = process.argv.indexOf('--test');
  const lat = parseFloat(process.argv[i + 1] || '46.8367'), lng = parseFloat(process.argv[i + 2] || '-71.2336');
  buildHorizon(lat, lng, (m) => console.log('  ', m)).then((h) => {
    console.log({ eye: h.eye, src: h.src, ms: h.ms });
    console.log(h.profile.map(p => `${String(p.bearing).padStart(3)}° ${p.maxAngle.toFixed(2)}`).join('\n'));
  }).catch((e) => { console.error(e); process.exit(1); });
}
