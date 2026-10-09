// Import d'un modèle d'architecte (KMZ exporté de SketchUp) pour la vue 3D, entièrement dans le navigateur, une fois:
// chargement, retrait de ce qui ne se voit pas de l'extérieur (cloisons, planchers, meubles, face intérieure des murs),
// simplification au centimètre, couleurs unies, puis export d'un GLB léger (environ 150 Ko pour une maison).
// Banc d'essai du 8 octobre 2026: 194 000 triangles ramenés à 6 000, 14,4 Mo à 0,15 Mo, invisible à l'oeil.
//
// Visibilité: chaque triangle est dessiné avec son numéro en couleur, sous des centaines de vues (orthographiques tout
// autour, perspectives à hauteur d'oeil); un triangle jamais vu est retiré. Pièges SketchUp réglés:
// - les deux côtés d'une face sont souvent exportés en deux triangles superposés de sens opposés (jumeaux, un matériau
//   par côté): recto seul pour eux; les faces simples sont visibles des deux côtés (drapeau double_sided de l'export,
//   ignoré par ColladaLoader);
// - composants en miroir (déterminant négatif): ordre des sommets inversé pour garder le recto;
// - doublons de même sens: un seul gardé; à égalité de profondeur, le recto gagne;
// - faces simples vues surtout de dos (normale vers l'intérieur dans le fichier): sommets inversés, la normale pointe
//   vers l'extérieur (biais d'ombre du moteur);
// - verre (opacité < 1, ou couleur unie bleu pâle sans texture: fenêtres de fabricants) classé par ce qu'il y a derrière
//   chaque vitre (glazing.js): intérieur retiré ou mur juste derrière d'un côté, extérieur de l'autre, haut pris dans le
//   mur ou le toit: fenêtre, opaque, allumée la nuit; extérieur des deux côtés (garde-corps): transparent; le reste
//   (puits de lumière, verre au haut libre): opaque, foncé, jamais allumé (8 octobre 2026: le garde-corps de verre en
//   boîte de 1 cm de la maison de Stéphane s'allumait, ses fenêtres bleu pâle opaques restaient éteintes);
// - détourages (PNG à couche alpha, opacité 1: arbres, plantes, personnages) et objets égarés loin de la maison:
//   retirés avant la passe de visibilité (ils masqueraient la façade ou fausseraient l'emprise).
import * as THREE from 'three';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { unzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js';
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { glazingKinds } from './glazing.js';

const tick = () => new Promise(r => setTimeout(r, 0));
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' };

// ---------- chargement ----------
async function readKmz(buf) {
  const zip = unzipSync(new Uint8Array(buf));
  let geo = null, daePath = null;
  if (zip['doc.kml']) {
    const xml = new DOMParser().parseFromString(strFromU8(zip['doc.kml']), 'application/xml');
    const href = xml.querySelector('Placemark Model Link href');
    daePath = href && href.textContent;
    const loc = xml.querySelector('Placemark Model Location'), ori = xml.querySelector('Placemark Model Orientation');
    if (loc) geo = { lat: +loc.querySelector('latitude').textContent, lon: +loc.querySelector('longitude').textContent, heading: ori ? +ori.querySelector('heading').textContent : 0 };
  }
  if (!daePath || !zip[daePath]) daePath = Object.keys(zip).find(p => p.toLowerCase().endsWith('.dae'));
  if (!daePath) throw new Error('Aucun modèle COLLADA dans le fichier');
  const daeText = strFromU8(zip[daePath]);
  // Drapeau double face de SketchUp (extra GOOGLEEARTH au niveau du profil, que ColladaLoader ne lit pas).
  const dx = new DOMParser().parseFromString(daeText, 'application/xml');
  const dblEffect = {};
  for (const e of dx.querySelectorAll('library_effects > effect')) {
    const d = e.querySelector('profile_COMMON > extra double_sided');
    dblEffect[e.getAttribute('id')] = d ? d.textContent.trim() === '1' : false;
  }
  const doubleSided = {};
  for (const m of dx.querySelectorAll('library_materials > material')) {
    const ie = m.querySelector('instance_effect');
    doubleSided[m.getAttribute('name') || m.getAttribute('id')] = !!(ie && dblEffect[ie.getAttribute('url').slice(1)]);
  }
  // Textures servies depuis l'archive (une adresse par contenu): couleur moyenne et détourage seulement. Chemin résolu
  // depuis le dossier du .dae (« ../images/ », noms encodés), sinon par le nom du fichier seul; introuvable: adresse
  // vide, le chargement échoue tout de suite au lieu d'interroger le serveur de l'app.
  const keys = Object.keys(zip), lower = new Map(keys.map(k => [k.toLowerCase(), k]));
  const dir = daePath.slice(0, daePath.lastIndexOf('/') + 1);
  const entry = (u) => {
    const raw = u.replace(/\\/g, '/').replace(/^file:\/*/i, '');
    let dec = raw;
    try { dec = decodeURIComponent(raw); } catch { /* nom déjà décodé */ }
    for (const s of dec === raw ? [raw] : [dec, raw]) {
      const segs = [];
      for (const x of (dir + s).split('/')) { if (x === '..') segs.pop(); else if (x && x !== '.') segs.push(x); }
      const full = lower.get(segs.join('/').toLowerCase());
      if (full) return full;
      const name = (segs[segs.length - 1] || '').toLowerCase(), key = name && keys.find(k => { const l = k.toLowerCase(); return l === name || l.endsWith('/' + name); });
      if (key) return key;
    }
    return undefined;
  };
  const urls = {}, manager = new THREE.LoadingManager();
  const revoke = () => Object.values(urls).forEach(u => URL.revokeObjectURL(u));
  manager.setURLModifier(u => {
    if (/^(blob|data):/i.test(u)) return u;
    const key = entry(u);
    if (!key) return 'data:,';
    if (!urls[key]) urls[key] = URL.createObjectURL(new Blob([zip[key]], { type: MIME[key.split('.').pop().toLowerCase()] || 'application/octet-stream' }));
    return urls[key];
  });
  let started = 0, res;
  manager.onStart = () => { started++; };
  const done = new Promise(r => { manager.onLoad = r; manager.onError = () => {}; });
  try {
    res = new ColladaLoader(manager).parse(daeText, '');
    if (started) await Promise.race([done, new Promise(r => setTimeout(r, 20000))]);
  } catch (e) { revoke(); throw e; }
  res.scene.traverse(o => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.userData.doubleSided = !!doubleSided[m.name];
  });
  return { scene: res.scene, geo, revoke };
}

// Détourage: transparent par sa texture seulement (PNG à couche alpha, opacité 1 de la couleur): arbres, plantes,
// personnages. Une texture lue sans aucun pixel percé n'en est pas un (simple drapeau de l'export).
function cutout(m) {
  if (!m.transparent || m.opacity < 1 || !m.map) return false;
  const img = m.map.image;
  if (!img || !img.width) return true;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, 64, 64);
  const d = g.getImageData(0, 0, 64, 64).data;
  let holes = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 64) holes++;
  return holes > 40; // plus de 1 % de l'image percée
}

// ---------- tous les triangles en coordonnées du monde (mètres, y vers le haut, z = -nord) ----------
function flatten(root) {
  root.updateMatrixWorld(true);
  const mats = [], matIdx = new Map();
  let n = 0;
  root.traverse(o => { if (o.isMesh) { const g = o.geometry; n += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
  const pos = new Float32Array(n * 9), mat = new Uint16Array(n);
  let t = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  root.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry, P = g.attributes.position, I = g.index, M = o.matrixWorld, flip = M.determinant() < 0;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    const groups = g.groups.length ? g.groups : [{ start: 0, count: I ? I.count : P.count, materialIndex: 0 }];
    for (const gr of groups) {
      const m = ms[gr.materialIndex] || ms[0];
      if (!matIdx.has(m)) { matIdx.set(m, mats.length); mats.push(m); }
      const mi = matIdx.get(m);
      for (let k = gr.start; k < gr.start + gr.count; k += 3) {
        const i0 = I ? I.getX(k) : k;
        let i1 = I ? I.getX(k + 1) : k + 1, i2 = I ? I.getX(k + 2) : k + 2;
        if (flip) { const tmp = i1; i1 = i2; i2 = tmp; }
        a.fromBufferAttribute(P, i0).applyMatrix4(M); b.fromBufferAttribute(P, i1).applyMatrix4(M); c.fromBufferAttribute(P, i2).applyMatrix4(M);
        if (e1.subVectors(b, a).cross(e2.subVectors(c, a)).lengthSq() < 1e-18) continue;
        pos.set([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z], t * 9);
        mat[t++] = mi;
      }
    }
  });
  return { n: t, pos: pos.subarray(0, t * 9), mat: mat.subarray(0, t), mats };
}

// Amas principal: chaque triangle occupe les cases de 2 m de sa boîte au sol, des cases à quelques mètres l'une de l'autre
// forment un amas. Le plus gros (aire des triangles) est la maison. Un autre amas est gardé s'il pèse au moins 5 % de
// la maison et se trouve à moins de 60 m d'elle (garage, cabanon, deuxième bâtiment du projet); les petits et les
// lointains (personnage, voiture, bloc oublié à 300 m) sont écartés, sinon ils faussent les vues, l'enveloppe et le sol.
function mainCluster(p, area, list) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const t of list) for (let j = 0; j < 3; j++) { const x = p[t * 9 + j * 3], z = p[t * 9 + j * 3 + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  const cell = Math.max(2, (x1 - x0) / 1024, (z1 - z0) / 1024), W = Math.floor((x1 - x0) / cell) + 1, H = Math.floor((z1 - z0) / cell) + 1;
  const ci = x => Math.min(W - 1, Math.floor((x - x0) / cell)), cj = z => Math.min(H - 1, Math.floor((z - z0) / cell));
  const occ = new Uint8Array(W * H), first = new Int32Array(list.length);
  list.forEach((t, k) => {
    const o = t * 9, i0 = ci(Math.min(p[o], p[o + 3], p[o + 6])), i1 = ci(Math.max(p[o], p[o + 3], p[o + 6]));
    const j0 = cj(Math.min(p[o + 2], p[o + 5], p[o + 8])), j1 = cj(Math.max(p[o + 2], p[o + 5], p[o + 8]));
    for (let j = j0; j <= j1; j++) occ.fill(1, j * W + i0, j * W + i1 + 1);
    first[k] = j0 * W + i0;
  });
  // Parcours des cases occupées, voisines jusqu'à r cases (écart de moins de 5 m), de proche en proche.
  const lab = new Int32Array(W * H).fill(-1), r = Math.ceil(5 / cell), stack = [];
  let nLab = 0;
  for (let c0 = 0; c0 < W * H; c0++) {
    if (!occ[c0] || lab[c0] >= 0) continue;
    lab[c0] = nLab; stack.push(c0);
    while (stack.length) {
      const c = stack.pop(), i = c % W, j = (c - i) / W;
      for (let jj = Math.max(0, j - r); jj <= Math.min(H - 1, j + r); jj++) {
        for (let ii = Math.max(0, i - r); ii <= Math.min(W - 1, i + r); ii++) { const e = jj * W + ii; if (occ[e] && lab[e] < 0) { lab[e] = nLab; stack.push(e); } }
      }
    }
    nLab++;
  }
  if (nLab < 2) return { keep: list, dropped: 0 };
  const size = new Float64Array(nLab);
  list.forEach((t, k) => { size[lab[first[k]]] += area[t]; });
  let main = 0;
  for (let l = 1; l < nLab; l++) if (size[l] > size[main]) main = l;
  const bb = Array.from({ length: nLab }, () => [Infinity, Infinity, -Infinity, -Infinity]); // cases: i0, j0, i1, j1
  for (let c = 0; c < W * H; c++) { const l = lab[c]; if (l < 0) continue; const i = c % W, j = (c - i) / W, b = bb[l]; if (i < b[0]) b[0] = i; if (j < b[1]) b[1] = j; if (i > b[2]) b[2] = i; if (j > b[3]) b[3] = j; }
  const gap = (a, b) => cell * Math.hypot(Math.max(0, a[0] - b[2] - 1, b[0] - a[2] - 1), Math.max(0, a[1] - b[3] - 1, b[1] - a[3] - 1));
  const kept = new Uint8Array(nLab);
  for (let l = 0; l < nLab; l++) kept[l] = l === main || (size[l] >= 0.05 * size[main] && gap(bb[l], bb[main]) <= 60) ? 1 : 0;
  let dropped = 0; for (let l = 0; l < nLab; l++) if (!kept[l]) dropped++;
  return { keep: dropped ? list.filter((t, k) => kept[lab[first[k]]]) : list, dropped };
}

// Verre d'un matériau: 1 transparent (opacité < 1), 2 verre opaque (couleur unie bleu pâle sans texture, la convention
// des fenêtres de fabricants dans SketchUp; confirmé ou écarté par glazing.js), 0 sinon.
function glassOf(m) {
  if (m.opacity < 1) return 1;
  if (m.map || !m.color) return 0;
  const c = m.color.clone().convertLinearToSRGB(), mx = Math.max(c.r, c.g, c.b), d = mx - Math.min(c.r, c.g, c.b);
  if (!mx || d / mx < 0.15 || mx < 0.75) return 0;
  const h = 60 * (mx === c.r ? ((c.g - c.b) / d + 6) % 6 : mx === c.g ? (c.b - c.r) / d + 2 : (c.r - c.g) / d + 4);
  return h >= 175 && h <= 235 ? 2 : 0;
}

// Recto-verso et doublons (voir l'en-tête), détourages et objets égarés, normales, aires, verre; recentrage sur l'amas
// principal: emprise centrée, sol à y = 0.
function faces(F) {
  const q = x => Math.round(x * 2000), p = F.pos;
  const nrm = new Float32Array(F.n * 3), area = new Float32Array(F.n), groups = new Map();
  for (let t = 0; t < F.n; t++) {
    const o = t * 9;
    const ax = p[o + 3] - p[o], ay = p[o + 4] - p[o + 1], az = p[o + 5] - p[o + 2], bx = p[o + 6] - p[o], by = p[o + 7] - p[o + 1], bz = p[o + 8] - p[o + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, l = Math.hypot(nx, ny, nz) || 1;
    nrm[t * 3] = nx / l; nrm[t * 3 + 1] = ny / l; nrm[t * 3 + 2] = nz / l; area[t] = l / 2;
    const v = [];
    for (let j = 0; j < 3; j++) v.push(q(p[o + j * 3]) + ',' + q(p[o + j * 3 + 1]) + ',' + q(p[o + j * 3 + 2]));
    const k = v.sort().join('|'), lst = groups.get(k);
    if (lst) lst.push(t); else groups.set(k, [t]);
  }
  const drop = new Uint8Array(F.n), mate = new Int32Array(F.n).fill(-1);
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const r = list[0];
    let lastPos = -1, lastNeg = -1;
    for (const t of list) {
      const d = nrm[t * 3] * nrm[r * 3] + nrm[t * 3 + 1] * nrm[r * 3 + 1] + nrm[t * 3 + 2] * nrm[r * 3 + 2];
      if (d >= 0) { if (lastPos >= 0) drop[lastPos] = 1; lastPos = t; } else { if (lastNeg >= 0) drop[lastNeg] = 1; lastNeg = t; }
    }
    if (lastPos >= 0 && lastNeg >= 0) { mate[lastPos] = lastNeg; mate[lastNeg] = lastPos; }
  }
  // Détourage retiré avec son jumeau (l'autre côté de la même feuille, souvent sans texture).
  const cut = F.mats.map(cutout);
  let cutouts = 0;
  for (let t = 0; t < F.n; t++) if (!drop[t] && (cut[F.mat[t]] || (mate[t] >= 0 && cut[F.mat[mate[t]]]))) { drop[t] = 1; cutouts++; }
  const live = [];
  for (let t = 0; t < F.n; t++) if (!drop[t]) live.push(t);
  if (!live.length) throw new Error('Modèle vide (seulement des détourages)');
  const { keep, dropped } = mainCluster(p, area, live);
  // Rôle des jumeaux de même matériau (1 ou 2 selon le sens de la normale sur son axe dominant, constant sur toute une
  // face plane): les deux côtés ne sont jamais simplifiés ensemble (voir build).
  const roleOf = t => { const x = nrm[t * 3], y = nrm[t * 3 + 1], z = nrm[t * 3 + 2], ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z); return (ax >= ay && ax >= az ? x : ay >= az ? y : z) > 0 ? 1 : 2; };
  const n = keep.length, isGlass = F.mats.map(glassOf), at = new Int32Array(F.n).fill(-1);
  keep.forEach((t, k) => { at[t] = k; });
  const G = { n, mats: F.mats, pos: new Float32Array(n * 9), mat: new Uint16Array(n), nrm: new Float32Array(n * 3), area: new Float32Array(n), dbl: new Uint8Array(n), glass: new Uint8Array(n), mate: new Int32Array(n), role: new Uint8Array(n), cutouts, dropped };
  keep.forEach((t, k) => {
    G.pos.set(p.subarray(t * 9, t * 9 + 9), k * 9); G.nrm.set(nrm.subarray(t * 3, t * 3 + 3), k * 3);
    G.mat[k] = F.mat[t]; G.area[k] = area[t]; G.glass[k] = isGlass[F.mat[t]];
    G.dbl[k] = mate[t] < 0 && F.mats[F.mat[t]].userData.doubleSided ? 1 : 0;
    G.mate[k] = mate[t] >= 0 ? at[mate[t]] : -1;
    G.role[k] = G.mate[k] >= 0 && F.mat[mate[t]] === F.mat[t] ? roleOf(t) : 0;
  });
  const box = new THREE.Box3(), v = new THREE.Vector3();
  for (let i = 0; i < G.pos.length; i += 3) box.expandByPoint(v.set(G.pos[i], G.pos[i + 1], G.pos[i + 2]));
  const off = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
  for (let i = 0; i < G.pos.length; i += 3) { G.pos[i] -= off.x; G.pos[i + 1] -= off.y; G.pos[i + 2] -= off.z; }
  G.offset = off; // centre de l'emprise par rapport à l'origine du fichier (pour la géolocalisation)
  G.size = box.getSize(new THREE.Vector3());
  G.center = new THREE.Vector3(0, G.size.y / 2, 0);
  G.radius = 0.5 * G.size.length();
  return G;
}

// ---------- visibilité ----------
function idScene(F) {
  const scene = new THREE.Scene();
  for (const dbl of [0, 1]) {
    const list = [];
    for (let t = 0; t < F.n; t++) if (F.dbl[t] === dbl) list.push(t);
    if (!list.length) continue;
    const pos = new Float32Array(list.length * 9), idc = new Uint8Array(list.length * 12);
    list.forEach((t, k) => {
      pos.set(F.pos.subarray(t * 9, t * 9 + 9), k * 9);
      const id = t + 1, r = id & 255, g = (id >>> 8) & 255, b = (id >>> 16) & 255;
      for (let j = 0; j < 3; j++) { const o = k * 12 + j * 4; idc[o] = r; idc[o + 1] = g; idc[o + 2] = b; idc[o + 3] = 255; }
    });
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('idc', new THREE.BufferAttribute(idc, 4, true));
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      side: dbl ? THREE.DoubleSide : THREE.FrontSide,
      vertexShader: 'in vec4 idc; flat out vec4 vId; void main() { vId = idc; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'flat in vec4 vId; layout(location = 0) out highp vec4 outId; void main() { outId = vec4(vId.rgb, gl_FrontFacing ? 1.0 : 0.5); gl_FragDepth = gl_FragCoord.z + (gl_FrontFacing ? 0.0 : 0.000002); }',
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
  return scene;
}

function cameras(F) {
  const R = F.radius, C = F.center, cams = [], ga = Math.PI * (3 - Math.sqrt(5)), nDirs = 400;
  for (let i = 0; i < nDirs; i++) {
    const y = 1 - (i + 0.5) / nDirs * 2;
    if (y < -0.42) continue; // jamais par en dessous du sol, sauf un peu pour les débords de toit
    const r = Math.sqrt(1 - y * y), th = ga * i;
    const cam = new THREE.OrthographicCamera(-R, R, R, -R, 0.01, 4 * R);
    cam.position.copy(C).addScaledVector(new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r), 2 * R);
    if (Math.abs(y) > 0.99) cam.up.set(0, 0, -1);
    cam.lookAt(C); cam.updateMatrixWorld(); cams.push(cam);
  }
  for (const ring of [{ dist: R + 3, h: 1.6, count: 36, fov: 95 }, { dist: 2 * R, h: 1.6, count: 36, fov: 70 }, { dist: R + 3, h: 7, count: 24, fov: 95 }]) {
    for (let k = 0; k < ring.count; k++) {
      const ang = (k + 0.5) / ring.count * Math.PI * 2, cam = new THREE.PerspectiveCamera(ring.fov, 1, 0.5, 10 * R);
      cam.position.set(Math.cos(ang) * ring.dist, ring.h, Math.sin(ang) * ring.dist);
      cam.lookAt(0, Math.min(ring.h, C.y), 0); cam.updateMatrixWorld(); cams.push(cam);
    }
  }
  return cams;
}

// Pixels vus de face et de dos par triangle (alpha 1 de face, 0,5 de dos: seules les faces simples se voient de dos).
async function visibility(F, onProgress) {
  const S = 2048, canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const R = new THREE.WebGLRenderer({ canvas, antialias: false }), gl = R.getContext();
  const buf = new Uint8Array(S * S * 4), front = new Uint32Array(F.n), back = new Uint32Array(F.n);
  let rt = null, scene = null;
  try {
    rt = new THREE.WebGLRenderTarget(S, S, { depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    scene = idScene(F);
    const cams = cameras(F);
    R.setRenderTarget(rt); R.setClearColor(0x000000, 0);
    for (let c = 0; c < cams.length; c++) {
      R.clear(); R.render(scene, cams[c]); R.readRenderTargetPixels(rt, 0, 0, S, S, buf);
      // Contexte perdu (processeur graphique saturé, veille): la lecture ne rend plus rien et le modèle sortirait troué.
      if (gl.isContextLost()) throw new Error('Contexte graphique perdu pendant la préparation du modèle: réessayer');
      for (let i = 0; i < buf.length; i += 4) {
        const id = buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16);
        if (!id) continue;
        if (buf[i + 3] > 192) front[id - 1]++; else back[id - 1]++;
      }
      if (c % 6 === 5) { onProgress(0.15 + 0.75 * c / cams.length); await tick(); }
    }
  } finally {
    if (rt) rt.dispose();
    if (scene) scene.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    R.dispose(); if (!gl.isContextLost()) R.forceContextLoss();
  }
  return { front, back };
}

// Face simple retournée: ordre des sommets inversé, normale opposée.
function flipTri(F, t) {
  const p = F.pos, o = t * 9;
  for (let j = 3; j < 6; j++) { const v = p[o + j]; p[o + j] = p[o + j + 3]; p[o + j + 3] = v; }
  for (let j = 0; j < 3; j++) F.nrm[t * 3 + j] = -F.nrm[t * 3 + j];
}

// ---------- reconstruction allégée, couleurs unies ----------
function averageColor(tex) {
  const img = tex && tex.image;
  if (!img || !img.width) return null;
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, 32, 32);
  const d = g.getImageData(0, 0, 32, 32).data;
  let r = 0, gg = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 128) continue; r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
  return n ? new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace) : null;
}

// Vitrage (glazing.js): 0 pas du verre, 1 fenêtre (allumée la nuit), 2 verre libre (transparent), 3 vitrage sombre.
const VITRAGE = ['', 'fenetre', 'verre', 'vitrage'];
function material(src, front, glassKind) {
  const m = new THREE.MeshStandardMaterial({ color: src.color ? src.color.clone() : new THREE.Color(1, 1, 1), roughness: 0.85, metalness: 0, side: front ? THREE.FrontSide : THREE.DoubleSide });
  m.name = (src.name || 'materiau') + (glassKind ? '-' + VITRAGE[glassKind] : '');
  m.userData.vitrage = VITRAGE[glassKind]; // écrit dans le GLB (extras) et relu par engine.js: un nom d'origine en « -fenetre » ne s'allume plus
  if (src.map) { const avg = averageColor(src.map); if (avg) m.color.copy(avg).multiply(src.color || new THREE.Color(1, 1, 1)); }
  // Fenêtre ou vitrage sombre: foncé seulement si le verre d'origine est transparent (une fenêtre bleu pâle opaque garde sa couleur le jour).
  if (glassKind === 1 || glassKind === 3) { if (src.opacity < 1) m.color.lerp(new THREE.Color(0x1c232b), 0.78); m.roughness = 0.25; m.metalness = 0.1; }
  else if (glassKind === 2) { m.transparent = true; m.opacity = Math.min(src.opacity, 0.45); m.roughness = 0.1; }
  return m;
}

function compact(g) {
  const idx = g.index.array, P = g.attributes.position.array, map = new Int32Array(P.length / 3).fill(-1);
  let nv = 0;
  for (let i = 0; i < idx.length; i++) if (map[idx[i]] < 0) map[idx[i]] = nv++;
  const P2 = new Float32Array(nv * 3), I2 = new Uint32Array(idx.length);
  for (let v = 0; v < map.length; v++) { const k = map[v]; if (k >= 0) { P2[k * 3] = P[v * 3]; P2[k * 3 + 1] = P[v * 3 + 1]; P2[k * 3 + 2] = P[v * 3 + 2]; } }
  for (let i = 0; i < idx.length; i++) I2[i] = map[idx[i]];
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P2, 3));
  out.setIndex(new THREE.BufferAttribute(nv > 65535 ? I2 : new Uint16Array(I2), 1));
  return out;
}

// Aire d'un maillage indexé (garde-fou de la simplification).
function surface(I, P) {
  let s = 0;
  for (let k = 0; k < I.length; k += 3) {
    const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    s += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  return s / 2;
}

function build(F, keep, kind) {
  const lists = new Map();
  for (let t = 0; t < F.n; t++) {
    if (!keep[t]) continue;
    // Jumeaux de même matériau gardés tous les deux (dessous d'avant-toit, auvent, balcon): le verso dans son propre
    // groupe, sinon meshopt voit une feuille fermée d'épaisseur nulle, sans bord à protéger, et la réduit à rien.
    const verso = F.role[t] === 2 && keep[F.mate[t]] ? 1 : 0;
    const key = F.mat[t] + '|' + (F.dbl[t] ? 0 : 1) + '|' + kind[t] + '|' + verso, l = lists.get(key);
    if (l) l.push(t); else lists.set(key, [t]);
  }
  const root = new THREE.Group();
  root.name = 'modele-architecte';
  let tris = 0;
  const hullPts = [];
  for (const [key, list] of lists) {
    const [mi, front, gk] = key.split('|').map(Number);
    const pos = new Float32Array(list.length * 9);
    list.forEach((t, k) => pos.set(F.pos.subarray(t * 9, t * 9 + 9), k * 9));
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g = mergeVertices(g, 1e-4);
    if (g.index.count > 300) {
      const P0 = g.attributes.position.array, a0 = surface(g.index.array, P0);
      const [out] = MeshoptSimplifier.simplify(new Uint32Array(g.index.array), P0, 3, 0, 0.01, ['ErrorAbsolute']);
      // Une aire qui fond de plus de 3 % (et de plus de 0,1 m², les détails sous le centimètre peuvent partir): triangles
      // d'origine gardés.
      const lost = out.length >= 3 ? a0 - surface(out, P0) : a0;
      if (out.length >= 3 && (lost <= 0.03 * a0 || lost <= 0.1)) { g.setIndex(new THREE.BufferAttribute(out, 1)); g = compact(g); }
    }
    const P = g.attributes.position.array;
    for (let i = 0; i < P.length; i += 3) hullPts.push([P[i], -P[i + 2]]);
    const mesh = new THREE.Mesh(g, material(F.mats[mi], front === 1, gk));
    mesh.name = mesh.material.name;
    root.add(mesh);
    tris += g.index.count / 3;
  }
  return { root, tris, hull: convexHull(hullPts) };
}

// Enveloppe convexe vue du ciel [[x, n], ...], sens antihoraire.
function convexHull(pts) {
  const p = pts.map(q => [Math.round(q[0] * 100) / 100, Math.round(q[1] * 100) / 100]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

// Fichier .kmz -> { glb (ArrayBuffer), info }. onProgress(0 à 1). info.cutouts: triangles de détourage retirés;
// info.dropped: objets égarés écartés (absents quand il n'y en a pas); info.glazing: bilan des vitrages (fenêtres, verre
// libre, vitrages sombres, aire allumée).
export async function importKmz(file, onProgress = () => {}) {
  const t0 = performance.now();
  onProgress(0.02); await tick();
  const K = await readKmz(await file.arrayBuffer());
  try {
    onProgress(0.08); await tick();
    const raw = flatten(K.scene);
    if (!raw.n) throw new Error('Modèle vide');
    const F = faces(raw);
    onProgress(0.15); await tick();
    const { front, back } = await visibility(F, onProgress);
    const keep = new Uint8Array(F.n);
    let kept = 0;
    for (let t = 0; t < F.n; t++) {
      if (!front[t] && !back[t]) continue;
      keep[t] = 1; kept++;
      // Face simple vue surtout de dos: sa normale pointait vers l'intérieur, retournée vers l'extérieur.
      if (F.dbl[t] && back[t] > front[t]) { flipTri(F, t); const f = front[t]; front[t] = back[t]; back[t] = f; }
    }
    // Rien de visible: rendu muet (contexte graphique) ou faces simples toutes à l'envers, sans drapeau double face.
    if (!kept) throw new Error('Aucune face visible de l\'extérieur dans ce modèle');
    const { kind, stats } = glazingKinds(F, front, back, keep);
    await MeshoptSimplifier.ready;
    onProgress(0.92); await tick();
    const B = build(F, keep, kind);
    let glb;
    try {
      if (B.hull.length < 3) throw new Error('Emprise au sol illisible (moins de trois points)');
      glb = await new GLTFExporter().parseAsync(B.root, { binary: true });
    } finally {
      B.root.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    }
    onProgress(1);
    const info = {
      name: file.name.replace(/\.kmz$/i, ''), bytes: glb.byteLength, srcBytes: file.size, srcTris: raw.n, tris: B.tris, kept,
      size: [+F.size.x.toFixed(2), +(F.size.z).toFixed(2), +F.size.y.toFixed(2)], hull: B.hull, offset: [F.offset.x, -F.offset.z], geo: K.geo, ms: Math.round(performance.now() - t0),
    };
    info.glazing = { v: 2, ...stats }; // bilan des vitrages; absent: classement d'avant la v633.176
    if (F.dropped) info.dropped = F.dropped;
    if (F.cutouts) info.cutouts = F.cutouts;
    return { glb, info };
  } finally {
    K.scene.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
    K.revoke();
  }
}
