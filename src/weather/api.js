import { SHOOT_WINDOWS, isGoodWeather, sunlitFraction, weatherCodeIcon } from './iconsLogic.js';
import { fetchObserved, applyObservedToHourly, applyNowcast } from './nowcast.js';
import { clearDirHour, sunElevation } from './solar.js';
import { blendCloud, BLEND_MEMBERS, loadBlendModel } from './blend.js';

// ===== WEATHER API =====
// Mode simulation (uniquement en dev): permet de tester la banniere et le badge stale
// sans dependre d'une vraie panne Open-Meteo. Activable par URL (?sim=api|network|off)
// ou par le panneau dev des Preferences. La valeur est persistee en localStorage.
export const WEATHER_SIM_KEY = 'sp-debug-weather-sim';
export const getWeatherSim = () => {
  if (typeof isDev !== 'undefined' && !isDev) return null; // bloque en prod
  try { return localStorage.getItem(WEATHER_SIM_KEY) || null; } catch (e) { return null; }
};
export const setWeatherSim = (mode) => {
  try {
    if (!mode || mode === 'off') localStorage.removeItem(WEATHER_SIM_KEY);
    else localStorage.setItem(WEATHER_SIM_KEY, mode);
  } catch (e) {}
};
// Lecture des params URL au demarrage: ?sim=api / ?sim=network / ?sim=off.
// Permet d'activer/desactiver depuis n'importe quel onglet, y compris la PWA Mac
// en collant l'URL voulue dans la barre Safari avant d'ouvrir l'app.
try {
  const _simParam = new URL(location.href).searchParams.get('sim');
  if (_simParam && (typeof isDev === 'undefined' || isDev)) {
    if (['api', 'network', 'off'].includes(_simParam)) setWeatherSim(_simParam);
  }
} catch (e) {}

// Cache localStorage des dernieres reponses meteo reussies, indexees par (lat,lng).
// Sert de filet quand l'API Open-Meteo retombe en panne: on garde les donnees affichables
// et on signale visuellement (badge) qu'elles ne sont pas fraiches.
export const WEATHER_CACHE_KEY = 'sp-weather-cache';
export const WEATHER_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h: au dela on considere obsolete
export const weatherCacheKey = (lat, lng) => `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`;
// Une prévision pèse environ 85 Ko (14 octobre 2026): 50 entrées dépassaient le quota du stockage local de Safari, et
// l'écriture échouait sans bruit (le cache ne se renouvelait plus). Le cache est donc lu une seule fois, gardé en mémoire,
// limité aux 24 lieux les plus récents et écrit une fois par vague de réponses (au lieu de tout relire et réécrire à
// chaque projet); si le quota refuse encore, on retire les plus vieux jusqu'à ce que ça passe.
const WEATHER_CACHE_MAX = 24;
let weatherCacheAll = null;
let weatherCacheFlush = null;
const weatherCacheEntries = () => {
  if (!weatherCacheAll) {
    try { weatherCacheAll = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) || '{}') || {}; } catch (e) { weatherCacheAll = {}; }
  }
  return weatherCacheAll;
};
export const readWeatherCache = (lat, lng) => {
  const entry = weatherCacheEntries()[weatherCacheKey(lat, lng)];
  if (!entry || !entry.data || !entry.cachedAt) return null;
  if (Date.now() - entry.cachedAt > WEATHER_CACHE_TTL_MS) return null;
  return entry;
};
export const writeWeatherCache = (lat, lng, data) => {
  weatherCacheEntries()[weatherCacheKey(lat, lng)] = { data, cachedAt: Date.now() };
  clearTimeout(weatherCacheFlush);
  weatherCacheFlush = setTimeout(() => {
    const entries = Object.entries(weatherCacheAll).sort((a, b) => (b[1].cachedAt || 0) - (a[1].cachedAt || 0));
    for (let n = Math.min(entries.length, WEATHER_CACHE_MAX); n > 0; n = Math.floor(n / 2)) {
      try {
        weatherCacheAll = Object.fromEntries(entries.slice(0, n));
        localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(weatherCacheAll));
        return;
      } catch (e) { /* quota plein: on retire les plus vieux */ }
    }
  }, 1500);
};
// Retire les jours passés d'une prévision gardée (celle d'hier soir commencerait à hier: le départ du jour serait faux).
const dropPastDays = (data) => {
  if (!data || !data.daily || !data.hourly) return null;
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const daily = data.daily.filter((x) => String(x.date).slice(0, 10) >= today);
  if (!daily.length) return null;
  return { ...data, daily, hourly: data.hourly.filter((h) => String(h.time).slice(0, 10) >= today) };
};
// Prévision fraîche déjà reçue pendant cette séance (moins de 30 min, la même que fetchWeather rendrait), lue sans
// attendre: rouvrir un projet ou revenir à la liste ne fait pas clignoter la météo. Jamais la copie du stockage local:
// une prévision plus vieille affichée sans le dire pendant le chargement trompait (v633.207, retirée en v633.208 à la
// demande de Stéphane); la liste attend la vraie.
export const peekWeather = (lat, lng) => {
  if (!lat || !lng || getWeatherSim()) return null;
  const mem = weatherMemCache.get(weatherCacheKey(lat, lng));
  return mem && Date.now() - mem.fetchedAt < WEATHER_MEM_TTL_MS ? mem.data : null;
};

// Wrapper d'un appel Open-Meteo. Retourne un objet de resultat plutot que de throw,
// pour distinguer panne reseau, panne API (5xx/429) et reponse 200 invalide.
//   { data }                             -> succes
//   { error: 'network' }                 -> fetch a throw (offline, DNS, CORS bloquant, etc.)
//   { error: 'api', status: <int> }      -> reponse non-OK (priorite aux 5xx et 429)
//   { error: 'api', status: 'invalid' }  -> reponse 200 mais body invalide / sans hourly
// Open-Meteo refuse les appels trop nombreux en même temps depuis une même adresse (429 « Too many concurrent
// requests »): mesuré le 3 octobre 2026, 5 ou 6 refus sur 24 appels simultanés, aucun à 8. Au chargement, chaque
// projet lance deux appels (ICON et GFS): avec une dizaine de projets, plusieurs étaient refusés, et quand les deux
// modèles d'un projet l'étaient, la bannière « API météo temporairement inaccessible » s'affichait alors que le service
// fonctionnait. D'où une file (4 appels à la fois, dans l'ordre de la liste), de nouveaux essais espacés en cas de
// refus, et le partage d'un appel identique déjà en cours. La limite vaut pour l'adresse internet: l'iPhone, l'iPad
// et le Mac d'un même réseau la partagent (4 octobre 2026: refus massifs quand plusieurs chargeaient en même temps).
const OPEN_METEO_MAX_CONCURRENT = 4;
const OPEN_METEO_RETRY_MS = [600, 1500, 3000, 6000];
let openMeteoActive = 0;
const openMeteoWaiting = [];
const openMeteoInFlight = new Map(); // url -> Promise du résultat
const withOpenMeteoSlot = async (task) => {
  // Une place qui se libère passe directement au premier en attente (le compte ne bouge pas): aucun nouvel appel ne
  // peut s'intercaler et dépasser la limite.
  if (openMeteoActive >= OPEN_METEO_MAX_CONCURRENT) await new Promise((resolve) => openMeteoWaiting.push(resolve));
  else openMeteoActive++;
  try { return await task(); } finally {
    const next = openMeteoWaiting.shift();
    if (next) next(); else openMeteoActive--;
  }
};
// Délai maximal d'un appel (réponse normale: moins de 1,5 s). Sans lui, une connexion restée suspendue (au réveil du Mac,
// réseau qui change) garde sa place dans la file jusqu'à ce que le système abandonne. Mais le 15 octobre 2026, la vraie
// lenteur venait du serveur: Open-Meteo surchargé, 31 s pour une réponse complète, puis plus rien en 90 s (« The service
// is overloaded »): couper tôt ne ferait que relancer la même demande sur un serveur débordé. D'où un délai large, un
// seul nouvel essai sur une connexion neuve, et deux essais rapprochés quand le serveur se dit surchargé (502, 503, 504):
// un raté passager est absorbé, mais une vraie panne affiche vite la copie locale et la bannière (la liste attend la vraie
// prévision depuis la v633.208, elle ne doit pas rester vide longtemps).
const OPEN_METEO_TIMEOUT_MS = [40000, 60000];
const OPEN_METEO_NETWORK_RETRY_MS = [1000];
const OPEN_METEO_OVERLOAD_RETRY_MS = [1500, 4000];
const fetchOpenMeteoOnce = async (url, timeoutMs) => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    let res;
    try {
      res = await fetch(url, { signal: ctl.signal });
    } catch (e) {
      return { error: 'network' };
    }
    if (!res.ok) {
      return { error: 'api', status: res.status };
    }
    let body;
    try {
      body = await res.json();
    } catch (e) {
      // Corps coupé par le délai maximal: c'est le réseau, pas une réponse invalide.
      return ctl.signal.aborted ? { error: 'network' } : { error: 'api', status: 'invalid' };
    }
    if (!body || !body.hourly) {
      return { error: 'api', status: 'invalid' };
    }
    return { data: body };
  } finally {
    clearTimeout(timer);
  }
};

export const fetchOpenMeteoModel = async (endpoint, qs) => {
  // Court-circuit de simulation pour QA en dev: on retourne directement l'erreur
  // simulee sans appeler le reseau, pour reproduire bannieres et badges a la demande.
  const sim = getWeatherSim();
  if (sim === 'network') return { error: 'network' };
  if (sim === 'api') return { error: 'api', status: 503 };
  const url = `https://api.open-meteo.com/v1/${endpoint}?${qs}`;
  const pending = openMeteoInFlight.get(url);
  if (pending) return pending;
  const run = (async () => {
    for (let refused = 0, lost = 0, overloaded = 0; ;) {
      // La pause se fait hors de la file, pour ne pas bloquer une place pendant l'attente.
      const result = await withOpenMeteoSlot(() => fetchOpenMeteoOnce(url, OPEN_METEO_TIMEOUT_MS[lost]));
      let wait;
      if (result.status === 429 && refused < OPEN_METEO_RETRY_MS.length) wait = OPEN_METEO_RETRY_MS[refused++];
      else if ([502, 503, 504].includes(result.status) && overloaded < OPEN_METEO_OVERLOAD_RETRY_MS.length) wait = OPEN_METEO_OVERLOAD_RETRY_MS[overloaded++];
      else if (result.error === 'network' && lost < OPEN_METEO_NETWORK_RETRY_MS.length) wait = OPEN_METEO_NETWORK_RETRY_MS[lost++];
      else return result;
      await new Promise((resolve) => setTimeout(resolve, wait + Math.random() * 400));
    }
  })();
  openMeteoInFlight.set(url, run);
  try { return await run; } finally { openMeteoInFlight.delete(url); }
};

// Cache mémoire (RAM) des dernières réponses météo fraîches, par (lat,lng). Sert quand un
// dossier est refermé puis rouvert peu après: on resserre la donnée sans rappeler l'API.
// TTL 30 min. Distinct du cache localStorage 24 h (sp-weather-cache) qui, lui, n'est qu'un
// filet "API en panne": ici on court-circuite carrément l'appel réseau tant que c'est frais.
export const WEATHER_MEM_TTL_MS = 30 * 60 * 1000;
export const weatherMemCache = new Map(); // key "lat,lng" (3 décimales) -> { data, fetchedAt }

// ===== FUMEE DE FEUX (FireWork / Environnement Canada) =====
// Source distincte d'Open-Meteo: la couverture nuageuse et le rayonnement ICON ne "voient" pas
// la fumee (faite de particules, pas d'eau). On interroge la couche de fumee de feux du modele
// FireWork via l'API ouverte GeoMet (gratuite, CORS ouvert, saison avril-sept, portee ~3 jours).
// Niveau PAR JOUR (la fumee bouge lentement): 0 rien, 1 leger, 2 modere, 3 dense.
export const SMOKE_DAVG = 'RAQDPS.Sfc_PM2.5-WildireSmokePlume-DAvg';   // moyenne journaliere (jours suivants)
export const SMOKE_HOURLY = 'RAQDPS.Sfc_PM2.5-WildfireSmokePlume';     // horaire (pour aujourd'hui)
export const smokeLevelFromUg = (ug) => {
  if (ug == null || ug < 5) return 0;
  if (ug < 20) return 1;
  if (ug < 60) return 2;
  return 3;
};
export const fetchSmokePoint = async (layer, time, lat, lng) => {
  try {
    const d = 0.05;
    const bbox = `${(lng - d).toFixed(3)},${(lat - d).toFixed(3)},${(lng + d).toFixed(3)},${(lat + d).toFixed(3)}`;
    const url = `https://geo.weather.gc.ca/geomet?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&LAYERS=${layer}&QUERY_LAYERS=${layer}&SRS=EPSG:4326&BBOX=${bbox}&WIDTH=10&HEIGHT=10&X=5&Y=5&INFO_FORMAT=application/json&TIME=${time}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(4000) }); // GeoMet muet: on n'attend pas
    if (!r.ok) return null;
    const j = await r.json();              // une erreur GeoMet est renvoyee en XML -> throw -> catch
    const p = j.features && j.features[0] && j.features[0].properties;
    if (!p || p.value == null) return null;
    return p.value * 1e9;                  // kg/m3 -> microgrammes/m3
  } catch (e) { return null; }
};
// Fumée d'une heure précise (vue 3D): la couche horaire de FireWork couvre environ 72 h, une heure par demande (une
// liste ou une plage d'heures est refusée). Attention: ce n'est pas la fumée seule, mais toutes les particules fines
// (microgrammes par mètre cube, au sol) là où le modèle reconnaît un panache de feux, et 0 ailleurs; le fond urbain y
// entre (le soir, le chauffage au bois allume le masque à 10 ou 15). Null hors de la période prévue ou en panne.
// Gardée une heure en mémoire (le modèle tourne deux fois par jour).
const smokeHourCache = new Map();
export const smokeHourCached = (lat, lng, isoHourZ) => { const c = smokeHourCache.get(`${lat.toFixed(2)},${lng.toFixed(2)},${isoHourZ}`); return c && Date.now() - c.t < 3600000 ? c.v : undefined; };
export const fetchSmokeHour = async (lat, lng, isoHourZ) => {
  const k = `${lat.toFixed(2)},${lng.toFixed(2)},${isoHourZ}`, c = smokeHourCache.get(k);
  if (c && Date.now() - c.t < 3600000) return c.v;
  const v = await fetchSmokePoint(SMOKE_HOURLY, isoHourZ, lat, lng);
  smokeHourCache.set(k, { v, t: Date.now() });
  return v;
};
// Niveau de fumee par jour (cle "YYYY-MM-DD" locale) pour aujourd'hui + 3 jours. Jamais bloquant:
// tout echec (hors saison, reseau, pas de couche) laisse simplement le jour sans fumee.
export const fetchSmoke = async (lat, lng) => {
  const inner = (async () => {
    const out = {};
    const base = new Date();
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    // Icône de fumée: dès qu'il y en a (Stéphane: la fumée gâche un tournage, toujours laid). Chaque moyenne couvre
    // les 24 heures qui précèdent son heure, et cette heure dépend du dernier calcul du modèle: 12:00 UTC après celui de
    // midi, 00:00 UTC après celui de minuit (l'ancienne lecture, toujours à 12:00, ne trouvait rien la moitié du temps).
    // On demande les deux heures sur cinq jours (ce qui n'existe pas revient vide) et, pour chaque journée (6 h à 20 h),
    // on garde la plus forte des moyennes qui la couvrent au moins 3 heures.
    const stamps = [];
    for (let k = -1; k <= 4; k++) for (const hh of [0, 12]) stamps.push(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + k, hh)));
    const vals = await Promise.all(stamps.map(d => fetchSmokePoint(SMOKE_DAVG, d.toISOString().slice(0, 19) + 'Z', lat, lng)));
    const jobs = [0, 1, 2, 3].map(async (i) => {
      const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i), dStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 6).getTime(), dEnd = dStart + 14 * 3600000;
      let ug = null;
      stamps.forEach((st, k) => { const v = vals[k], wEnd = st.getTime(), wStart = wEnd - 86400000; if (v != null && Math.min(dEnd, wEnd) - Math.max(dStart, wStart) >= 3 * 3600000) ug = Math.max(ug ?? 0, v); });
      if (ug == null && i === 0) {           // aujourd'hui n'est pas couvert par la moyenne journaliere
        const h = new Date();
        const hUTC = `${h.getUTCFullYear()}-${String(h.getUTCMonth() + 1).padStart(2, '0')}-${String(h.getUTCDate()).padStart(2, '0')}T${String(h.getUTCHours()).padStart(2, '0')}:00:00Z`;
        ug = await fetchSmokePoint(SMOKE_HOURLY, hUTC, lat, lng);
      }
      if (ug != null) out[ymd(day)] = smokeLevelFromUg(ug);
    });
    await Promise.all(jobs);
    return out;
  })();
  // Filet: si GeoMet rame, on n'attend pas plus de 7 s pour ne pas retarder la meteo.
  return Promise.race([inner, new Promise((res) => setTimeout(() => res({}), 7000))]).catch(() => ({}));
};

// Orage et averses (vue 3D, 8 octobre 2026): code météo brut (80 à 82 averses, 95 à 99 orage), rayonnement direct sur le sol
// horizontal et diffus (W/m², moyennes de l'heure précédente; le diffus sert à la 3D quand sunFraction est trop sombre pour
// être calculé, v633.194) et nuage convectif d'ICON, base et épaisseur en mètres (0: aucun). GFS n'a
// pas de nuage convectif; les 36 premières heures (celles de la 3D) viennent d'ICON tant qu'il répond. Le code et le rayonnement
// sont dans chaque rangée de la prévision; le nuage convectif vient des données de la 3D (fetchSceneWeather).
const radiation = (h, i) => ({ wc: h.weathercode?.[i] ?? null, direct: h.direct_radiation?.[i] ?? null, diffuse: h.diffuse_radiation?.[i] ?? null });
const convective = (h, i) => {
  const b = h.convective_cloud_base?.[i], t = h.convective_cloud_top?.[i];
  return { convBase: b > 0 ? Math.round(b) : 0, convDepth: b > 0 && t > b ? Math.round(t - b) : 0 };
};

// Forme des nuages (vue 3D, 9 octobre 2026), d'ICON: profil vertical de la nébulosité sur 12 niveaux de pression (1000 à
// 200 hPa, soit du sol à 12 km) avec l'altitude de chaque niveau au-dessus du sol du modèle, énergie de convection (CAPE,
// J/kg), niveau de gel et base des cumulus (niveau de condensation: 125 m par degré d'écart entre température et point de
// rosée). Les hauteurs sont en mètres au-dessus du sol. Seulement pour les trois premiers jours (la 3D ne regarde que 36 h):
// au-delà, rien, pour ne pas alourdir le cache. Un modèle sans ces champs (GFS, rangées anciennes du cache) donne null.
const SKY_LEVELS = [1000, 950, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200];
const SKY_KEYS = ['cape', 'freezing_level_height', 'dew_point_2m', ...SKY_LEVELS.map(p => `cloud_cover_${p}hPa`), ...SKY_LEVELS.map(p => `geopotential_height_${p}hPa`)];
const skyProfile = (h, i, elev) => {
  if (i >= 72) return {};
  const cc = SKY_LEVELS.map(p => h[`cloud_cover_${p}hPa`]?.[i]);
  if (cc.some(v => v == null)) return {};
  const zz = SKY_LEVELS.map(p => h[`geopotential_height_${p}hPa`]?.[i]);
  const T = h.temperature_2m?.[i], Td = h.dew_point_2m?.[i], fz = h.freezing_level_height?.[i];
  return {
    elev: Math.round(elev),
    cape: h.cape?.[i] ?? null,
    frz: fz != null ? Math.round(fz - elev) : null,
    lcl: T != null && Td != null ? Math.max(100, Math.round(125 * (T - Td))) : null,
    prof: cc.map(v => Math.round(v)),
    profZ: zz.map(z => z == null ? null : Math.round((z - elev) / 10) * 10),
  };
};

// Brouillard: variables de GFS en plus (visibilité en mètres, humidité au sol et à 1000, 975, 950, 925, 900 et 850 hPa,
// altitude de ces niveaux en mètres au-dessus de la mer, soit jusqu'à environ 1500 m).
const FOG_LEVELS = [1000, 975, 950, 925, 900, 850];
const FOG_KEYS_GFS = ['visibility', 'relative_humidity_2m', ...FOG_LEVELS.map(p => `relative_humidity_${p}hPa`), ...FOG_LEVELS.map(p => `geopotential_height_${p}hPa`)];
const FOG_RH = 95;
// Haut d'une nappe de brouillard (mètres au-dessus de la mer): air saturé (humidité de 95 % et plus) depuis le sol
// jusqu'au premier niveau qui ne l'est plus, l'altitude interpolée entre les deux. Nul si l'air n'est pas saturé au sol.
// Niveaux espacés d'environ 200 m: estimation grossière, à lire comme un ordre de grandeur. Saturé jusqu'au dernier
// niveau (ou aucun niveau au-dessus du sol, site en altitude): sommet inconnu, 2000 m conventionnels (nappe épaisse).
export const fogTopFrom = (h, i, elev) => {
  const rh0 = h.relative_humidity_2m?.[i]; if (rh0 == null || rh0 < FOG_RH) return null;
  let zPrev = elev, rPrev = rh0;
  for (const p of FOG_LEVELS) {
    const z = h[`geopotential_height_${p}hPa`]?.[i], r = h[`relative_humidity_${p}hPa`]?.[i];
    if (z == null || r == null || z <= elev + 5) continue;
    if (r < FOG_RH) return Math.round(Math.max(elev + 10, zPrev + (z - zPrev) * (rPrev - FOG_RH) / Math.max(1e-3, rPrev - r)));
    zPrev = z; rPrev = r;
  }
  return elev + 2000;
};

// Données de la liste, de la fiche, de la Route et de la météo de la position (15 octobre 2026): 10 horaires et 5
// quotidiennes par modèle, soit 1,5 appel chez Open-Meteo, qui compte une requête pour chaque tranche de 10 données. Les
// données de la vue 3D (nuages moyens, hauts et par altitude, nuage convectif, brouillard) triplaient ce poids à chaque
// ouverture de la liste alors que la 3D sert rarement: fetchSceneWeather les demande seulement quand la 3D s'affiche.
const HOURLY_KEYS = ['temperature_2m', 'weathercode', 'windspeed_10m', 'windgusts_10m', 'cloudcover', 'precipitation', 'precipitation_probability', 'direct_radiation', 'diffuse_radiation', 'cloudcover_low'];
const DAILY_KEYS = ['weathercode', 'temperature_2m_max', 'temperature_2m_min', 'sunrise', 'sunset'];

// Champs ajoutés à une rangée formatée seulement quand ils servent (prévision gardée en cache local: poids)
function extraCloudFields(h, i) {
  const o = {};
  if (h.blendK?.[i] != null) { o.blendK = h.blendK[i]; o.cloudcoverIcon = h.cloudcoverIcon[i]; o.cloudLowIcon = h.cloudLowIcon[i]; }
  if (h.obsW?.[i]) { o.obsW = h.obsW[i]; o.cloudcoverModel = h.cloudcoverModel[i]; o.cloudLowModel = h.cloudLowModel[i]; o.directIcon = h.directIcon[i]; if (h.obsInfo[i]) o.obsInfo = h.obsInfo[i]; if (h.obsLayers[i]) o.obsLayers = h.obsLayers[i]; }
  return o;
}

// Noms Open-Meteo des membres de la couverture combinée (ICON et GFS viennent des deux requêtes de base)
const MEMBER_API = { GEM: 'gem_seamless', ECMWF: 'ecmwf_ifs025', AIFS: 'ecmwf_aifs025_single', UKMO: 'ukmo_seamless', NBM: 'ncep_nbm_conus', IFS9: 'ecmwf_ifs' };
function applyBlend(hourly, { model, gfs, gfsHourIdx, members, lat, lng, tzOffsetMin, now = Date.now() }) {
  const n = hourly.time.length;
  hourly.cloudcoverIcon = hourly.cloudcover.slice(); hourly.cloudLowIcon = hourly.cloudcover_low.slice(); hourly.blendK = new Array(n).fill(null);
  if (!model) return;
  const msOf = (t) => (tzOffsetMin != null ? Date.parse(t + ':00Z') - tzOffsetMin * 60000 : new Date(t).getTime());
  const memIdx = {}; if (members && members.hourly) members.hourly.time.forEach((t, i) => { memIdx[t] = i; });
  const mem = (m, t) => { const a = members && members.hourly && members.hourly[`cloud_cover_${MEMBER_API[m]}`]; const i = memIdx[t]; return a && i != null ? a[i] : null; };
  // part de l'heure au soleil prévue par ICON (direct rapporté au ciel clair), moyenne des rangées T et T+1 (le rayonnement
  // est la moyenne de l'heure précédente), comme au banc
  const pAt = (i) => { if (i >= n || hourly.direct_radiation[i] == null) return null; const c = clearDirHour(msOf(hourly.time[i]), lat, lng); return c >= 3 ? Math.min(1, hourly.direct_radiation[i] / c) : null; };
  for (let i = 0; i < n; i++) {
    if (hourly.model[i] !== 'icon') continue;
    const t = hourly.time[i], ms = msOf(t), ahead = (ms - now) / 3600000;
    if (ahead < -24 || ahead > 72) continue;
    const ico = hourly.cloudcover[i]; if (ico == null) continue;
    const p0 = pAt(i), p1 = pAt(i + 1), pSun = p0 != null && p1 != null ? (p0 + p1) / 2 : p0 ?? p1;
    const gi = gfsHourIdx[t];
    const f = { ICON: ico, GFS: gi != null && gfs ? gfs.hourly.cloudcover[gi] : null, GEM: mem('GEM', t), ECMWF: mem('ECMWF', t), AIFS: mem('AIFS', t), UKMO: mem('UKMO', t), NBM: mem('NBM', t), IFS9: mem('IFS9', t), ICONlow: hourly.cloudcover_low[i], pSun, sunEl: sunElevation(ms, lat, lng) };
    // Au moins trois autres modèles à cette heure (sinon les arbres travailleraient sur des entrées qu'ils n'ont presque jamais vues manquer)
    if (['GEM', 'ECMWF', 'AIFS', 'UKMO', 'IFS9'].filter((k) => f[k] != null).length < 3) continue;
    const b = blendCloud(model, f, Math.max(0, ahead));
    if (b == null) continue;
    const low = hourly.cloudcover_low[i];
    hourly.cloudcover[i] = b;
    hourly.blendK[i] = Math.round(Math.min(3, b / Math.max(5, ico)) * 100) / 100;
    // ICON presque sans nuages: la part basse du total combiné vient de GFS (même heure), sinon 60 % (moyenne observée au Québec)
    const gT = gi != null && gfs ? gfs.hourly.cloudcover[gi] : null, gL = gi != null && gfs ? gfs.hourly.cloudcover_low?.[gi] : null;
    if (low != null) hourly.cloudcover_low[i] = Math.round(Math.min(b, ico >= 5 ? low * b / ico : gT >= 10 && gL != null ? b * Math.min(1, gL / gT) : b * 0.6));
  }
}

// Dernier ciel observé par lieu (fetchWeather), réutilisé pour corriger les nuages moyens et hauts de la 3D.
const lastObserved = new Map();

export const fetchWeather = async (lat, lng) => {
  // Hit mémoire frais (< 30 min): on resserre sans toucher au réseau. Ce sont des données
  // d'un succès récent, donc fraîches (fromCache:false, pas le badge "stale"). Court-circuit
  // désactivé quand une simulation dev est active, pour ne pas masquer les pannes simulées en QA.
  const memKey = weatherCacheKey(lat, lng);
  if (!getWeatherSim()) {
    const mem = weatherMemCache.get(memKey);
    if (mem && (Date.now() - mem.fetchedAt) < WEATHER_MEM_TTL_MS) {
      return { data: mem.data, fromCache: false, cachedAt: mem.fetchedAt };
    }
  }
  // Deux modeles fusionnes: ICON (meilleure qualite du couvert, portee ~7,5 j) pour
  // les jours qu'il couvre, GFS (portee 16 j) pour completer jusqu'a 10 jours. La sortie
  // garde exactement la meme forme qu'une reponse Open-Meteo unique: ni l'affichage ni le
  // parsing plus bas ne changent.
  const qs = `latitude=${lat}&longitude=${lng}&hourly=${HOURLY_KEYS.join(',')}&daily=${DAILY_KEYS.join(',')}&timezone=America/Toronto&forecast_days=10`;
  // Autres modèles pour la couverture combinée (src/weather/blend.js): couverture totale seulement, 4 jours, poids 1 chez
  // Open-Meteo. Requête facultative: attendue au plus 6 s après les deux modèles de base (Open-Meteo surchargé la faisait
  // durer jusqu'à 100 s avec ses nouveaux essais); sans elle, ICON reste tel quel.
  const membersP = fetchOpenMeteoModel('forecast', `latitude=${lat}&longitude=${lng}&hourly=cloud_cover&models=${BLEND_MEMBERS.map((m) => MEMBER_API[m]).filter(Boolean).join(',')}&timezone=America/Toronto&forecast_days=4`);
  const [iconRes, gfsRes, smokeMap, observed, blendModel] = await Promise.all([
    fetchOpenMeteoModel('dwd-icon', qs),
    fetchOpenMeteoModel('gfs', qs),
    fetchSmoke(lat, lng),   // ne rejette jamais: {} si pas de fumee / hors saison / panne
    getWeatherSim() ? Promise.resolve(null) : fetchObserved(lat, lng),   // satellite et aéroports; ne rejette jamais: null
    loadBlendModel(),
  ]);
  const membersRes = await Promise.race([membersP, new Promise((res) => setTimeout(() => res(null), 6000))]);
  const membersOk = !!(membersRes && membersRes.data && membersRes.data.hourly);
  const icon = iconRes.data || null;
  const gfs = gfsRes.data || null;

  const dateOf = (t) => String(t).slice(0, 10);

  const gfsOk = !!(gfs && gfs.hourly && gfs.daily && gfs.daily.time);
  // Dernier jour reellement couvert par ICON (jour complet = temperature max non nulle).
  // Calcule depuis la reponse, jamais code en dur: la portee d'ICON varie selon le run.
  let lastIconDate = null;
  if (icon && icon.daily && icon.daily.time) {
    icon.daily.time.forEach((d, i) => {
      if (icon.daily.temperature_2m_max[i] != null) {
        const ds = dateOf(d);
        if (lastIconDate === null || ds > lastIconDate) lastIconDate = ds;
      }
    });
  }
  const iconOk = !!(icon && icon.hourly && icon.daily && lastIconDate !== null);
  if (!gfsOk && !iconOk) {
    // Les deux modeles sont injoignables. On priorise l'erreur la plus informative:
    // - api > network (on a eu une reponse HTTP, c'est plus parlant qu'un fetch qui throw)
    // - 5xx > 429 > autre status > 'invalid' (un 5xx est plus signifiant qu'un 4xx)
    const candidates = [iconRes, gfsRes].filter((r) => r && r.error);
    let chosen = candidates.find((r) => r.error === 'api' && typeof r.status === 'number' && r.status >= 500)
              || candidates.find((r) => r.error === 'api' && r.status === 429)
              || candidates.find((r) => r.error === 'api')
              || candidates.find((r) => r.error === 'network')
              || { error: 'api', status: 'invalid' };
    // Filet: si on a une reponse encore exploitable en cache local, on la renvoie en mode "stale".
    const cached = readWeatherCache(lat, lng);
    const cachedData = cached && dropPastDays(cached.data);
    if (cachedData) {
      // Ciel observé de la copie: périmé, on le retire (pas d'« Observé » de la veille dans la légende de la 3D)
      const noObs = cachedData && { ...cachedData, hourly: cachedData.hourly.map(({ obsW, obsInfo, obsLayers, ...h }) => h) };
      return { data: noObs, fromCache: true, cachedAt: cached.cachedAt, error: chosen.error, status: chosen.status };
    }
    return { error: chosen.error, status: chosen.status };
  }

  // Index par horodatage (horaire) et par date (journalier) pour une jointure sans trou
  // ni doublon, meme si les grilles different d'un modele a l'autre.
  const indexBy = (resp, part, asDate) => {
    const m = {};
    if (resp && resp[part] && resp[part].time) {
      resp[part].time.forEach((t, i) => { m[asDate ? dateOf(t) : t] = i; });
    }
    return m;
  };
  const iconHourIdx = indexBy(icon, 'hourly', false);
  const iconDayIdx = indexBy(icon, 'daily', true);
  const gfsHourIdx = indexBy(gfs, 'hourly', false);
  const gfsDayIdx = indexBy(gfs, 'daily', true);

  // Colonne vertebrale: GFS (10 jours) si dispo, sinon les jours ICON disponibles
  // (si GFS tombe, l'app fonctionne quand meme avec les jours d'ICON).
  const hourlyTimes = gfsOk ? gfs.hourly.time : icon.hourly.time.filter((t) => dateOf(t) <= lastIconDate);
  const dailyTimes = gfsOk ? gfs.daily.time : icon.daily.time.filter((t) => dateOf(t) <= lastIconDate);

  const data = { hourly: { time: [] }, daily: { time: [] } };
  HOURLY_KEYS.forEach((k) => { data.hourly[k] = []; });
  DAILY_KEYS.forEach((k) => { data.daily[k] = []; });
  data.daily.model = []; // 'icon' ou 'gfs' par jour: l'indice d'opportunite ne sort que sur ICON.
  data.hourly.model = []; // idem par heure: les données de la 3D d'une heure viennent du même modèle (fetchSceneWeather)

  hourlyTimes.forEach((t) => {
    const useIcon = iconOk && dateOf(t) <= lastIconDate && (t in iconHourIdx);
    const src = useIcon ? icon : gfs;
    const si = useIcon ? iconHourIdx[t] : gfsHourIdx[t];
    data.hourly.time.push(t);
    data.hourly.model.push(useIcon ? 'icon' : 'gfs');
    HOURLY_KEYS.forEach((k) => {
      const arr = src && src.hourly ? src.hourly[k] : null;
      data.hourly[k].push(arr && si != null ? (arr[si] ?? null) : null);
    });
  });

  dailyTimes.forEach((t) => {
    const ds = dateOf(t);
    const useIcon = iconOk && ds <= lastIconDate && (ds in iconDayIdx);
    const src = useIcon ? icon : gfs;
    const si = useIcon ? iconDayIdx[ds] : gfsDayIdx[ds];
    data.daily.time.push(t);
    data.daily.model.push(useIcon ? 'icon' : 'gfs');
    DAILY_KEYS.forEach((k) => {
      const arr = src && src.daily ? src.daily[k] : null;
      data.daily[k].push(arr && si != null ? (arr[si] ?? null) : null);
    });
  });

  // Couverture combinée (15 octobre 2026): sur les 72 premières heures d'ICON, la couverture totale vient du mélange appris
  // sur 12 mois d'observations (ICON et les autres modèles, plus le soleil prévu par ICON); les nuages bas d'ICON suivent
  // en proportion. Valeurs d'ICON gardées (cloudcoverIcon) et rapport gardé pour les nuages moyens et hauts de la 3D (blendK).
  applyBlend(data.hourly, { model: blendModel, gfs, gfsHourIdx, members: membersRes && membersRes.data, lat, lng, tzOffsetMin: (iconOk ? icon : gfs)?.utc_offset_seconds != null ? (iconOk ? icon : gfs).utc_offset_seconds / 60 : null });

  // Ciel observé (15 octobre 2026): le satellite GOES-19 et les aéroports voisins corrigent les premières heures (nuages et
  // part de l'heure au soleil), avant les statistiques du jour et l'indice AM/PM (src/weather/nowcast.js). Le fuseau des
  // heures est celui de la réponse (America/Toronto), pas celui de l'appareil.
  const ref = iconOk ? icon : gfs;
  const tzOffsetMin = ref && ref.utc_offset_seconds != null ? ref.utc_offset_seconds / 60 : null;
  const obsUsed = applyObservedToHourly(data.hourly, observed, { lat, lng, tzOffsetMin, elev: ref?.elevation ?? 0, clearDir: (t) => clearDirHour(t, lat, lng) });
  if (obsUsed) lastObserved.set(weatherCacheKey(lat, lng), { obs: obsUsed, tzOffsetMin, at: Date.now() });

  // Calculer stats journalières depuis les données horaires (6h-18h)
  const getDailyStats = (dateStr) => {
    const dayStart = new Date(dateStr + 'T06:00:00');
    const dayEnd = new Date(dateStr + 'T18:00:00');
    
    let totalCloud = 0, cloudCount = 0, count = 0, precipCount = 0;
    let hasThunderstorm = false, hasSnow = false, hasRain = false;
    let sumDirect = 0, sumDiffuse = 0, sumLow = 0, lowCount = 0;

    data.hourly.time.forEach((t, i) => {
      const time = new Date(t);
      if (time >= dayStart && time <= dayEnd) {
        count++;
        if (data.hourly.cloudcover[i] != null) {
          totalCloud += data.hourly.cloudcover[i];
          cloudCount++;
        }
        const dr = data.hourly.direct_radiation?.[i], df = data.hourly.diffuse_radiation?.[i];
        if (dr != null && df != null) { sumDirect += dr; sumDiffuse += df; }
        const cl = data.hourly.cloudcover_low?.[i];
        if (cl != null) { sumLow += cl; lowCount++; }
        const wc = data.hourly.weathercode[i];
        if (wc >= 51) { // Any precipitation code
          precipCount++;
          if (wc >= 95) hasThunderstorm = true;
          else if ((wc >= 71 && wc <= 77) || wc === 85 || wc === 86) hasSnow = true;
          else hasRain = true;
        }
      }
    });
    
    const cloudcover = cloudCount > 0 ? Math.round(totalCloud / cloudCount) : null;
    // Fraction de lumiere directe du jour, ponderee par l'intensite (les heures lumineuses
    // pesent plus). Sert a distinguer un voile fin lumineux d'un couvert opaque.
    const sunFraction = (sumDirect + sumDiffuse) >= 50 ? sumDirect / (sumDirect + sumDiffuse) : null;
    const cloudLow = lowCount > 0 ? Math.round(sumLow / lowCount) : null;
    // Only show precip icon if >= 40% of daytime hours have precipitation
    const precipRatio = count > 0 ? precipCount / count : 0;
    let icon = null;
    if (precipRatio >= 0.4) {
      icon = hasThunderstorm ? 'thunderstorm' : hasSnow ? 'snow' : hasRain ? 'rain' : null;
    }
    return { cloudcover, icon, sunFraction, cloudLow };
  };
  
  // Opportunite de shoot sur une fenetre (autour du lever ou du coucher). Renvoie { frac, cloud, precip }
  // ou null. frac = soleil direct pondere par l'intensite sur la fenetre (heures sombres ~ ignorees).
  const shootWindowStats = (centerISO, beforeMin, afterMin) => {
    if (!centerISO) return null;
    const c = new Date(centerISO).getTime();
    const start = c - beforeMin * 60000, end = c + afterMin * 60000;
    let sumDirect = 0, sumTot = 0, cloudSum = 0, cloudN = 0, precip = false, any = false;
    for (let i = 0; i < data.hourly.time.length; i++) {
      const tt = new Date(data.hourly.time[i]).getTime();
      if (tt - 3600000 < end && tt > start) {  // rayonnement Open-Meteo = moyenne de l'heure precedente [tt-1h, tt]
        any = true;
        const dr = data.hourly.direct_radiation?.[i], df = data.hourly.diffuse_radiation?.[i];
        if (dr != null && df != null) { sumDirect += dr; sumTot += dr + df; }
        const cc = data.hourly.cloudcover?.[i];
        if (cc != null) { cloudSum += cc; cloudN++; }
        const wc = data.hourly.weathercode?.[i];
        if (wc != null && wc >= 51) precip = true;
      }
    }
    if (!any) return null;
    return { frac: sumTot >= 50 ? sumDirect / sumTot : null, cloud: cloudN ? Math.round(cloudSum / cloudN) : null, precip };
  };

  const formatted = {
    hourly: data.hourly.time.map((t,i) => ({ time: t, temp: Math.round(data.hourly.temperature_2m[i]), wind: Math.round(data.hourly.windspeed_10m[i]), gust: data.hourly.windgusts_10m?.[i] != null ? Math.round(data.hourly.windgusts_10m[i]) : null, cloudcover: data.hourly.cloudcover[i], precip: data.hourly.precipitation?.[i] ?? 0, precipProb: data.hourly.precipitation_probability?.[i] ?? null, sunFraction: sunlitFraction(data.hourly.direct_radiation?.[i], data.hourly.diffuse_radiation?.[i]), cloudLow: data.hourly.cloudcover_low?.[i] ?? null, smoke: smokeMap[dateOf(t)] || 0, icon: weatherCodeIcon[data.hourly.weathercode[i]] || 'cloudy', isGood: isGoodWeather(data.hourly.weathercode[i]), ...radiation(data.hourly, i), model: data.hourly.model[i], ...extraCloudFields(data.hourly, i) })),
    daily: data.daily.time.map((t,i) => {
      const stats = getDailyStats(t);
      // Use hourly-derived icon when available, fallback to daily weathercode
      const icon = stats.icon || (stats.cloudcover !== null ? null : (weatherCodeIcon[data.daily.weathercode[i]] || 'cloudy'));
      // Indice d'opportunite AM/PM: seulement sur les jours couverts par ICON (fiable en horaire).
      const model = data.daily.model[i];
      const am = model === 'icon' ? shootWindowStats(data.daily.sunrise[i], SHOOT_WINDOWS.am.before, SHOOT_WINDOWS.am.after) : null;
      const pm = model === 'icon' ? shootWindowStats(data.daily.sunset[i], SHOOT_WINDOWS.pm.before, SHOOT_WINDOWS.pm.after) : null;
      return { date: t, high: Math.round(data.daily.temperature_2m_max[i]), low: Math.round(data.daily.temperature_2m_min[i]), cloudcover: stats.cloudcover, sunFraction: stats.sunFraction, cloudLow: stats.cloudLow, smoke: smokeMap[dateOf(t)] || 0, icon, sunrise: data.daily.sunrise[i], sunset: data.daily.sunset[i], isGood: isGoodWeather(data.daily.weathercode[i]), model, am, pm };
    })
  };
  // Conserve la reponse pour servir de filet quand l'API retombera en panne.
  const fetchedAt = Date.now();
  writeWeatherCache(lat, lng, formatted);
  // Resservi < 30 min sans rappeler l'API, mais seulement si les deux modèles ont répondu: avec un seul (l'autre refusé
  // malgré les nouveaux essais), la prochaine ouverture retente plutôt que de garder 30 min des jours moins fiables.
  if (iconOk && gfsOk && membersOk) weatherMemCache.set(memKey, { data: formatted, fetchedAt });
  return { data: formatted, fromCache: false, cachedAt: fetchedAt };
};

// Données de la vue 3D (15 octobre 2026), demandées seulement quand la 3D s'affiche, sur 3 jours (elle regarde 36 h) et pour
// ce seul lieu: d'ICON, nuages moyens et hauts, nuage convectif et profil des nuages par altitude (avec la température, pour
// la base des cumulus); de GFS, visibilité et nappe de brouillard. Une heure venue de GFS dans la prévision (ICON en panne)
// prend aussi ses nuages chez GFS, comme avant. Rend une table heure -> champs à fondre dans les rangées de fetchWeather
// (mergeSceneWeather), ou null si rien n'a répondu et qu'aucune copie n'est gardée.
const SCENE_SKY_KEYS = ['temperature_2m', 'cloudcover', 'cloudcover_mid', 'cloudcover_high', 'convective_cloud_base', 'convective_cloud_top', ...SKY_KEYS];
// Gardées 30 min en mémoire, et une copie locale (6 lieux, 24 h) sert de filet quand Open-Meteo ne répond pas, comme pour la
// prévision. La clé porte le modèle des heures: des nuages de GFS (ICON en panne) ne servent jamais à des heures d'ICON.
const SCENE_CACHE_KEY = 'sp-scene-weather-cache';
const sceneMemCache = new Map(); // "lat,lng|modèle" -> { data, fetchedAt }
const readSceneCache = (key) => {
  try { const e = JSON.parse(localStorage.getItem(SCENE_CACHE_KEY) || '{}')[key]; return e && Date.now() - e.cachedAt < WEATHER_CACHE_TTL_MS ? e.data : null; } catch (e) { return null; }
};
const writeSceneCache = (key, data) => {
  try {
    const all = JSON.parse(localStorage.getItem(SCENE_CACHE_KEY) || '{}');
    all[key] = { data, cachedAt: Date.now() };
    localStorage.setItem(SCENE_CACHE_KEY, JSON.stringify(Object.fromEntries(Object.entries(all).sort((a, b) => b[1].cachedAt - a[1].cachedAt).slice(0, 6))));
  } catch (e) { /* quota plein: pas de copie */ }
};
export const fetchSceneWeather = async (lat, lng, weather) => {
  const hours = weather?.hourly || [];
  if (!hours.length) return null;
  // Heures des trois jours demandés (la prévision commence d'habitude à minuit aujourd'hui; une prévision gardée depuis la
  // veille commence un jour plus tôt, d'où quatre jours ici).
  const gfsRows = hours.slice(0, 96).some((h) => h.model === 'gfs');
  const key = `${weatherCacheKey(lat, lng)}|${gfsRows ? 'gfs' : 'icon'}`;
  const mem = sceneMemCache.get(key);
  if (mem && Date.now() - mem.fetchedAt < WEATHER_MEM_TTL_MS) return finishScene(lat, lng, mem.data, hours);
  const qs = (keys) => `latitude=${lat}&longitude=${lng}&hourly=${[...new Set(keys)].join(',')}&timezone=America/Toronto&forecast_days=3`;
  const ok = (r) => (r.data && r.data.hourly && r.data.hourly.time ? r.data : null);
  const [iconRes, gfsRes] = await Promise.all([
    fetchOpenMeteoModel('dwd-icon', qs(SCENE_SKY_KEYS)),
    fetchOpenMeteoModel('gfs', qs(gfsRows ? [...FOG_KEYS_GFS, ...SCENE_SKY_KEYS] : FOG_KEYS_GFS)),
  ]);
  const icon = ok(iconRes), gfs = ok(gfsRes);
  // Nuages de GFS: déjà dans sa réponse s'il fournit des heures de la prévision; sinon demandés seulement si ICON a échoué.
  const gfsSky = gfsRows ? gfs : (icon ? null : ok(await fetchOpenMeteoModel('gfs', qs(SCENE_SKY_KEYS))));
  if (!icon && !gfs && !gfsSky) return finishScene(lat, lng, readSceneCache(key), hours);
  const indexOf = (res) => { const m = {}; if (res) res.hourly.time.forEach((t, i) => { m[t] = i; }); return m; };
  const iconIdx = indexOf(icon), gfsIdx = indexOf(gfs), skyIdx = indexOf(gfsSky);
  const out = {};
  hours.forEach((h) => {
    if (!(h.time in iconIdx) && !(h.time in gfsIdx) && !(h.time in skyIdx)) return;
    const x = {};
    // Nuages: modèle de l'heure d'abord, l'autre à défaut. Altitude du sol de ce modèle pour les hauteurs.
    const order = h.model === 'gfs' ? [[gfsSky, skyIdx], [icon, iconIdx]] : [[icon, iconIdx], [gfsSky, skyIdx]];
    const src = order.find(([res, idx]) => res && h.time in idx);
    if (src) {
      const [res, idx] = src, i = idx[h.time];
      // Valeurs brutes (en cache); la couverture combinée et le ciel observé s'appliquent à la lecture (finishScene)
      Object.assign(x, { cloudMid: res.hourly.cloudcover_mid?.[i] ?? null, cloudHigh: res.hourly.cloudcover_high?.[i] ?? null, totScene: res.hourly.cloudcover?.[i] ?? null, fromIcon: res === icon }, convective(res.hourly, i), skyProfile(res.hourly, i, res.elevation ?? 0));
    }
    // Visibilité et épaisseur de la nappe au-dessus du sol (le haut moins l'altitude du lieu): toujours de GFS, quel que
    // soit le modèle de l'heure. Une épaisseur plutôt qu'une altitude: la 3D la pose sur son propre sol (relief LiDAR, ou sol
    // plat en attendant), qui diffère de l'altitude du modèle de quelques mètres à plusieurs dizaines.
    const gi = gfs ? gfsIdx[h.time] : null, elev = gfs?.elevation ?? 0;
    x.visibility = gi != null ? (gfs.hourly.visibility?.[gi] ?? null) : null;
    const top = gi != null ? fogTopFrom(gfs.hourly, gi, elev) : null;
    x.fogThick = top != null ? Math.max(10, Math.round(top - elev)) : null;
    out[h.time] = x;
  });
  if (icon && gfs) { sceneMemCache.set(key, { data: out, fetchedAt: Date.now() }); writeSceneCache(key, out); }
  return finishScene(lat, lng, out, hours);
};
// Nuages moyens et hauts de la 3D à la lecture de la table (gardée brute en cache): en proportion du total combiné de la
// prévision actuelle (blendK, heures d'ICON), puis corrigés par le dernier ciel observé du lieu (moins de 30 min), comme
// les nuages bas et le total de la prévision (fetchWeather). Rend une copie.
const finishScene = (lat, lng, out, hours) => {
  if (!out) return out;
  // rapport = total combiné de la prévision (avant le ciel observé) / total d'ICON de la table elle-même (son exécution peut être
  // plus ancienne que celle de la prévision)
  const bOf = {}; (hours || []).forEach((h) => { if (h.blendK != null) bOf[h.time] = h.cloudcoverModel ?? h.cloudcover; });
  const res = {};
  for (const [t, x] of Object.entries(out)) {
    const k = x.fromIcon !== false && bOf[t] != null && x.totScene != null ? Math.min(3, bOf[t] / Math.max(5, x.totScene)) : 1, sc = (v) => (v == null ? null : Math.round(Math.min(100, v * k)));
    res[t] = { ...x, cloudMid: sc(x.cloudMid), cloudHigh: sc(x.cloudHigh) };
    delete res[t].fromIcon; delete res[t].totScene;
  }
  const o = lastObserved.get(weatherCacheKey(lat, lng));
  if (!o || Date.now() - o.at > WEATHER_MEM_TTL_MS) return res;
  const times = Object.keys(res).sort();
  const rows = applyNowcast(times.map((t) => ({ time: t, cloudMid: res[t].cloudMid, cloudHigh: res[t].cloudHigh })), { ...o.obs, tot: null, low: null }, { tzOffsetMin: o.tzOffsetMin });
  rows.forEach((r) => { if (r.obsW) res[r.time] = { ...res[r.time], cloudMid: r.cloudMid, cloudHigh: r.cloudHigh }; });
  return res;
};
// Prévision avec les données de la 3D fondues dans ses rangées horaires (les heures sans données restent telles quelles).
export const mergeSceneWeather = (weather, scene) => {
  if (!weather || !weather.hourly || !scene) return weather;
  return { ...weather, hourly: weather.hourly.map((h) => (scene[h.time] ? { ...h, ...scene[h.time] } : h)) };
};
