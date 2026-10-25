// Calque satellite temporaire (Plans d'Apple) drapé sur le relief autour du projet: repère au sol pour poser un modèle
// importé (chemin, entrée, clairière). Une image de 640 x 640 points (1280 pixels) centrée sur le projet, demandée à
// /api/apple-snapshot (adresse signée côté serveur). Éteint par défaut: le reste du temps, la scène garde ses formes sobres.
import * as THREE from 'three';

// L'app native appelle le site (comme data.js et terrain.js).
const API_BASE = (typeof __MS_TARGET__ !== 'undefined' && __MS_TARGET__ === 'native') ? 'https://www.meteoshoot.com' : '';
import { roofShift } from './roofShift.js';

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

// Calage de secours dans le navigateur, quand la scène n'apporte pas celui du serveur (appleShift: clé Plans absente
// en développement, ou échec): même critère par les toits que le serveur (roofShift.js, v633.243). Retourne [dx, dn]
// (mètres est et nord) à ajouter à la position de l'image; [0, 0] quand les toits ne s'accordent pas.
export function satShift(sat, bld, cx, cn) {
  try {
    if (!bld || !bld.length || !sat.bmp) return [0, 0];
    const W = sat.bmp.width, H = sat.bmp.height, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.translate(0, H); g.scale(1, -1); g.drawImage(sat.bmp, 0, 0, W, H); // l'image est chargée retournée (rangée 0 = sud): remise à l'endroit, rangée 0 au nord comme l'attend roofShift
    const d = g.getImageData(0, 0, W, H).data;
    // Empreintes ramenées au centre de l'image (cx, cn: centre de l'image dans le repère de la scène)
    const local = bld.map(b => { const t = b.slice(); t[0] = b[0].map(([x, n]) => [x - cx, n - cn]); return t; });
    const r = roofShift(d, W, H, sat.side, local, [-cx, -cn]);
    return r ? r.shift : [0, 0];
  } catch (e) { return [0, 0]; }
}
