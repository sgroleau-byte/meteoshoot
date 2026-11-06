// Témoins du ciel (6 novembre 2026): un photographe sur place note ce qu'il voit, avec une photo, l'heure et sa position.
// L'app fige au même moment ce qu'elle annonçait pour ce lieu et cette heure (forecast): les comparaisons futures se font
// sans rien recalculer, pour régler la prévision (brouillard des creux, nuages bas mal prévus). Données privées, table
// sky_reports (supabase/migrations/20261106120000_temoins_meteo.sql), photo dans le seau des fichiers de l'utilisateur.
import { STORAGE_BUCKET, TBL_SKY, supabase } from '../lib/supabase.js';
import { fetchWeather } from './api.js';

export const SKY_CHOICES = ['clear', 'clouds', 'overcast', 'fog', 'rain', 'snow'];
// Rayon de rattachement automatique à un projet (position du téléphone)
export const SKY_PROJECT_RADIUS_M = 1000;

const distanceM = (lat1, lng1, lat2, lng2) => {
  const r = Math.PI / 180, a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
};

// Projet le plus proche de la position, à moins de SKY_PROJECT_RADIUS_M; null sinon
export const nearestProject = (projects, lat, lng) => {
  let best = null, bestD = SKY_PROJECT_RADIUS_M;
  (projects || []).forEach((p) => {
    if (p.lat == null || p.lng == null) return;
    const d = distanceM(lat, lng, p.lat, p.lng);
    if (d <= bestD) { best = p; bestD = d; }
  });
  return best;
};

// Ce que l'app annonçait: l'heure en cours et la suivante (le rayonnement d'une heure est la moyenne de l'heure
// précédente), plus le jour (créneaux AM et PM). Ciel observé détaillé retiré (lourd, déjà résumé dans obsW).
const forecastSnapshot = async (lat, lng) => {
  try {
    const r = await fetchWeather(lat, lng);
    const d = r && r.data;
    if (!d || !d.hourly) return null;
    const now = Date.now();
    const i = d.hourly.findIndex((h) => new Date(h.time).getTime() > now);
    const pick = (h) => { if (!h) return null; const { obsLayers, ...rest } = h; return rest; };
    const today = new Date().toDateString(), day = (d.daily || []).find((x) => new Date(x.date + 'T12:00').toDateString() === today);
    return {
      fetchedAt: r.cachedAt || null, fromCache: !!r.fromCache,
      hours: [pick(d.hourly[i > 0 ? i - 1 : 0]), pick(i >= 0 ? d.hourly[i] : null)],
      day: day ? { date: day.date, cloudcover: day.cloudcover, sunFraction: day.sunFraction, cloudLow: day.cloudLow, icon: day.icon, model: day.model, am: day.am, pm: day.pm, sunrise: day.sunrise, sunset: day.sunset } : null,
    };
  } catch (e) { return null; }
};

// Photo ramenée à 2048 px au plus grand côté, en JPEG (une photo d'iPhone pèse 3 à 5 Mo; le ciel n'a pas besoin de plus)
const compressPhoto = (file) => new Promise((resolve) => {
  const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => {
    const k = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    c.toBlob((b) => resolve(b || file), 'image/jpeg', 0.85);
  };
  img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
  img.src = url;
});

// Enregistre un témoin. pos = { lat, lng, accuracy } (accuracy null si la position vient du projet). Rejette en cas d'échec.
export const saveSkyReport = async ({ sky, photo, pos, projectId }) => {
  const { data: { session } } = await supabase.auth.getSession();
  const uid = session && session.user && session.user.id;
  if (!uid) throw new Error('not-signed-in');
  const id = crypto.randomUUID();
  const forecast = await forecastSnapshot(pos.lat, pos.lng);
  let photoPath = null;
  if (photo) {
    const blob = await compressPhoto(photo);
    photoPath = `${uid}/temoins/${id}.jpg`;
    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(photoPath, blob, { contentType: 'image/jpeg' });
    if (error) throw error;
  }
  const appVersion = document.querySelector('.splash-version-num')?.textContent || null;
  const { error } = await supabase.from(TBL_SKY).insert({
    id, user_id: uid, observed_at: new Date().toISOString(), lat: pos.lat, lng: pos.lng, accuracy_m: pos.accuracy ?? null,
    project_id: projectId || null, sky, photo_path: photoPath, forecast, app_version: appVersion,
  });
  if (error) {
    if (photoPath) supabase.storage.from(STORAGE_BUCKET).remove([photoPath]);
    throw error;
  }
  return id;
};
