// Calque satellite temporaire (Plans d'Apple) drapé sur le relief autour du projet: repère au sol pour poser un modèle
// importé (chemin, entrée, clairière). Une image de 640 x 640 points (1280 pixels) centrée sur le projet, demandée à
// /api/apple-snapshot (adresse signée côté serveur). Éteint par défaut: le reste du temps, la scène garde ses formes sobres.
import * as THREE from 'three';

// L'app native appelle le site (comme data.js et terrain.js).
const API_BASE = (typeof __MS_TARGET__ !== 'undefined' && __MS_TARGET__ === 'native') ? 'https://www.meteoshoot.com' : '';
export const SAT_Z = 18; // environ 260 m de côté à Québec, 20 cm par pixel
export const SAT_CREDIT = 'Image satellite © Plans d’Apple';
// Côté de l'image en mètres (Mercator: 256 points par tuile au zoom 0, 640 points de large).
export const satSide = (lat, z = SAT_Z) => 640 * 156543.03392 * Math.cos(lat * Math.PI / 180) / 2 ** z;

export async function loadSatImage(lat, lng, z = SAT_Z) {
  const r = await fetch(`${API_BASE}/api/apple-snapshot?lat=${Number(lat).toFixed(6)}&lng=${Number(lng).toFixed(6)}&z=${z}`);
  if (!r.ok) { let m = ''; try { m = (await r.json()).error; } catch (e) { /* réponse non JSON */ } throw new Error(m || `image Plans ${r.status}`); }
  const bmp = await createImageBitmap(await r.blob(), { imageOrientation: 'flipY' }); // rangée 0 = sud, comme v = 0
  return { bmp, lat: Number(lat), lng: Number(lng), side: satSide(Number(lat), z) };
}

// Maillage drapé: carré de côté sat.side centré sur (cx, cn), en mètres autour de l'origine de la scène, découpé aux
// cellules du relief (chaque morceau dans le plan du sol). Dessiné par-dessus le sol et les rues, sans écrire la
// profondeur, et sans toucher à l'alpha de l'image de la scène (masque des flaques).
export function satMesh(terrain, sat, cx, cn, opacity = 0.9) {
  const h = sat.side / 2;
  const { pos } = terrain.drape([[[cx - h, cn - h], [cx + h, cn - h], [cx + h, cn + h]], [[cx - h, cn - h], [cx + h, cn + h], [cx - h, cn + h]]]);
  const uv = new Float32Array(pos.length / 3 * 2);
  for (let i = 0, k = 0; i < pos.length; i += 3, k += 2) { uv[k] = 0.5 + (pos[i] - cx) / sat.side; uv[k + 1] = 0.5 + (-pos[i + 2] - cn) / sat.side; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const tex = new THREE.Texture(sat.bmp);
  tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.needsUpdate = true;
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -16,
    blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = 8;
  m.frustumCulled = false;
  return m;
}

// Calage de l'image sur les empreintes des bâtiments (v633.179). Comme pour l'imagerie Esri côté serveur (api/paved.js):
// l'image est décalée de quelques mètres par rapport au LiDAR et aux empreintes (Stoneham: 5 m est et 8 m nord pour
// Esri). Sur une grille au mètre, les pixels sombres de l'image (clarté sous son 25e centile: les toits, hors ville)
// sont comparés aux empreintes (bld, anneaux en mètres locaux) par le contraste dedans/dehors (voir plus bas), à ±16 m. Retourne [dx, dn] (mètres est et nord) à ajouter à la position
// de l'image (le toit vu à (i + bx) doit se montrer en i: l'image recule de bx). [0, 0] sans empreintes, ou en ville
// (toits clairs): rien ne change.
export function satShift(sat, bld, cx, cn) {
  try {
    if (!bld || !bld.length || !sat.bmp) return [0, 0];
    const N = Math.max(32, Math.round(sat.side)), c = document.createElement('canvas'); c.width = N; c.height = N;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(sat.bmp, 0, 0, N, N); // rangée 0 = sud
    const d = g.getImageData(0, 0, N, N).data, val = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) val[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    const q25 = Float32Array.from(val).sort()[Math.floor(N * N * 0.25)], dark = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) dark[i] = val[i] < q25 ? 1 : 0;
    const x0 = cx - sat.side / 2, n0 = cn - sat.side / 2, inside = new Uint8Array(N * N);
    const inRing = (x, y, r) => { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) ins = !ins; } return ins; };
    for (const b of bld) {
      const r = b[0]; let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
      for (const [x, n] of r) { i0 = Math.min(i0, x - x0); i1 = Math.max(i1, x - x0); j0 = Math.min(j0, n - n0); j1 = Math.max(j1, n - n0); }
      if (i1 < 0 || j1 < 0 || i0 > N || j0 > N) continue;
      for (let j = Math.max(0, Math.floor(j0)); j <= Math.min(N - 1, Math.ceil(j1)); j++) for (let i = Math.max(0, Math.floor(i0)); i <= Math.min(N - 1, Math.ceil(i1)); i++) if (inRing(x0 + i + 0.5, n0 + j + 0.5, r)) inside[j * N + i] = 1;
    }
    // Même critère que le serveur (api/satshift.js, contrastShift): part de pixels sombres dedans moins celle de
    // l'anneau de 2 à 4 m autour; pic accepté à 0,08, 1,3 fois le 2e pic, pas en bord de fenêtre (±16 m).
    const dil = (m, k) => { const o = new Uint8Array(N * N); for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { if (!m[j * N + i]) continue; for (let dy = -k; dy <= k; dy++) for (let dx = -k; dx <= k; dx++) { const u = i + dx, v = j + dy; if (u >= 0 && v >= 0 && u < N && v < N) o[v * N + u] = 1; } } return o; };
    const d1 = dil(inside, 1), d4 = dil(inside, 4), inC = [], ringC = [];
    for (let k = 0; k < N * N; k++) { if (inside[k]) inC.push(k); else if (d4[k] && !d1[k]) ringC.push(k); }
    if (inC.length < 50 || ringC.length < 50) return [0, 0];
    const part = (cells, dx, dy) => { let s = 0, n = 0; for (const k of cells) { const i0 = k % N, i = i0 + dx, j = (k - i0) / N + dy; if (i >= 0 && j >= 0 && i < N && j < N) { n++; s += dark[j * N + i]; } } return n ? s / n : 0; };
    const R = 16, S = new Float32Array((2 * R + 1) * (2 * R + 1));
    let best = -Infinity, bx = 0, by = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const v = part(inC, dx, dy) - part(ringC, dx, dy); S[(dy + R) * (2 * R + 1) + dx + R] = v; if (v > best) { best = v; bx = dx; by = dy; } }
    let second = -Infinity;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (Math.max(Math.abs(dx - bx), Math.abs(dy - by)) >= 4) second = Math.max(second, S[(dy + R) * (2 * R + 1) + dx + R]);
    return best >= 0.08 && best >= 1.3 * second && Math.abs(bx) <= R - 2 && Math.abs(by) <= R - 2 ? [-bx, -by] : [0, 0];
  } catch (e) { return [0, 0]; }
}
