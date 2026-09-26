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
