import { registerPlugin } from '@capacitor/core';
import { isNative, platform } from './platform.js';

// Activité en direct « Shooting du jour » (ios/App/App/ShootActivityPlugin.swift): l'app la démarre ou la met à
// jour avec l'état à afficher (dates en secondes depuis 1970), et la termine quand le projet est démarqué.
// Sans effet hors de l'app iOS.
const ShootActivity = registerPlugin('ShootActivity');
export const liveActivityAvailable = isNative && platform === 'ios';
// Annonces vocales: iPhone seulement (inutiles sur iPad et Mac, Stéphane le 21 octobre 2026).
export const announceAvailable = liveActivityAvailable && /iPhone/.test(navigator.userAgent);

export const startShootActivity = (projectId, state) => {
  if (!liveActivityAvailable) return;
  ShootActivity.start({ projectId, state: JSON.stringify(state) }).catch((e) => console.warn('Activité en direct:', e?.message || e));
};

// Annonces vocales du coucher ou du lever visé (ShootAnnouncer.swift): programmées avec l'activité, selon la préférence.
export const announceSunEvent = (targetDate, isSunrise, enabled) => {
  if (!announceAvailable) return;
  ShootActivity.announce({ targetDate: Math.round(new Date(targetDate).getTime() / 1000), isSunrise: !!isSunrise, enabled: enabled !== false }).catch(() => {});
};

export const endShootActivity = () => {
  if (!liveActivityAvailable) return;
  ShootActivity.end().catch(() => {});
};

// Termine les activités dont le shooting est fini (iOS ne laisse pas l'app fermée le faire à l'heure exacte).
export const sweepShootActivities = () => {
  if (!liveActivityAvailable) return;
  ShootActivity.sweep().catch(() => {});
};

// Entrée horaire de la prévision pour un événement solaire, comme la bande horaire de la fiche: l'heure du coucher
// (ses nuages et son rayonnement sont la moyenne de l'heure qui le précède), l'heure qui suit un lever (sa moyenne
// couvre le lever; celle d'avant est encore la nuit). null sans prévision horaire.
export const hourAt = (hourly, date, isSunrise) => {
  if (!hourly?.length || !date) return null;
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  if (isSunrise) d.setHours(d.getHours() + 1);
  const ms = d.getTime();
  return hourly.find((h) => new Date(h.time).getTime() === ms) || null;
};

// Suivi du trajet en direct (ShootTripTracker.swift): lieu du shooting, distance du trajet planifié depuis la maison
// (base de l'avancement), et si la position actuelle est connue, distance restante et avancement au démarrage. Le
// rapport route / vol d'oiseau sert ensuite au natif pour estimer la distance restante sans appel réseau.
const straightMeters = (a, b) => {
  const R = 6371000, toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
export const tripState = (project, travel, here) => {
  if (!project?.lat || !project?.lng) return {};
  const total = project.travelTime?.distanceMeters || travel?.distanceMeters || null;
  const out = { destLat: project.lat, destLng: project.lng, travelMeters: total };
  if (here && travel?.distanceMeters && total) {
    const straight = straightMeters(here, { lat: project.lat, lng: project.lng });
    out.remainingMeters = travel.distanceMeters;
    out.roadFactor = straight > 500 ? Math.min(2, Math.max(1, travel.distanceMeters / straight)) : 1.3;
    out.routeProgress = Math.min(1, Math.max(0, 1 - travel.distanceMeters / total));
  }
  return out;
};

// Fin du shooting: 30 min après son dernier événement solaire, le jour de l'événement visé: le lever pour un projet
// du matin seulement, sinon le coucher (projet du soir, matin et soir, ou sans orientation). En ms.
export const SHOOT_END_DELAY_MS = 30 * 60000;
export const shootEndTime = (target, orientation) => {
  const am = !!orientation?.includes('AM'), pm = !!orientation?.includes('PM');
  const last = am && !pm ? target.day.sunrise : target.day.sunset;
  return new Date(last).getTime() + SHOOT_END_DELAY_MS;
};

// Événement solaire visé par la barre et le compte à rebours: le lever pour un projet du matin (visé jusqu'à la fin
// du shooting, 30 min après, pour qu'une marque posée plus tard vise le lendemain au lieu d'une fin déjà passée), le
// coucher pour un projet du soir, sinon le prochain des deux; on regarde aujourd'hui puis demain.
// Retourne { date, isSunrise, day, barStart } ou null.
// now: moment de référence (par défaut maintenant; le moment du marquage pour fixer la fin du shooting).
export const pickSunTarget = (daily, orientation, now = Date.now()) => {
  const am = !!orientation?.includes('AM'), pm = !!orientation?.includes('PM');
  for (const day of (daily || []).slice(0, 3)) {
    if (!day?.sunrise || !day?.sunset) continue;
    const sunrise = new Date(day.sunrise), sunset = new Date(day.sunset);
    const candidates = [];
    if (am || !pm) candidates.push({ until: sunrise.getTime() + SHOOT_END_DELAY_MS, date: sunrise, isSunrise: true, day });
    if (pm || !am) candidates.push({ until: sunset.getTime(), date: sunset, isSunrise: false, day });
    const next = candidates.filter((c) => c.until > now).sort((a, b) => a.until - b.until)[0];
    // La barre de progression part du lever quand le coucher est visé, et de douze heures avant un lever.
    if (next) return { ...next, barStart: next.isSunrise ? new Date(next.date.getTime() - 12 * 3600000) : sunrise };
  }
  return null;
};
