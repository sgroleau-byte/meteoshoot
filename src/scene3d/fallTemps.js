// Gel de l'automne en cours pour le calendrier du feuillage de la vue 3D (season.js, fallFromTemps): minimum de chaque
// jour des 92 derniers jours et des 16 prochains, par le relais Open-Meteo de l'app (forfait commercial; l'archive
// demanderait le forfait Professional). Un appel par lieu (coordonnées au centième de degré, 1 km) et par session.
import { fetchOpenMeteoModel } from '../weather/api.js';

const mem = new Map();

export function loadFallTemps(lat, lng) {
  const la = Number(lat).toFixed(2), ln = Number(lng).toFixed(2), key = la + ',' + ln;
  if (mem.has(key)) return mem.get(key);
  const p = fetchOpenMeteoModel('forecast', `latitude=${la}&longitude=${ln}&daily=temperature_2m_min&past_days=92&forecast_days=16&timezone=auto`)
    .then((r) => {
      const d = r && r.data && r.data.daily;
      if (!d || !Array.isArray(d.time) || !d.time.length) throw new Error('températures: ' + ((r && (r.status || r.error)) || 'réponse vide'));
      return { from: d.time[0], tmin: d.temperature_2m_min };
    });
  mem.set(key, p);
  p.catch(() => mem.delete(key));
  return p;
}
