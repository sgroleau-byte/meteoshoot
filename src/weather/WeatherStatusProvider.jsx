import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// ===== WEATHER STATUS =====
// Aggregateur de l'etat des appels meteo. Chaque ProjectCard rapporte son resultat ici via
// reportWeather(projectId, { state, error, cachedAt }). On en derive un bannerError affiche
// au-dessus de la liste de projets quand il y a au moins une carte sans donnees exploitables.
//   state = 'ok'    -> donnees fraiches (succes API)
//   state = 'stale' -> donnees de cache local (API en panne mais on a une copie)
//   state = 'error' -> aucune donnee a montrer pour cette carte
export const WeatherStatusContext = createContext({ reportWeather: () => {}, clearWeather: () => {}, bannerError: null, lastCachedAt: null });
export const useWeatherStatus = () => useContext(WeatherStatusContext);

export const WeatherStatusProvider = ({ children }) => {
  // Map projectId -> { state, error, cachedAt }. On garde un useRef pour eviter les re-renders
  // en cascade quand 10 cartes rapportent en meme temps, et on synchronise un state derivé.
  const reportsRef = useRef({});
  const [bannerError, setBannerError] = useState(null);
  const [lastCachedAt, setLastCachedAt] = useState(null);

  const recompute = useCallback(() => {
    const reports = Object.values(reportsRef.current);
    // On signale une banniere des qu'au moins une carte est en mode degrade:
    // 'stale' (donnees en cache, API morte) ou 'error' (aucune donnee a afficher).
    // L'API qui marche pour certains et pas d'autres reste un cas "API en panne" du point
    // de vue de l'utilisateur, on prefere la transparence a un faux sentiment de normalite.
    const degraded = reports.filter((r) => r && (r.state === 'stale' || r.state === 'error'));
    if (degraded.length === 0) { setBannerError(null); setLastCachedAt(null); return; }
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const allNetwork = degraded.every((r) => r.error === 'network');
    setBannerError(offline || allNetwork ? 'network' : 'api');
    // Pour la mention "derniere mise a jour il y a XX": on prend le timestamp du cache
    // le PLUS RECENT parmi les cartes degradees (la derniere fois ou ca a marche).
    const stales = degraded.filter((r) => r.state === 'stale' && r.cachedAt);
    const latest = stales.reduce((acc, r) => (r.cachedAt > acc ? r.cachedAt : acc), 0);
    setLastCachedAt(latest || null);
  }, []);

  const reportWeather = useCallback((projectId, payload) => {
    if (!projectId) return;
    reportsRef.current[projectId] = payload;
    recompute();
  }, [recompute]);

  const clearWeather = useCallback((projectId) => {
    if (!projectId) return;
    delete reportsRef.current[projectId];
    recompute();
  }, [recompute]);

  // Si la connexion revient/part, on recalcule sans attendre un nouveau fetch.
  useEffect(() => {
    const onChange = () => recompute();
    window.addEventListener('online', onChange);
    window.addEventListener('offline', onChange);
    return () => {
      window.removeEventListener('online', onChange);
      window.removeEventListener('offline', onChange);
    };
  }, [recompute]);

  return <WeatherStatusContext.Provider value={{ reportWeather, clearWeather, bannerError, lastCachedAt }}>{children}</WeatherStatusContext.Provider>;
};
