// Image satellite de Plans d'Apple autour d'un lieu (service d'images statiques d'Apple, « Snapshots »), pour le calque
// temporaire de la vue 3D qui aide à poser un modèle importé. L'adresse est signée ici avec la clé privée Apple (fichier
// .p8, service MapKit JS): la clé ne quitte jamais le serveur. L'image revient par la même origine que l'app (le
// navigateur peut s'en servir comme texture) et le navigateur seul la garde une semaine (pas de cache partagé).
// Variables: APPLE_MAPS_TEAM_ID, APPLE_MAPS_KEY_ID, et APPLE_MAPS_PRIVATE_KEY (texte PEM) ou, en local seulement,
// APPLE_MAPS_PRIVATE_KEY_PATH (chemin du fichier .p8, hors du dépôt). Voir docs/sat2-plans-apple.md.
//
// Service public: chaque image compte dans le quota Plans de l'équipe. Seules les pages de MeteoShoot sont servies
// (en-tête Origin, sinon Referer); les autres reçoivent 403. Contrôle de bonne foi: un script peut forger ces en-têtes,
// mais la page d'un autre site ne peut pas s'en servir. Zoom borné de 16 à 20 (image de 1280 pixels autour du projet).
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const HOST = 'https://snapshot.apple-mapkit.com';
const WEEK = 604800;

// Hôtes admis: le site, l'ancien domaine sans www, les déploiements Vercel des projets meteoshoot et meteoshoot-dev (et
// leurs aperçus, nommés d'après l'équipe sgroleaus-projects: un autre projet Vercel nommé « meteoshoot-quelquechose »
// n'entre pas), le développement local (aussi par le réseau de la maison: tablette ou téléphone sur l'adresse du Mac, en
// http seulement), et l'app native (iOS: capacitor://localhost; Android: https://localhost).
const SITES = new Set(['www.meteoshoot.com', 'meteoshoot.com', 'meteoshoot.vercel.app', 'meteoshoot-dev.vercel.app']);
const PREVIEW = /^meteoshoot(-dev)?-[a-z0-9-]+-sgroleaus-projects\.vercel\.app$/;
const LOCAL = new Set(['localhost', '127.0.0.1']);
const lan = (h) => /^(10\.\d+|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+$/.test(h) || h.endsWith('.local');
function siteOf(raw) {
  if (!raw || typeof raw !== 'string' || raw === 'null') return false;
  let u;
  try { u = new URL(raw); } catch { return false; }
  const host = u.hostname.toLowerCase();
  if (u.protocol === 'capacitor:') return host === 'localhost';
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  return SITES.has(host) || LOCAL.has(host) || PREVIEW.test(host) || (u.protocol === 'http:' && lan(host));
}
// { ok, cors }: cors = origine à renvoyer dans Access-Control-Allow-Origin (appel d'une autre origine, app native).
// Un appel de la même origine (fetch GET) n'envoie souvent pas Origin: le Referer prend le relais.
function caller(req) {
  const h = req.headers || {};
  if (h.origin) return siteOf(h.origin) ? { ok: true, cors: h.origin } : { ok: false };
  return { ok: siteOf(h.referer), cors: null };
}

let key = null;
function privateKey() {
  if (key) return key;
  const pem = process.env.APPLE_MAPS_PRIVATE_KEY || (process.env.APPLE_MAPS_PRIVATE_KEY_PATH ? readFileSync(process.env.APPLE_MAPS_PRIVATE_KEY_PATH, 'utf8') : '');
  if (!pem) return null;
  key = createPrivateKey(pem.replace(/\\n/g, '\n'));
  return key;
}

// Réponses d'erreur jamais gardées par le navigateur; messages courts, sans adresse signée ni identifiants Apple.
const fail = (res, code, msg) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ error: msg }));
};
// Journal côté serveur: statut et cause seulement (ni clé, ni adresse signée, ni identifiants d'équipe ou de clé).
const note = (msg) => console.error(`[apple-snapshot] ${msg}`);

// Adresse signée de l'image (côté serveur seulement): { url, hide } ou null sans clé ni identifiants. Sert aussi au
// calage de l'image sur les empreintes des bâtiments (api/satshift.js).
export function snapshotRequest(lat, lng, z = 18) {
  const team = process.env.APPLE_MAPS_TEAM_ID, keyId = process.env.APPLE_MAPS_KEY_ID;
  let k = null;
  try { k = privateKey(); } catch { return null; }
  if (!k || !team || !keyId) return null;
  const q = new URLSearchParams({ center: `${lat.toFixed(6)},${lng.toFixed(6)}`, z: String(z), size: '640x640', scale: '2', t: 'satellite', teamId: team, keyId });
  const path = `/api/v1/snapshot?${q}`;
  const signature = sign('sha256', Buffer.from(path), { key: k, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const hide = (x) => [team, keyId, signature].filter(Boolean).reduce((t, v) => t.split(v).join('***'), String(x)).replace(/signature=[^&\s"']*/g, 'signature=***');
  return { url: `${HOST}${path}&signature=${signature}`, hide };
}

export default async function handler(req, res) {
  const who = caller(req);
  res.setHeader('Vary', 'Origin');
  if (who.cors) res.setHeader('Access-Control-Allow-Origin', who.cors);
  if (!who.ok) { fail(res, 403, 'origine non autorisée'); return; }
  if (req.method === 'OPTIONS') {
    res.statusCode = 204; res.setHeader('Access-Control-Allow-Methods', 'GET'); res.setHeader('Access-Control-Max-Age', '86400'); res.end();
    return;
  }
  if (req.method && req.method !== 'GET') { res.setHeader('Allow', 'GET, OPTIONS'); fail(res, 405, 'méthode non permise'); return; }

  const u = new URL(req.url, 'http://local');
  const lat = Number(u.searchParams.get('lat')), lng = Number(u.searchParams.get('lng'));
  // Zoom hors de 16 à 20: refusé plutôt que corrigé (satDrape.js calcule le côté de l'image d'après le zoom demandé).
  const z = u.searchParams.get('z') == null ? 18 : Number(u.searchParams.get('z'));
  if (!Number.isInteger(z) || z < 16 || z > 20) { fail(res, 400, 'zoom de 16 à 20'); return; }
  if (!u.searchParams.get('lat') || !u.searchParams.get('lng') || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) { fail(res, 400, 'lat/lng invalides'); return; }
  const team = process.env.APPLE_MAPS_TEAM_ID, keyId = process.env.APPLE_MAPS_KEY_ID;
  let k = null;
  try { k = privateKey(); } catch (e) { note(`clé illisible (${e && e.code || 'format'})`); fail(res, 503, 'clé Plans illisible'); return; }
  if (!k || !team || !keyId) { note('clé ou identifiants absents'); fail(res, 503, 'clé Plans absente'); return; }
  // 640 x 640 points à l'échelle 2: 1280 pixels de côté, centrés sur le lieu (côté en mètres: voir satDrape.js).
  const q = new URLSearchParams({ center: `${lat.toFixed(6)},${lng.toFixed(6)}`, z: String(z), size: '640x640', scale: '2', t: 'satellite', teamId: team, keyId });
  const path = `/api/v1/snapshot?${q}`;
  const signature = sign('sha256', Buffer.from(path), { key: k, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  // Ce qu'Apple renvoie en cas d'erreur peut reprendre l'adresse: identifiants et signature masqués avant le journal.
  const hide = (s) => [team, keyId, signature].filter(Boolean).reduce((t, x) => t.split(x).join('***'), String(s)).replace(/signature=[^&\s"']*/g, 'signature=***');
  try {
    const r = await fetch(`${HOST}${path}&signature=${signature}`, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) {
      note(`Plans ${r.status}: ${hide(await r.text().catch(() => '')).slice(0, 200)}`);
      // 429: quota d'Apple atteint; le reste (clé refusée, panne) est un problème de ce côté-ci, pas de l'appelant.
      fail(res, r.status === 429 ? 503 : 502, r.status === 429 ? 'quota Plans atteint' : `Plans ${r.status}`);
      return;
    }
    const type = r.headers.get('content-type') || 'image/png';
    if (!type.startsWith('image/')) { note(`réponse inattendue (${type.slice(0, 60)})`); fail(res, 502, 'réponse Plans inattendue'); return; }
    const buf = Buffer.from(await r.arrayBuffer());
    res.statusCode = 200;
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('Cache-Control', `private, max-age=${WEEK}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(buf);
  } catch (e) {
    const why = e && e.name === 'TimeoutError' ? 'délai dépassé' : (e && e.cause && e.cause.code) || (e && e.name) || 'erreur';
    note(`Plans injoignable (${hide(why)})`);
    fail(res, 502, 'Plans injoignable');
  }
}
