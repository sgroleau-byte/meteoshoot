import { formatDuration } from '../utils/dates.js';

// ===== GOOGLE MAPS API =====
export const GOOGLE_API_KEY = __GOOGLE_MAPS_KEY__; // injectée à la compilation (google-maps-keys.json, web ou native)

// === API Call Caches (reduce Google Maps billing) ===
export const _geocodeCache = {};
export const _reverseGeocodeCache = {};
export const _travelTimeCache = {};

export const geocodeAddress = (address) => {
  const cacheKey = address.trim().toLowerCase();
  if (_geocodeCache[cacheKey]) { return Promise.resolve(_geocodeCache[cacheKey]); }
  return new Promise((resolve, reject) => {
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ address, region: 'ca' }, (results, status) => {
      if (status === 'OK' && results[0]) {
        const loc = results[0].geometry.location;
        const result = { lat: loc.lat(), lng: loc.lng(), formattedAddress: results[0].formatted_address };
        _geocodeCache[cacheKey] = result;
        resolve(result);
      } else {
        reject(new Error('Adresse non trouvée'));
      }
    });
  });
};

export const reverseGeocode = (lat, lng) => {
  const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (_reverseGeocodeCache[cacheKey]) { return Promise.resolve(_reverseGeocodeCache[cacheKey]); }
  return new Promise((resolve) => {
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      const addr = (status === 'OK' && results[0]) ? results[0].formatted_address : lat.toFixed(5) + ', ' + lng.toFixed(5);
      const result = { formattedAddress: addr, results: results || [] };
      _reverseGeocodeCache[cacheKey] = result;
      resolve(result);
    });
  });
};

export const getTravelTime = (originLat, originLng, destLat, destLng) => {
  const cacheKey = `${originLat.toFixed(3)},${originLng.toFixed(3)}→${destLat.toFixed(3)},${destLng.toFixed(3)}`;
  if (_travelTimeCache[cacheKey]) { return Promise.resolve(_travelTimeCache[cacheKey]); }
  return new Promise((resolve, reject) => {
    const service = new google.maps.DistanceMatrixService();
    service.getDistanceMatrix({
      origins: [{ lat: originLat, lng: originLng }],
      destinations: [{ lat: destLat, lng: destLng }],
      travelMode: 'DRIVING',
      drivingOptions: { departureTime: new Date(Date.now() + 86400000) } // Tomorrow
    }, (response, status) => {
      if (status === 'OK' && response.rows[0]?.elements[0]?.status === 'OK') {
        const element = response.rows[0].elements[0];
        const result = { durationSeconds: element.duration.value, durationText: element.duration.text, distanceMeters: element.distance.value, distanceText: element.distance.text };
        _travelTimeCache[cacheKey] = result;
        resolve(result);
      } else {
        // Fallback: calculate straight line with estimate
        const R = 6371;
        const dLat = (destLat - originLat) * Math.PI / 180;
        const dLon = (destLng - originLng) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(originLat * Math.PI / 180) * Math.cos(destLat * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        const distance = R * c;
        const durationSeconds = Math.round((distance / 80) * 3600); // ~80km/h average
        const result = { durationSeconds, durationText: formatDuration(durationSeconds), distanceMeters: distance * 1000, distanceText: `${Math.round(distance)} km` };
        _travelTimeCache[cacheKey] = result;
        resolve(result);
      }
    });
  });
};

// Champ d'adresse avec suggestions Google: une adresse tapée sans choisir de suggestion n'est plus perdue. Elle est
// confiée à commit(texte) quand on appuie sur Entrée (Google renvoie alors un lieu sans coordonnées, avec le texte
// dans name) ou quand on quitte le champ. Le choix d'une suggestion reste prioritaire: cliquer ou toucher une
// suggestion fait sortir du champ avant que Google renvoie le lieu (parfois plus d'une seconde sur un réseau mobile):
// cette sortie-là est ignorée, place_changed décide. Après un choix, le texte de la suggestion reste dans le champ:
// le quitter sans le modifier n'enregistre rien de plus. Retourne de quoi tout détacher.
export function typedAddressFallback(input, autocomplete, commit) {
  let lastPick = 0, pickedText = null, pacDown = 0;
  const pick = autocomplete.addListener('place_changed', () => {
    lastPick = Date.now();
    const place = autocomplete.getPlace();
    if (!place || !place.geometry) commit(((place && place.name) || input.value || '').trim());
    else pickedText = (input.value || '').trim();
  });
  const onPac = (e) => { if (e.target && e.target.closest && e.target.closest('.pac-container')) pacDown = Date.now(); };
  const onBlur = () => {
    const t0 = Date.now();
    if (t0 - pacDown < 1000) return;
    setTimeout(() => { const v = (input.value || '').trim(); if (lastPick < t0 && v !== pickedText) commit(v); }, 400);
  };
  input.addEventListener('blur', onBlur);
  document.addEventListener('mousedown', onPac, true);
  document.addEventListener('touchstart', onPac, true);
  return () => {
    pick.remove(); input.removeEventListener('blur', onBlur);
    document.removeEventListener('mousedown', onPac, true); document.removeEventListener('touchstart', onPac, true);
  };
}
