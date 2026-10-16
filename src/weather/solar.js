// Direct par ciel clair (15 octobre 2026): même référence que la vue 3D (src/scene3d/engine.js, dniClear et dniRef), pour
// rapporter le direct prévu ou corrigé au direct d'un ciel sans nuages (part de l'heure au soleil).
import SunCalc from 'suncalc';

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const dniClear = (h) => 950 - 710 * Math.exp(-h / 20.2); // direct normal par ciel clair (W/m²), ICON, Québec, été 2025
// Au soleil bas: modèle de Meinel (masse d'air de Kasten et Young), raccordé à dniClear entre 8 et 20°
export const dniRef = (h) => { const amk = 1 / (Math.sin(h * Math.PI / 180) + 0.50572 * Math.pow(h + 6.07995, -1.6364)), me = 1353 * Math.pow(0.7, Math.pow(amk, 0.678)); return me + (dniClear(h) - me) * smooth(8, 20, h); };
// Direct horizontal moyen par ciel clair sur l'heure qui finit à tEnd (moyenne de l'heure précédente, comme Open-Meteo)
export function clearDirHour(tEnd, lat, lng) {
  let t = 0;
  for (let k = 0; k < 12; k++) { const h = SunCalc.getPosition(new Date(tEnd - 3600000 + (k + 0.5) * 300000), lat, lng).altitude * 180 / Math.PI; if (h > 0) t += Math.sin(h * Math.PI / 180) * dniRef(h); }
  return t / 12;
}
export const sunElevation = (ms, lat, lng) => SunCalc.getPosition(new Date(ms), lat, lng).altitude * 180 / Math.PI;
