// Style 3D du bâtiment à partir des images du client (fichiers du projet). On réduit les images, on dessine un
// croquis de l'empreinte dessinée (volumes lettrés, côtés numérotés, rues voisines nommées) pour que Claude puisse
// orienter les documents, puis la fonction serveur /api/scene3d-style renvoie couleurs, volumes (hauteurs, étages)
// et façades (ouvertures par côté). Les lettres et numéros viennent de footprint.js, partagé avec la vue 3D.
import { fileHelpers } from '../projects/files.js';
import { loadScene } from './data.js';
import { centroid, distToPolyline, labelShapes, localRings, shapesSignature } from './footprint.js';

const ABBR = { nord: 'N', 'nord-est': 'NE', est: 'E', 'sud-est': 'SE', sud: 'S', 'sud-ouest': 'SO', ouest: 'O', 'nord-ouest': 'NO' };
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
  const blobs = [];
  for (const f of imgs) {
    const url = await fileHelpers.getUrl(f.storage_path);
    if (!url) continue;
    blobs.push(await (await fetch(url)).blob());
  }
  return analyzeBlobs(project, blobs);
}

// Analyse à partir d'images déjà chargées (aussi le point d'entrée des essais en développement).
export async function analyzeBlobs(project, blobs) {
  const images = [];
  for (const b of blobs) images.push({ media_type: 'image/jpeg', data: await shrink(b) });
  if (!images.length) throw new Error('Aucune image lisible.');
  const scene = await loadScene(project.lat, project.lng).catch(() => null);
  const fp = footprintFor(project, scene);
  const schematic = fp ? drawSchematic(fp, scene) : null;
  const footprint = fp ? { sig: fp.sig, shapes: fp.shapes.map(s => ({ label: s.label, areaM2: Math.round(s.area), heightSetM: s.ring.def ? null : s.ring.h, edges: s.edges.map(e => ({ id: e.id, lenM: Math.round(e.len * 10) / 10, dir: e.dir, bearing: Math.round(e.bearing), street: e.street, streetDistM: e.streetDistM == null ? null : Math.round(e.streetDistM) })) })) } : null;
  const res = await fetch(`${API_BASE}/api/scene3d-style`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: project.name, address: project.address, images, schematic, footprint }) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || ('Analyse: erreur ' + res.status));
  return out;
}

// Empreinte lettrée du projet, avec la rue la plus proche de chaque côté (nom connu seulement).
export function footprintFor(project, scene) {
  if (!project || !project.lat || !project.lng || !Array.isArray(project.buildings) || !project.buildings.length) return null;
  const origin = (scene && scene.origin) || [project.lat, project.lng];
  const rings = localRings(project.buildings, origin);
  if (!rings.length) return null;
  const shapes = labelShapes(rings);
  const roads = ((scene && scene.roads) || []).filter(r => r.k === 0 && r.n);
  shapes.forEach(s => s.edges.forEach(e => {
    const probe = [e.mid[0] + e.nrm[0] * 4, e.mid[1] + e.nrm[1] * 4];
    let best = null;
    roads.forEach(r => { const d = distToPolyline(probe, r.p); if (d < 70 && (!best || d < best.d)) best = { d, n: r.n }; });
    e.street = best ? best.n : null; e.streetDistM = best ? best.d : null;
  }));
  return { sig: shapesSignature(project.buildings), origin, shapes, rings };
}

// Croquis envoyé à Claude: vue du ciel, nord en haut, volumes lettrés et côtés numérotés, sommets marqués, voisins,
// rues nommées, nord et échelle. Image PNG en base64.
export function drawSchematic(fp, scene) {
  const N = 1400, M = 90;
  const pts = fp.shapes.flatMap(s => s.ring.p);
  let minx = Infinity, maxx = -Infinity, minn = Infinity, maxn = -Infinity;
  pts.forEach(([x, n]) => { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minn = Math.min(minn, n); maxn = Math.max(maxn, n); });
  const span = Math.max(maxx - minx, maxn - minn, 10), pad = Math.max(45, span * 0.35), side = span + 2 * pad;
  const cx = (minx + maxx) / 2, cn = (minn + maxn) / 2, sc = (N - 2 * M) / side;
  const X = (x) => M + (x - (cx - side / 2)) * sc, Y = (n) => N - M - (n - (cn - side / 2)) * sc;
  const c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
  const F = 'Helvetica, Arial, sans-serif';
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, N, N);
  g.save(); g.beginPath(); g.rect(M, M, N - 2 * M, N - 2 * M); g.clip();
  const poly = (ring) => { g.beginPath(); ring.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); g.closePath(); };
  const line = (ring) => { g.beginPath(); ring.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); };
  if (scene) {
    (scene.green || []).forEach(a => { poly(a.p); g.fillStyle = '#e4ecd8'; g.fill(); });
    (scene.asphalt || []).forEach(p => { poly(p); g.fillStyle = '#ebebe8'; g.fill(); });
    (scene.water || []).forEach(w => { poly(w.o); g.fillStyle = '#d6e4f0'; g.fill(); });
    (scene.bld || []).forEach(([p]) => { poly(p); g.fillStyle = '#e0ded9'; g.fill(); g.lineWidth = 1; g.strokeStyle = '#c6c3bc'; g.stroke(); });
    (scene.roads || []).forEach(r => {
      line(r.p); g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = Math.max(1.5, (r.w || 4) * sc);
      g.strokeStyle = r.k === 0 ? '#bcb9b1' : r.k === 2 ? '#9c9c9c' : '#d8d5ce'; if (r.k === 1) g.setLineDash([6, 6]); g.stroke(); g.setLineDash([]);
    });
    // Noms de rues: un par nom, sur le tronçon visible le plus long, lisible de gauche à droite.
    const byName = new Map();
    (scene.roads || []).filter(r => r.n && r.k === 0).forEach(r => {
      for (let i = 0; i < r.p.length - 1; i++) {
        const ax = X(r.p[i][0]), ay = Y(r.p[i][1]), bx = X(r.p[i + 1][0]), by = Y(r.p[i + 1][1]), mx = (ax + bx) / 2, my = (ay + by) / 2;
        if (mx < M + 60 || mx > N - M - 60 || my < M + 40 || my > N - M - 40) continue;
        const l = Math.hypot(bx - ax, by - ay), cur = byName.get(r.n);
        if (!cur || l > cur.l) byName.set(r.n, { l, mx, my, ang: Math.atan2(by - ay, bx - ax) });
      }
    });
    g.font = `600 22px ${F}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    byName.forEach((v, name) => {
      let a = v.ang; if (a > Math.PI / 2) a -= Math.PI; if (a < -Math.PI / 2) a += Math.PI;
      g.save(); g.translate(v.mx, v.my); g.rotate(a); g.lineWidth = 6; g.strokeStyle = 'rgba(255,255,255,0.92)'; g.strokeText(name, 0, -15); g.fillStyle = '#5a5a55'; g.fillText(name, 0, -15); g.restore();
    });
  }
  const FILL = ['#a8453a', '#3d6f94', '#5e8a48', '#8c7a3c', '#6b4f8c', '#3f8a86'];
  fp.shapes.forEach((s, k) => { poly(s.ring.p); g.globalAlpha = 0.88; g.fillStyle = FILL[k % FILL.length]; g.fill(); g.globalAlpha = 1; g.lineWidth = 3; g.strokeStyle = '#262626'; g.stroke(); });
  g.textAlign = 'center'; g.textBaseline = 'middle';
  fp.shapes.forEach((s, k) => {
    const cc = centroid(s.ring.p), ccx = X(cc[0]), ccy = Y(cc[1]);
    g.font = `bold 64px ${F}`; g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,0.45)'; g.strokeText(s.label, ccx, ccy); g.fillStyle = '#ffffff'; g.fillText(s.label, ccx, ccy);
    s.ring.p.forEach((p, j) => {
      const px = X(p[0]), py = Y(p[1]), dx = px - ccx, dy = py - ccy, l = Math.hypot(dx, dy) || 1;
      g.beginPath(); g.arc(px, py, 7, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = '#262626'; g.stroke();
      const t = s.label.toLowerCase() + (j + 1), lx = px + dx / l * 24, ly = py + dy / l * 24;
      g.font = `bold 18px ${F}`; g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.strokeText(t, lx, ly); g.fillStyle = '#262626'; g.fillText(t, lx, ly);
    });
    s.edges.forEach(e => {
      const mx = X(e.mid[0]), my = Y(e.mid[1]), lx = mx + e.nrm[0] * 36, ly = my - e.nrm[1] * 36;
      const idDir = `${e.id} ${ABBR[e.dir] || ''}`.trim(); // côté + orientation de la façade (NE, SO...)
      g.font = `bold 24px ${F}`; g.lineWidth = 5; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.strokeText(idDir, lx, ly); g.fillStyle = FILL[k % FILL.length]; g.fillText(idDir, lx, ly);
      if (e.len >= 4) { const t = `${Math.round(e.len)} m`; g.font = `16px ${F}`; g.strokeText(t, lx, ly + 20); g.fillStyle = '#444444'; g.fillText(t, lx, ly + 20); }
    });
  });
  g.restore();
  g.lineWidth = 1; g.strokeStyle = '#9a9a9a'; g.strokeRect(M, M, N - 2 * M, N - 2 * M);
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillStyle = '#222222'; g.font = `bold 26px ${F}`; g.fillText('Empreinte dessinée dans MeteoShoot (vue du ciel, nord en haut)', M, M - 34);
  g.fillStyle = '#555555'; g.font = `17px ${F}`;
  g.fillText('Lettres = volumes dessinés. Ak = côté k du volume A, du sommet ak au sommet ak+1 (ak à gauche vu de l’extérieur); N, NE, E... = orientation de la façade.', M, N - M + 34);
  g.fillText('Gris = bâtiments voisins. Rues nommées quand le nom est connu.', M, N - M + 58);
  const nx0 = N - M - 46, ny0 = M + 64;
  g.beginPath(); g.moveTo(nx0, ny0 - 40); g.lineTo(nx0 + 14, ny0 + 10); g.lineTo(nx0, ny0); g.lineTo(nx0 - 14, ny0 + 10); g.closePath(); g.fillStyle = '#222222'; g.fill();
  g.font = `bold 22px ${F}`; g.textAlign = 'center'; g.fillText('N', nx0, ny0 + 38);
  const sm = side > 300 ? 50 : side > 120 ? 20 : 10, sx = M + 28, sy = N - M - 30;
  g.fillStyle = '#222222'; g.fillRect(sx, sy, sm * sc, 6); g.font = `18px ${F}`; g.textAlign = 'left'; g.fillText(`${sm} m`, sx, sy - 9);
  return { media_type: 'image/png', data: c.toDataURL('image/png').split(',')[1] };
}

if (import.meta.env.DEV && typeof window !== 'undefined') window.__scene3dStyle = { analyzeBlobs, footprintFor, drawSchematic }; // essais en développement
