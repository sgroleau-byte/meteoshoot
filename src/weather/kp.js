
// Indice Kp (activité géomagnétique, aurores): estimation à la minute de la NOAA (SWPC).
// Valeur entière du dernier relevé; cache de 10 min en localStorage; null si injoignable.
export const KP_CACHE_KEY = 'sp-kp-cache';
export const KP_TTL_MS = 10 * 60 * 1000;
export const fetchKp = async () => {
  try {
    const c = JSON.parse(localStorage.getItem(KP_CACHE_KEY) || 'null');
    if (c && typeof c.kp === 'number' && (Date.now() - c.ts) < KP_TTL_MS) return c.kp;
  } catch (e) { /* cache illisible: on ignore */ }
  try {
    const res = await fetch('https://services.swpc.noaa.gov/json/planetary_k_index_1m.json');
    if (!res.ok) return null;
    const arr = await res.json();
    const last = Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null;
    const kp = last && last.kp_index != null ? Math.round(Number(last.kp_index)) : null;
    if (kp == null || Number.isNaN(kp)) return null;
    try { localStorage.setItem(KP_CACHE_KEY, JSON.stringify({ kp, ts: Date.now() })); } catch (e) { /* quota plein, on ignore */ }
    return kp;
  } catch (e) { return null; }
};
