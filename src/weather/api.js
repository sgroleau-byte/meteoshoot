import { SHOOT_WINDOWS, isGoodWeather, sunlitFraction, weatherCodeIcon } from './iconsLogic.js';

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
export const readWeatherCache = (lat, lng) => {
  try {
    const all = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) || '{}');
    const entry = all[weatherCacheKey(lat, lng)];
    if (!entry || !entry.data || !entry.cachedAt) return null;
    if (Date.now() - entry.cachedAt > WEATHER_CACHE_TTL_MS) return null;
    return entry;
  } catch (e) { return null; }
};
export const writeWeatherCache = (lat, lng, data) => {
  try {
    const all = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) || '{}');
    all[weatherCacheKey(lat, lng)] = { data, cachedAt: Date.now() };
    // Garde-fou taille: si plus de 50 entrees, on coupe les plus vieilles.
    const entries = Object.entries(all);
    if (entries.length > 50) {
      entries.sort((a, b) => (b[1].cachedAt || 0) - (a[1].cachedAt || 0));
      const trimmed = Object.fromEntries(entries.slice(0, 50));
      localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(trimmed));
    } else {
      localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(all));
    }
  } catch (e) { /* quota plein, on ignore */ }
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
const fetchOpenMeteoOnce = async (url) => {
  let res;
  try {
    res = await fetch(url);
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
    return { error: 'api', status: 'invalid' };
  }
  if (!body || !body.hourly) {
    return { error: 'api', status: 'invalid' };
  }
  return { data: body };
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
    for (let attempt = 0; ; attempt++) {
      // La pause se fait hors de la file, pour ne pas bloquer une place pendant l'attente.
      const result = await withOpenMeteoSlot(() => fetchOpenMeteoOnce(url));
      if (result.status !== 429 || attempt >= OPEN_METEO_RETRY_MS.length) return result;
      await new Promise((resolve) => setTimeout(resolve, OPEN_METEO_RETRY_MS[attempt] + Math.random() * 400));
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
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();              // une erreur GeoMet est renvoyee en XML -> throw -> catch
    const p = j.features && j.features[0] && j.features[0].properties;
    if (!p || p.value == null) return null;
    return p.value * 1e9;                  // kg/m3 -> microgrammes/m3
  } catch (e) { return null; }
};
// Niveau de fumee par jour (cle "YYYY-MM-DD" locale) pour aujourd'hui + 3 jours. Jamais bloquant:
// tout echec (hors saison, reseau, pas de couche) laisse simplement le jour sans fumee.
export const fetchSmoke = async (lat, lng) => {
  const inner = (async () => {
    const out = {};
    const base = new Date();
    const jobs = [0, 1, 2, 3].map(async (i) => {
      const dt = new Date(base.getTime() + i * 86400000);
      const dateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      let ug = await fetchSmokePoint(SMOKE_DAVG, `${dateStr}T12:00:00Z`, lat, lng);
      if (ug == null && i === 0) {           // aujourd'hui n'est pas couvert par la moyenne journaliere
        const h = new Date();
        const hUTC = `${h.getUTCFullYear()}-${String(h.getUTCMonth() + 1).padStart(2, '0')}-${String(h.getUTCDate()).padStart(2, '0')}T${String(h.getUTCHours()).padStart(2, '0')}:00:00Z`;
        ug = await fetchSmokePoint(SMOKE_HOURLY, hUTC, lat, lng);
      }
      if (ug != null) out[dateStr] = smokeLevelFromUg(ug);
    });
    await Promise.all(jobs);
    return out;
  })();
  // Filet: si GeoMet rame, on n'attend pas plus de 7 s pour ne pas retarder la meteo.
  return Promise.race([inner, new Promise((res) => setTimeout(() => res({}), 7000))]).catch(() => ({}));
};

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
  const qs = `latitude=${lat}&longitude=${lng}&hourly=temperature_2m,weathercode,windspeed_10m,windgusts_10m,cloudcover,precipitation,precipitation_probability,direct_radiation,diffuse_radiation,cloudcover_low,cloudcover_mid,cloudcover_high&daily=weathercode,temperature_2m_max,temperature_2m_min,sunrise,sunset&timezone=America/Toronto&forecast_days=10`;
  const [iconRes, gfsRes, smokeMap] = await Promise.all([
    fetchOpenMeteoModel('dwd-icon', qs),
    fetchOpenMeteoModel('gfs', qs),
    fetchSmoke(lat, lng),   // ne rejette jamais: {} si pas de fumee / hors saison / panne
  ]);
  const icon = iconRes.data || null;
  const gfs = gfsRes.data || null;

  const HOURLY_KEYS = ['temperature_2m', 'weathercode', 'windspeed_10m', 'windgusts_10m', 'cloudcover', 'precipitation', 'precipitation_probability', 'direct_radiation', 'diffuse_radiation', 'cloudcover_low', 'cloudcover_mid', 'cloudcover_high'];
  const DAILY_KEYS = ['weathercode', 'temperature_2m_max', 'temperature_2m_min', 'sunrise', 'sunset'];
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
    if (cached) {
      return { data: cached.data, fromCache: true, cachedAt: cached.cachedAt, error: chosen.error, status: chosen.status };
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

  hourlyTimes.forEach((t) => {
    const useIcon = iconOk && dateOf(t) <= lastIconDate && (t in iconHourIdx);
    const src = useIcon ? icon : gfs;
    const si = useIcon ? iconHourIdx[t] : gfsHourIdx[t];
    data.hourly.time.push(t);
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
    hourly: data.hourly.time.map((t,i) => ({ time: t, temp: Math.round(data.hourly.temperature_2m[i]), wind: Math.round(data.hourly.windspeed_10m[i]), gust: data.hourly.windgusts_10m?.[i] != null ? Math.round(data.hourly.windgusts_10m[i]) : null, cloudcover: data.hourly.cloudcover[i], precip: data.hourly.precipitation?.[i] ?? 0, precipProb: data.hourly.precipitation_probability?.[i] ?? null, sunFraction: sunlitFraction(data.hourly.direct_radiation?.[i], data.hourly.diffuse_radiation?.[i]), cloudLow: data.hourly.cloudcover_low?.[i] ?? null, smoke: smokeMap[dateOf(t)] || 0, icon: weatherCodeIcon[data.hourly.weathercode[i]] || 'cloudy', isGood: isGoodWeather(data.hourly.weathercode[i]) })),
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
  if (iconOk && gfsOk) weatherMemCache.set(memKey, { data: formatted, fetchedAt });
  return { data: formatted, fromCache: false, cachedAt: fetchedAt };
};
