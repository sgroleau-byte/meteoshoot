// Modèle 3D importé gardé en ligne (Supabase), pour le retrouver sur tous les appareils: fichier GLB dans le seau des
// fichiers de projet (<utilisateur>/<projet>/modele3d/<horodatage>.glb), une ligne par projet (chemin, informations,
// placement). Le seau ne permet pas de remplacer un fichier: nouveau nom à chaque envoi, l'ancien fichier est effacé
// une fois la ligne à jour. Les opérations d'un même projet passent une à la fois, dans l'ordre demandé (un placement
// demandé pendant le dépôt du modèle attend la ligne, un retrait attend la fin du dépôt).
// Non connecté ou réseau absent: chaque fonction lève une erreur, l'appelant garde sa copie locale.
import { STORAGE_BUCKET, TBL_MODELS, supabase } from '../lib/supabase.js';

const GLB_TYPE = 'model/gltf-binary';

async function userId() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const id = data && data.session && data.session.user && data.session.user.id;
  if (!id) throw new Error('non connecté');
  return id;
}

const chains = new Map(); // projet -> fin de la dernière opération demandée
function serial(projectId, fn) {
  const p = (chains.get(projectId) || Promise.resolve()).then(() => fn());
  const tail = p.catch(() => {});
  chains.set(projectId, tail);
  tail.then(() => { if (chains.get(projectId) === tail) chains.delete(projectId); });
  return p;
}

const rowPath = async (projectId) => {
  const { data, error } = await supabase.from(TBL_MODELS).select('storage_path').eq('project_id', projectId).maybeSingle();
  if (error) throw error;
  return data ? data.storage_path : null;
};
// Fichier en trop: un échec n'empêche rien (au pire un fichier orphelin dans le dossier du projet).
const dropFile = async (path) => {
  const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([path]);
  if (error) console.warn('[scene3d] fichier du modèle non effacé:', path, error.message || error);
};

// { path, info, placement, updatedAt } ou null (pas de modèle en ligne pour ce projet).
export const cloudLoad = (projectId) => serial(projectId, async () => {
  await userId();
  const { data, error } = await supabase.from(TBL_MODELS).select('storage_path, info, placement, updated_at').eq('project_id', projectId).maybeSingle();
  if (error) throw error;
  return data ? { path: data.storage_path, info: data.info, placement: data.placement || null, updatedAt: data.updated_at } : null;
});

// Fichier GLB en ligne -> ArrayBuffer
export async function cloudFetchGlb(path) {
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(path);
  if (error) throw error;
  return data.arrayBuffer();
}

// Dépose le fichier, met la ligne du projet à jour (ou la crée), puis efface le fichier précédent. Renvoie le chemin.
export const cloudSave = (projectId, glb, info, placement) => serial(projectId, async () => {
  const uid = await userId();
  const old = await rowPath(projectId);
  const path = `${uid}/${projectId}/modele3d/${Date.now()}.glb`;
  const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(path, new Blob([glb], { type: GLB_TYPE }), { contentType: GLB_TYPE, upsert: false });
  if (upErr) throw upErr;
  const { error } = await supabase.from(TBL_MODELS).upsert({
    project_id: projectId, user_id: uid, storage_path: path, info, placement: placement || null, updated_at: new Date().toISOString(),
  }, { onConflict: 'project_id' });
  if (error) { await dropFile(path); throw error; }
  if (old && old !== path) await dropFile(old);
  return path;
});

// Nouveau placement. path (facultatif): seulement si la ligne porte encore ce modèle-là.
export const cloudPlacement = (projectId, placement, path) => serial(projectId, async () => {
  await userId();
  let q = supabase.from(TBL_MODELS).update({ placement, updated_at: new Date().toISOString() }).eq('project_id', projectId);
  if (path) q = q.eq('storage_path', path);
  const { error } = await q;
  if (error) throw error;
});

// Retire le modèle en ligne du projet: la ligne, puis son fichier.
export const cloudDelete = (projectId) => serial(projectId, async () => {
  await userId();
  const path = await rowPath(projectId);
  if (!path) return;
  const { error } = await supabase.from(TBL_MODELS).delete().eq('project_id', projectId);
  if (error) throw error;
  await dropFile(path);
});
