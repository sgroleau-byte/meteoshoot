// Fonction serveur (Vercel): relais vers les serveurs réservés aux abonnés d'Open-Meteo (forfait commercial pris le
// 15 octobre 2026). La clé reste côté serveur (variable OPEN_METEO_KEY): l'app demande /api/om?ep=dwd-icon&latitude=...
// avec les mêmes paramètres qu'avant, le relais ajoute la clé et passe par customer-api.open-meteo.com (serveurs réservés,
// pas de limite par adresse, licence commerciale). Réponse gardée 10 minutes par le CDN. Les erreurs d'Open-Meteo
// (429, 5xx) sont rendues telles quelles pour que l'app garde ses nouveaux essais; une clé refusée ou une panne du relais
// rend 500, et l'app se rabat alors sur les serveurs ouverts.
//
// GET /api/om?ep=dwd-icon|gfs|forecast|elevation&<paramètres Open-Meteo>

const EPS = new Set(['dwd-icon', 'gfs', 'forecast', 'elevation']);
const PARAMS = new Set(['ep', 'latitude', 'longitude', 'hourly', 'daily', 'timezone', 'forecast_days', 'models']); // ceux de l'app, rien d'autre
const ORIGINS = /^(https:\/\/(www\.)?meteoshoot\.com|https:\/\/meteoshoot(-dev)?(-[a-z0-9-]+)?\.vercel\.app|capacitor:\/\/localhost|https?:\/\/localhost(:\d+)?|https?:\/\/127\.0\.0\.1(:\d+)?)$/;

// Adresse Open-Meteo pour un chemin « endpoint?paramètres »: serveurs réservés avec la clé si elle existe
export function openMeteoUrl(pathAndQuery) {
  const key = (process.env.OPEN_METEO_KEY || '').trim();
  return key ? `https://customer-api.open-meteo.com/v1/${pathAndQuery}&apikey=${encodeURIComponent(key)}` : `https://api.open-meteo.com/v1/${pathAndQuery}`;
}

// Garde-fou contre une boucle d'appels depuis une même adresse (par instance de la fonction): 120 demandes par minute
const hits = new Map();
const tooMany = (ip) => {
  const now = Date.now(), h = hits.get(ip) || { t: now, n: 0 };
  if (now - h.t > 60000) { h.t = now; h.n = 0; }
  h.n++; hits.set(ip, h);
  if (hits.size > 5000) hits.clear();
  return h.n > 120;
};

const send = (res, status, body, cache = 'no-store') => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', cache); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && !ORIGINS.test(origin)) { send(res, 403, { error: true, reason: 'origine refusée' }); return; }
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'inconnu';
  if (tooMany(ip)) { send(res, 429, { error: true, reason: 'trop de demandes' }); return; }
  const url = new URL(req.url, 'http://x');
  // Garde-fous (budget mensuel d'appels): paramètres connus seulement, chacun une seule fois (Open-Meteo additionne les
  // copies d'un paramètre: latitude=a&latitude=b ferait deux lieux), valeurs vérifiées telles qu'elles partent.
  const seen = new Set();
  for (const k of url.searchParams.keys()) { if (!PARAMS.has(k) || seen.has(k)) { send(res, 400, { error: true, reason: 'demande refusée par le relais' }); return; } seen.add(k); }
  const ep = url.searchParams.get('ep'), get = (k) => url.searchParams.get(k);
  const one = /^-?\d{1,2}(\.\d{1,6})?$/, oneL = /^-?\d{1,3}(\.\d{1,6})?$/, list = (v, re, max) => !!v && v.split(',').length <= max && v.split(',').every((x) => re.test(x));
  const word = /^[a-z0-9_]+$/, nVars = (get('hourly') || '').split(',').filter(Boolean).length + (get('daily') || '').split(',').filter(Boolean).length;
  const nModels = Math.max(1, (get('models') || '').split(',').filter(Boolean).length), days = get('forecast_days');
  const ok = EPS.has(ep)
    && (ep === 'elevation' ? list(get('latitude'), one, 200) && list(get('longitude'), oneL, 200) : one.test(get('latitude') || '') && oneL.test(get('longitude') || ''))
    && (days == null || (/^\d{1,2}$/.test(days) && Number(days) <= 16))
    && ['hourly', 'daily', 'models'].every((k) => get(k) == null || list(get(k), word, 60))
    && (get('timezone') == null || /^[A-Za-z_]+(\/[A-Za-z_]+)?$/.test(get('timezone')))
    && nVars * nModels <= 60;
  if (!ok) { send(res, 400, { error: true, reason: 'demande refusée par le relais' }); return; }
  const qs = new URLSearchParams(); for (const k of ['latitude', 'longitude', 'hourly', 'daily', 'models', 'timezone', 'forecast_days']) if (get(k) != null) qs.set(k, get(k));
  try {
    const r = await fetch(openMeteoUrl(`${ep}?${qs.toString()}`), { signal: AbortSignal.timeout(20000) });
    const body = await r.text();
    // clé refusée (forfait échu, clé changée): 500 pour que l'app se rabatte sur les serveurs ouverts, et une trace ici
    if (r.status === 401 || r.status === 403 || (r.status === 400 && /api ?key|apikey|subscription/i.test(body))) { console.error('[om] clé refusée', r.status, body.slice(0, 200)); send(res, 500, { error: true, reason: 'clé refusée' }); return; }
    send(res, r.status, body, r.ok ? 'public, max-age=300, s-maxage=600' : 'no-store');
  } catch (e) {
    send(res, 500, { error: true, reason: 'relais: ' + String((e && e.message) || e) }); // panne ou lenteur du relais: repli côté app
  }
}
