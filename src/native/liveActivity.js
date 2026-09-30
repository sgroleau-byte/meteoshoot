import { registerPlugin } from '@capacitor/core';
import { isNative, platform } from './platform.js';

// Activité en direct « Shooting du jour » (ios/App/App/ShootActivityPlugin.swift): l'app la démarre ou la met à
// jour avec l'état à afficher (dates en secondes depuis 1970), et la termine quand le projet est démarqué.
// Sans effet hors de l'app iOS.
const ShootActivity = registerPlugin('ShootActivity');
export const liveActivityAvailable = isNative && platform === 'ios';

export const startShootActivity = (projectId, state) => {
  if (!liveActivityAvailable) return;
  ShootActivity.start({ projectId, state: JSON.stringify(state) }).catch((e) => console.warn('Activité en direct:', e?.message || e));
};

export const endShootActivity = () => {
  if (!liveActivityAvailable) return;
  ShootActivity.end().catch(() => {});
};

// Événement solaire visé par la barre et le compte à rebours: le lever pour un projet du matin (visé jusqu'à une
// heure après), le coucher pour un projet du soir, sinon le prochain des deux; on regarde aujourd'hui puis demain.
// Retourne { date, isSunrise, day, barStart } ou null.
export const pickSunTarget = (daily, orientation) => {
  const now = Date.now();
  const am = !!orientation?.includes('AM'), pm = !!orientation?.includes('PM');
  for (const day of (daily || []).slice(0, 2)) {
    if (!day?.sunrise || !day?.sunset) continue;
    const sunrise = new Date(day.sunrise), sunset = new Date(day.sunset);
    const candidates = [];
    if (am || !pm) candidates.push({ until: sunrise.getTime() + 3600000, date: sunrise, isSunrise: true, day });
    if (pm || !am) candidates.push({ until: sunset.getTime(), date: sunset, isSunrise: false, day });
    const next = candidates.filter((c) => c.until > now).sort((a, b) => a.until - b.until)[0];
    // La barre de progression part du lever quand le coucher est visé, et de douze heures avant un lever.
    if (next) return { ...next, barStart: next.isSunrise ? new Date(next.date.getTime() - 12 * 3600000) : sunrise };
  }
  return null;
};
