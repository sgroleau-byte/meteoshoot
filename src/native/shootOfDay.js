import { useEffect, useState } from 'react';

// Shooting du jour: un seul projet, marqué par appui long sur sa carte dans la liste (téléphone).
// Rangé sur l'appareil seulement (localStorage): le widget iPhone affiche ce que l'app lui dépose
// (voir widget.js). Pas de synchronisation entre appareils pour l'instant.
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

// Marque le projet; le marquer une seconde fois le démarque. Retourne true si le projet est marqué.
export const toggleShootOfDay = (projectId) => {
  const cur = read();
  if (cur && cur.projectId === projectId) { write(null); return false; }
  write({ projectId, markedAt: new Date().toISOString() });
  return true;
};

export const useShootOfDay = () => {
  const [value, setValue] = useState(read);
  useEffect(() => { listeners.add(setValue); return () => listeners.delete(setValue); }, []);
  return value;
};
