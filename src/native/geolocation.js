// Position de l'appareil: Capacitor en natif (permission « Lorsque l'app est active » réutilisée
// d'un lancement à l'autre), navigator.geolocation sur le web (comportement inchangé).
import { Geolocation } from '@capacitor/geolocation';
import { isNative } from './platform.js';

const normalize = (state) => (state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'prompt');

// 'granted' | 'denied' | 'prompt'
export async function checkLocationPermission() {
  if (isNative) {
    try { const s = await Geolocation.checkPermissions(); return normalize(s.location); } catch (e) { return 'prompt'; }
  }
  return localStorage.getItem('geo-permission') === 'granted' ? 'granted' : 'prompt';
}

// Promesse résolue avec { coords: { latitude, longitude } }; rejetée avec err.code 'unsupported' (web sans
// géolocalisation) ou 1 (permission refusée), comme l'API du navigateur.
export function getCurrentPosition(options) {
  if (isNative) {
    return (async () => {
      let s = await Geolocation.checkPermissions();
      if (s.location !== 'granted') s = await Geolocation.requestPermissions({ permissions: ['location'] });
      if (s.location !== 'granted') { const err = new Error('Geolocation permission denied'); err.code = 1; throw err; }
      return Geolocation.getCurrentPosition(options);
    })();
  }
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { const err = new Error('Geolocation unsupported'); err.code = 'unsupported'; return reject(err); }
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}
