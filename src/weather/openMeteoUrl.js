// Relais Open-Meteo de l'app (api/om.js, forfait commercial): même origine sur le web, site en ligne dans l'app native.
const API_BASE = (typeof __MS_TARGET__ !== 'undefined' && __MS_TARGET__ === 'native') ? 'https://www.meteoshoot.com' : '';
export const openMeteoProxyUrl = (endpoint, qs) => `${API_BASE}/api/om?ep=${endpoint}&${qs}`;
