// Style 3D du bâtiment à partir des images du client (fichiers du projet): on réduit les images, on les
// envoie à la fonction serveur /api/scene3d-style (Claude), on reçoit couleurs, fenêtres, étages, hauteur.
import { fileHelpers } from '../projects/files.js';

const API_BASE = (typeof __MS_TARGET__ !== 'undefined' && __MS_TARGET__ === 'native') ? 'https://www.meteoshoot.com' : '';
const MAX_SIDE = 1200, MAX_IMAGES = 8;

async function shrink(blob) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close && bmp.close();
  return c.toDataURL('image/jpeg', 0.85).split(',')[1];
}

export async function analyzeStyle(project, files) {
  const imgs = (files || []).filter(f => /^image\/(jpeg|png|webp|gif)$/.test(f.mime_type || '')).slice(0, MAX_IMAGES);
  if (!imgs.length) throw new Error('Aucune image dans les fichiers du projet.');
  const images = [];
  for (const f of imgs) {
    const url = await fileHelpers.getUrl(f.storage_path);
    if (!url) continue;
    const blob = await (await fetch(url)).blob();
    images.push({ media_type: 'image/jpeg', data: await shrink(blob) });
  }
  const res = await fetch(`${API_BASE}/api/scene3d-style`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: project.name, address: project.address, images }) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || ('Analyse: erreur ' + res.status));
  return out;
}
