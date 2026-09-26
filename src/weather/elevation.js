import { TBL_ELEVATION, supabase } from '../lib/supabase.js';

// ===== TERRAIN ELEVATION PROFILE =====
// Fetches horizon profile around a point (24 directions, 3km radius)
// Returns array of {bearing, maxAngle} where maxAngle = max elevation angle in degrees
export const ELEV_GRID_PRECISION = 3; // ~111m grid cells
export const ELEV_PROFILE_VERSION = 3; // bump to invalidate cache
export const ELEV_DIRECTIONS = 36; // every 10°
export const ELEV_SAMPLES = 50; // points per direction
export const ELEV_RADIUS_M = 5000; // 5km

export const roundGrid = (v) => parseFloat(v.toFixed(ELEV_GRID_PRECISION));

export const getElevationProfile = async (lat, lng) => {
  const gLat = roundGrid(lat), gLng = roundGrid(lng);
  
  // Check Supabase cache
  try {
    const { data } = await supabase.from(TBL_ELEVATION)
      .select('profile, version')
      .eq('grid_lat', gLat).eq('grid_lng', gLng)
      .maybeSingle();
    if (data?.profile && data?.version === ELEV_PROFILE_VERSION) return data.profile;
  } catch(e) { console.warn('Elevation cache read error:', e); }
  
  // Build sample points: 36 directions × 50 points
  // Non-linear: dense near (every 15m for first 200m), then spread out to 5km
  const R = 6371000;
  const allLats = [], allLngs = [], meta = [];
  
  const getSampleDist = (s, total) => {
    if (s < 13) return 15 + s * 15; // 15m to 195m (every 15m)
    const t = (s - 13) / (total - 13);
    return 200 + t * (ELEV_RADIUS_M - 200);
  };
  
  for (let d = 0; d < ELEV_DIRECTIONS; d++) {
    const bearing = (d * 360 / ELEV_DIRECTIONS) * Math.PI / 180;
    for (let s = 0; s < ELEV_SAMPLES; s++) {
      const dist = getSampleDist(s, ELEV_SAMPLES);
      const dLat = (dist * Math.cos(bearing)) / R * (180 / Math.PI);
      const dLng = (dist * Math.sin(bearing)) / (R * Math.cos(lat * Math.PI / 180)) * (180 / Math.PI);
      allLats.push(lat + dLat);
      allLngs.push(lng + dLng);
      meta.push({ dir: d, dist });
    }
  }
  
  // Fetch observer elevation first
  let observerElev = 0;
  try {
    const res = await fetch('https://api.open-elevation.com/api/v1/lookup', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ locations: [{ latitude: lat, longitude: lng }] })
    });
    const j = await res.json();
    observerElev = j.results?.[0]?.elevation ?? 0;
  } catch(e) { 
    // Fallback to Open-Meteo
    try {
      const res2 = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lng}`);
      const j2 = await res2.json();
      observerElev = j2.elevation?.[0] ?? j2.elevation ?? 0;
    } catch(e2) { console.warn('Observer elevation error:', e2); return null; }
  }
  
  // Fetch all sample elevations in batches
  const elevations = new Array(allLats.length).fill(0);
  const batchSize = 200; // Open-Elevation can handle larger batches
  
  for (let i = 0; i < allLats.length; i += batchSize) {
    const locations = [];
    for (let k = i; k < Math.min(i + batchSize, allLats.length); k++) {
      locations.push({ latitude: parseFloat(allLats[k].toFixed(6)), longitude: parseFloat(allLngs[k].toFixed(6)) });
    }
    try {
      const res = await fetch('https://api.open-elevation.com/api/v1/lookup', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ locations })
      });
      const j = await res.json();
      if (j.results) {
        for (let k = 0; k < j.results.length; k++) {
          elevations[i + k] = j.results[k].elevation ?? 0;
        }
      }
      if (i + batchSize < allLats.length) await new Promise(r => setTimeout(r, 200));
    } catch(e) {
      // Fallback to Open-Meteo for this batch
      console.warn('[ELEVATION] Open-Elevation failed, trying Open-Meteo fallback');
      const bLats = allLats.slice(i, i + batchSize).map(v => v.toFixed(5)).join(',');
      const bLngs = allLngs.slice(i, i + batchSize).map(v => v.toFixed(5)).join(',');
      try {
        const res2 = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${bLats}&longitude=${bLngs}`);
        const j2 = await res2.json();
        const elArr = Array.isArray(j2.elevation) ? j2.elevation : [j2.elevation];
        for (let k = 0; k < elArr.length; k++) elevations[i + k] = elArr[k] ?? 0;
      } catch(e2) { console.warn('Elevation fallback error:', e2); }
      if (i + batchSize < allLats.length) await new Promise(r => setTimeout(r, 100));
    }
  }
  
  // Compute max elevation angle per direction
  const profile = [];
  for (let d = 0; d < ELEV_DIRECTIONS; d++) {
    let maxAngle = 0;
    const bearing = d * 360 / ELEV_DIRECTIONS;
    for (let s = 0; s < ELEV_SAMPLES; s++) {
      const idx = d * ELEV_SAMPLES + s;
      const elevDiff = elevations[idx] - observerElev;
      if (elevDiff > 0) {
        const angle = Math.atan2(elevDiff, meta[idx].dist) * 180 / Math.PI;
        if (angle > maxAngle) maxAngle = angle;
      }
    }
    profile.push({ bearing, maxAngle: parseFloat(maxAngle.toFixed(2)) });
  }
  
  // Cache in Supabase
  try {
    await supabase.from(TBL_ELEVATION).upsert({
      grid_lat: gLat, grid_lng: gLng, profile, observer_elevation: observerElev, version: ELEV_PROFILE_VERSION
    }, { onConflict: 'grid_lat,grid_lng' });
  } catch(e) { console.warn('Elevation cache write error:', e); }
  
  return profile;
};

// Check if sun is behind terrain at given bearing + altitude
// Returns: 'shadow' | 'warning' | false
// 30 min ≈ 7.5° of sun altitude change near horizon
export const isTerrainShadow = (profile, sunBearingDeg, sunAltDeg) => {
  if (!profile) return false;
  if (sunAltDeg <= 0) return false;
  const step = 360 / ELEV_DIRECTIONS;
  const idx = ((sunBearingDeg % 360) + 360) % 360;
  const i0 = Math.floor(idx / step) % ELEV_DIRECTIONS;
  const i1 = (i0 + 1) % ELEV_DIRECTIONS;
  const frac = (idx / step) - Math.floor(idx / step);
  const horizonAngle = profile[i0].maxAngle * (1 - frac) + profile[i1].maxAngle * frac;
  if (horizonAngle <= 0) return false;
  if (sunAltDeg < horizonAngle) return 'shadow';
  return false;
};
