// Environs d'un lieu pour la vue 3D: bâtiments voisins (hauteur), rues, arbres, parcs, eau.
// Calculés une fois par lieu par la fonction serveur /api/scene3d (Overture Maps), puis gardés dans le
// cache partagé Supabase scene3d_cache; en mémoire le temps de la session.
import { supabase } from '../lib/supabase.js';

const mem = new Map();
const TBL = 'scene3d_cache'; // partagé, pas de variante dev
const API_BASE = (typeof __MS_TARGET__ !== 'undefined' && __MS_TARGET__ === 'native') ? 'https://meteoshoot.com' : '';

export const sceneKey = (lat, lng) => `${Number(lat).toFixed(5)}_${Number(lng).toFixed(5)}`;

export function loadScene(lat, lng) {
  const key = sceneKey(lat, lng);
  if (mem.has(key)) return mem.get(key);
  const la = Number(Number(lat).toFixed(5)), ln = Number(Number(lng).toFixed(5));
  const p = (async () => {
    try {
      const { data } = await supabase.from(TBL).select('data').eq('key', key).maybeSingle();
      if (data?.data?.bld) return data.data;
    } catch (e) { /* cache indisponible: on calcule */ }
    const res = await fetch(`${API_BASE}/api/scene3d?lat=${la}&lng=${ln}`);
    if (!res.ok) throw new Error('scene3d ' + res.status);
    const scene = await res.json();
    if (!scene?.bld) throw new Error('scene3d: réponse invalide');
    delete scene.ms;
    try { await supabase.from(TBL).insert({ key, lat: la, lng: ln, version: 1, data: scene }); } catch (e) { /* non connecté ou déjà en cache */ }
    return scene;
  })();
  mem.set(key, p);
  p.catch(() => mem.delete(key));
  return p;
}
