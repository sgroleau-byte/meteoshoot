import { useEffect, useState } from 'react';
import { endShootActivity, sweepShootActivities } from './liveActivity.js';

// Shooting du jour: un seul projet, marqué par appui long sur sa carte dans la liste (téléphone).
// Rangé sur l'appareil seulement (localStorage): dans l'app iPhone, le projet marqué alimente l'activité en
// direct (voir liveActivity.js). Pas de synchronisation entre appareils pour l'instant.
const KEY = 'ms-shoot-of-day';
const listeners = new Set();

const read = () => {
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && v.projectId ? v : null; } catch (e) { return null; }
};
const write = (v) => {
  try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch (e) { /* stockage indisponible */ }
  listeners.forEach((fn) => fn(v));
};

export const getShootOfDay = read;
export const clearShootOfDay = () => write(null);

// Marque le projet; le marquer une seconde fois le démarque. Retourne true si le projet est marqué.
export const toggleShootOfDay = (projectId) => {
  const cur = read();
  if (cur && cur.projectId === projectId) { write(null); return false; }
  write({ projectId, markedAt: new Date().toISOString() });
  return true;
};

// Fin du shooting (endsAt, en ms): 30 min après son dernier événement solaire, fixée par la carte du projet quand elle
// démarre l'activité en direct. Passé cette heure, la marque s'efface et l'activité se termine: elle ne doit plus
// s'afficher une fois le shooting fini, ni revenir le lendemain.
// endsFor: l'orientation qui a servi au calcul; si elle change, la carte du projet recalcule la fin.
export const setShootOfDayEnd = (projectId, endsAt, endsFor) => {
  const cur = read();
  if (!cur || cur.projectId !== projectId || (cur.endsAt === endsAt && cur.endsFor === endsFor)) return;
  write({ ...cur, endsAt, endsFor });
};
const expireShootOfDay = () => {
  const cur = read();
  // Filet pour une marque sans heure de fin (posée avant v633.134, ou dont la carte n'est pas affichée: dossier replié):
  // au-delà de 30 h après le marquage, aucun shooting ne peut encore la concerner.
  const stale = cur && !cur.endsAt && cur.markedAt && Date.now() - new Date(cur.markedAt).getTime() > 30 * 3600000;
  if (cur && ((cur.endsAt && Date.now() >= cur.endsAt) || stale)) { write(null); endShootActivity(); }
  sweepShootActivities(); // côté iPhone: termine aussi une activité dont la fin est passée
};
if (typeof window !== 'undefined') {
  // À l'ouverture, au retour dans l'app et chaque minute tant qu'elle est ouverte.
  expireShootOfDay();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') expireShootOfDay(); });
  setInterval(expireShootOfDay, 60000);
}

export const useShootOfDay = () => {
  const [value, setValue] = useState(read);
  useEffect(() => { listeners.add(setValue); return () => listeners.delete(setValue); }, []);
  return value;
};
