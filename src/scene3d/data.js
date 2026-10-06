// Environs d'un lieu pour la vue 3D: bâtiments voisins (hauteur), rues (avec leur nom), arbres, parcs, eau.
// Calculés une fois par lieu par la fonction serveur /api/scene3d (Overture Maps), puis gardés dans le
// cache partagé Supabase scene3d_cache; en mémoire le temps de la session. Une entrée d'une version
// antérieure est recalculée et remplacée.
import { supabase } from '../lib/supabase.js';

const mem = new Map();
const TBL = 'scene3d_cache'; // partagé, pas de variante dev
const SCENE_V = 4; // v2: noms de rues; v3: surfaces pavées d'après l'imagerie satellite; v4: leurs trous, asphalte mieux capté
const API_BASE = (typeof __MS_TARGET__ !== 'undefined' && __MS_TARGET__ === 'native') ? 'https://www.meteoshoot.com' : '';

export const sceneKey = (lat, lng) => `${Number(lat).toFixed(5)}_${Number(lng).toFixed(5)}`;

export function loadScene(lat, lng) {
  const key = sceneKey(lat, lng);
  if (mem.has(key)) return mem.get(key);
  const la = Number(Number(lat).toFixed(5)), ln = Number(Number(lng).toFixed(5));
  const p = (async () => {
    let stale = false;
    try {
      const { data } = await supabase.from(TBL).select('data').eq('key', key).maybeSingle();
      if (data?.data?.bld) { if ((data.data.v || 1) >= SCENE_V) return data.data; stale = true; }
    } catch (e) { /* cache indisponible: on calcule */ }
    // v dans l'adresse: la réponse est gardée 24 h par le navigateur, une nouvelle version ne doit pas tomber sur l'ancienne.
    const url = `${API_BASE}/api/scene3d?lat=${la}&lng=${ln}&v=${SCENE_V}`;
    let res = await fetch(url);
    if (!res.ok) throw new Error('scene3d ' + res.status);
    let scene = await res.json();
    // Réponse d'une version antérieure gardée par le navigateur (24 h): on la redemande au serveur une fois.
    if (scene?.bld && (scene.v || 1) < SCENE_V) { res = await fetch(url, { cache: 'reload' }); if (res.ok) scene = await res.json(); }
    if (!scene?.bld) throw new Error('scene3d: réponse invalide');
    delete scene.ms;
    try {
      if (stale) await supabase.from(TBL).update({ version: SCENE_V, data: scene }).eq('key', key);
      else await supabase.from(TBL).insert({ key, lat: la, lng: ln, version: SCENE_V, data: scene });
    } catch (e) { /* non connecté ou déjà en cache */ }
    return scene;
  })();
  mem.set(key, p);
  p.catch(() => mem.delete(key));
  return p;
}
