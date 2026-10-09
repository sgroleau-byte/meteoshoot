// Scènes de synthèse (maison de 10 x 8 m, deux étages, murs de 30 cm) pour éprouver glazing.mjs dans Node.
// Visibilité approchée par rayons: un côté de triangle est vu si un rayon part de lui vers l'une des 284 directions des
// vues orthographiques de modelImport.js sans rien toucher (verre opaque comme dans la vraie passe; une face simple sans
// drapeau double face ne cache rien par son dos). Faces simples vues surtout de dos: retournées, comme importKmz.
import { glazingKinds, caster } from '../../src/scene3d/glazing.js';

const MATS = {
  mur: { opacity: 1, rgb: [0.12, 0.12, 0.12] }, blanc: { opacity: 1, rgb: [1, 1, 1] }, bois: { opacity: 1, rgb: [0.55, 0.4, 0.25] },
  verre: { opacity: 0.3, rgb: [0.6, 0.75, 0.85] }, verreGris: { opacity: 0.5, rgb: [0.4, 0.4, 0.4] }, verreDos: { opacity: 0.6, rgb: [0.72, 0.87, 1] },
  bleuOpaque: { opacity: 1, rgb: [0.722, 0.871, 1] }, bleuPeint: { opacity: 1, rgb: [0.70, 0.85, 0.98] }, eau: { opacity: 0.5, rgb: [0.3, 0.75, 0.9] },
  cadre: { opacity: 1, rgb: [0.16, 0.16, 0.16] },
};
// Même règle que faces() (modelImport.js): 1 transparent, 2 verre opaque bleu pâle, 0 sinon.
export function glassOf(m) {
  if (m.opacity < 1) return 1;
  const [r, g, b] = m.rgb, mx = Math.max(r, g, b), mn = Math.min(r, g, b), s = mx ? (mx - mn) / mx : 0;
  let h = 0;
  if (mx > mn) h = mx === r ? ((g - b) / (mx - mn)) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4;
  h = (h * 60 + 360) % 360;
  return h >= 175 && h <= 235 && s >= 0.15 && mx >= 0.75 ? 2 : 0;
}

function scene() {
  const T = [], S = { T };
  // quadrilatère a-b-c-d (sens antihoraire vu du côté de la normale); twin: jumeau inversé avec ce matériau
  S.quad = (a, b, c, d, mat, o = {}) => {
    const i = T.length;
    T.push({ v: [a, b, c], mat, dbl: !!o.dbl, tag: o.tag }, { v: [a, c, d], mat, dbl: !!o.dbl, tag: o.tag });
    if (o.twin) { T.push({ v: [a, c, b], mat: o.twin, tag: o.tag, mate: i }, { v: [a, d, c], mat: o.twin, tag: o.tag, mate: i + 1 }); T[i].mate = i + 2; T[i + 1].mate = i + 3; }
  };
  // boîte pleine, faces vers l'extérieur (o.twin: jumeaux intérieurs)
  S.box = (x0, y0, z0, x1, y1, z1, mat, o = {}) => {
    const q = (a, b, c, d) => S.quad(a, b, c, d, mat, o);
    q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); q([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
    q([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]); q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    q([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]); q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
  };
  // mur perpendiculaire à z (face extérieure à z = ze, épaisseur vers -z si dir = 1), trous [x0, x1, y0, y1]
  S.wallZ = (x0, x1, y0, y1, ze, th, holes, mat, dir = 1) => {
    const za = dir > 0 ? ze - th : ze, zb = dir > 0 ? ze : ze + th;
    let xs = [x0, x1], ys = [y0, y1];
    for (const h of holes) { xs.push(h[0], h[1]); ys.push(h[2], h[3]); }
    xs = [...new Set(xs)].sort((a, b) => a - b); ys = [...new Set(ys)].sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < ys.length; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
      if (holes.some(h => cx > h[0] && cx < h[1] && cy > h[2] && cy < h[3])) continue;
      S.box(xs[i], ys[j], za, xs[i + 1], ys[j + 1], zb, mat);
    }
  };
  S.wallX = (z0, z1, y0, y1, xe, th, mat, dir = 1) => S.box(dir > 0 ? xe - th : xe, y0, z0, dir > 0 ? xe : xe + th, y1, z1, mat);
  return S;
}
// Maison: sol, plancher d'étage, toit plat, murs; trous du mur sud (z = 8) au choix; une cloison intérieure.
function house(S, southHoles = [], wallMat = 'mur', o = {}) {
  S.box(0, -0.3, 0, 10, 0, 8, 'mur');                     // dalle
  S.box(0.3, 2.9, 0.3, 9.7, 3.1, 7.7, 'blanc');           // plancher d'étage
  if (!o.noRoof) S.box(-0.4, 6, -0.4, 10.4, 6.3, 8.4, 'mur'); // toit plat débordant
  S.wallZ(0, 10, 0, 6, 8, 0.3, southHoles, wallMat);      // sud
  S.wallZ(0, 10, 0, 6, 0, 0.3, [], wallMat, -1);          // nord
  S.wallX(0.3, 7.7, 0, 6, 10, 0.3, wallMat);              // est
  S.wallX(0.3, 7.7, 0, 6, 0, 0.3, wallMat, -1);           // ouest
  S.box(4.9, 0, 0.3, 5.1, 2.9, 7.7, 'blanc');             // cloison
}
// Vitre verticale dans le plan z = z (normale +z), o.thin: boîte de verre d'épaisseur o.thin
function paneZ(S, x0, x1, y0, y1, z, mat, o = {}) {
  if (o.thin) return S.box(x0, y0, z - o.thin, x1, y1, z, mat, { tag: o.tag, twin: o.twin });
  S.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], mat, o);
}

function build(S) {
  const names = Object.keys(MATS), T = S.T, n = T.length;
  const F = { n, pos: new Float32Array(n * 9), nrm: new Float32Array(n * 3), area: new Float32Array(n), mat: new Uint16Array(n), dbl: new Uint8Array(n), mate: new Int32Array(n).fill(-1), glass: new Uint8Array(n) };
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  T.forEach((t, i) => {
    t.v.forEach((v, j) => { F.pos.set(v, i * 9 + j * 3); for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], v[a]); hi[a] = Math.max(hi[a], v[a]); } });
    const [a, b, c] = t.v, e1 = b.map((x, k) => x - a[k]), e2 = c.map((x, k) => x - a[k]);
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(...cr);
    F.nrm.set(cr.map(x => x / l), i * 3); F.area[i] = l / 2;
    F.mat[i] = names.indexOf(t.mat); F.glass[i] = glassOf(MATS[t.mat]);
    if (t.mate != null) F.mate[i] = t.mate; else F.dbl[i] = t.dbl ? 1 : 0;
  });
  F.radius = 0.5 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  return F;
}
function visibility(F) {
  const cast = caster(F), dirs = [], ga = Math.PI * (3 - Math.sqrt(5)), front = new Uint32Array(F.n), back = new Uint32Array(F.n);
  for (let i = 0; i < 400; i++) { const y = 1 - (i + 0.5) / 400 * 2; if (y < -0.42) continue; const r = Math.sqrt(1 - y * y); dirs.push([Math.cos(ga * i) * r, y, Math.sin(ga * i) * r]); }
  const P = F.pos, N = F.nrm, L = 4 * F.radius;
  for (let t = 0; t < F.n; t++) for (const side of F.dbl[t] ? [1, -1] : [1]) {
    const nx = N[t * 3] * side, ny = N[t * 3 + 1] * side, nz = N[t * 3 + 2] * side, o = t * 9;
    let c = 0;
    for (const b of [[1 / 3, 1 / 3, 1 / 3], [0.7, 0.15, 0.15], [0.15, 0.7, 0.15], [0.15, 0.15, 0.7]]) {
      const px = b[0] * P[o] + b[1] * P[o + 3] + b[2] * P[o + 6] + nx * 1e-3, py = b[0] * P[o + 1] + b[1] * P[o + 4] + b[2] * P[o + 7] + ny * 1e-3, pz = b[0] * P[o + 2] + b[1] * P[o + 5] + b[2] * P[o + 8] + nz * 1e-3;
      for (const d of dirs) {
        if (d[0] * nx + d[1] * ny + d[2] * nz <= 0.02) continue;
        const h = cast(px, py, pz, d[0], d[1], d[2], L, (u) => u !== t && (F.dbl[u] || N[u * 3] * d[0] + N[u * 3 + 1] * d[1] + N[u * 3 + 2] * d[2] > 0), null, true);
        if (h === Infinity) c++;
      }
    }
    if (side > 0) front[t] = c; else back[t] = c;
  }
  const keep = new Uint8Array(F.n);
  for (let t = 0; t < F.n; t++) {
    if (!front[t] && !back[t]) continue;
    keep[t] = 1;
    if (F.dbl[t] && back[t] > front[t]) { // retournement (flipTri)
      const o = t * 9; for (let j = 3; j < 6; j++) { const v = P[o + j]; P[o + j] = P[o + j + 3]; P[o + j + 3] = v; }
      for (let j = 0; j < 3; j++) N[t * 3 + j] = -N[t * 3 + j];
      const f = front[t]; front[t] = back[t]; back[t] = f;
    }
  }
  return { front, back, keep };
}
// Ancienne règle (glassKinds, modelImport.js l. 339 à 364): verre = opacité < 1; vu des deux côtés = 2, sinon 1.
function oldKinds(F, front, back) {
  const q = x => Math.round(x * 1000), P = F.pos, N = F.nrm, vkey = (t, j) => { const o = t * 9 + j * 3; return q(P[o]) + ',' + q(P[o + 1]) + ',' + q(P[o + 2]); };
  const dot = (a, b) => N[a * 3] * N[b * 3] + N[a * 3 + 1] * N[b * 3 + 1] + N[a * 3 + 2] * N[b * 3 + 2];
  const by = new Map(), list = [];
  for (let t = 0; t < F.n; t++) { if (F.glass[t] !== 1) continue; list.push(t); for (let j = 0; j < 3; j++) { const k = vkey(t, j); (by.get(k) || by.set(k, []).get(k)).push(t); } }
  list.sort((a, b) => F.area[b] - F.area[a]);
  const kind = new Uint8Array(F.n), done = new Uint8Array(F.n);
  for (const s of list) {
    if (done[s]) continue; done[s] = 1; const pane = [s]; let sides = 0;
    for (let i = 0; i < pane.length; i++) { const t = pane[i], same = dot(t, s) >= 0; if (front[t]) sides |= same ? 1 : 2; if (back[t]) sides |= same ? 2 : 1;
      for (let j = 0; j < 3; j++) for (const u of by.get(vkey(t, j))) if (!done[u] && Math.abs(dot(u, s)) > 0.99) { done[u] = 1; pane.push(u); } }
    for (const t of pane) kind[t] = sides === 3 ? 2 : 1;
  }
  return kind;
}
function run(name, make, expect, post) {
  const S = scene(); make(S);
  const F = build(S), V = visibility(F);
  if (post) post(S, V);
  const R = glazingKinds(F, V.front, V.back, V.keep), O = oldKinds(F, V.front, V.back);
  const by = {}, old = {};
  S.T.forEach((t, i) => { if (!t.tag || !V.keep[i]) return; (by[t.tag] = by[t.tag] || new Set()).add(R.kind[i]); (old[t.tag] = old[t.tag] || new Set()).add(O[i]); });
  let ok = true;
  const got = Object.fromEntries(Object.entries(by).map(([k, s]) => [k, [...s].sort().join('/')]));
  for (const [tag, want] of Object.entries(expect)) {
    const g = got[tag] ?? 'retiré';
    const pass = Array.isArray(want) ? want.includes(g) : g === want;
    if (!pass) ok = false;
    console.log(`${pass ? 'ok  ' : 'ÉCHEC'} ${name}: ${tag} = ${g} (attendu ${Array.isArray(want) ? want.join(' ou ') : want}; ancienne règle ${old[tag] ? [...old[tag]].sort().join('/') : 'retiré'})`);
  }
  return ok;
}

const W = '1', FREE = '2', DARK = '3', NONE = '0';
let all = true;
const deck = (S, y = 3) => { S.box(2, y - 0.25, 8, 8, y, 11, 'bois'); }; // terrasse de 3 m devant le mur sud, à l'étage
const railing = (S, kind, tag = 'garde-corps', y = 3, opt = {}) => { // garde-corps au bord de la terrasse (z = 11), 1 m de haut
  const x0 = opt.x0 ?? 2.1, x1 = opt.x1 ?? 7.9, z = opt.z ?? 10.95;
  if (kind === 'boite') paneZ(S, x0, x1, y + 0.05, y + 1.02, z, 'verre', { thin: 0.01, twin: 'verreDos', tag });
  else if (kind === 'simple') paneZ(S, x0, x1, y + 0.05, y + 1.02, z, 'verre', { dbl: true, tag });
  else if (kind === 'jumeaux') paneZ(S, x0, x1, y + 0.05, y + 1.02, z, 'verre', { twin: 'verreDos', tag });
  else if (kind === 'opaque') paneZ(S, x0, x1, y + 0.05, y + 1.02, z, 'bleuOpaque', { dbl: true, tag });
  S.box(x0 - 0.1, y, z - 0.1, x0, y + 1.0, z, 'bois'); S.box(x1, y, z - 0.1, x1 + 0.1, y + 1.0, z, 'bois'); // poteaux
};
const win = (S, x0, x1, y0, y1, mat, o) => paneZ(S, x0, x1, y0, y1, 7.85, mat, o); // vitre au milieu de l'épaisseur du mur sud
const hole = (x0, x1, y0, y1) => [x0, x1, y0, y1];

all &= run('A fenêtre transparente dans une ouverture (jumeaux)', S => { house(S, [hole(1, 3, 1, 2.4)]); win(S, 1, 3, 1, 2.4, 'verre', { twin: 'verreDos', tag: 'fenêtre' }); }, { fenêtre: W });
all &= run('B fenêtre bleu opaque, face simple double face', S => { house(S, [hole(1, 3, 1, 2.4)]); win(S, 1, 3, 1, 2.4, 'bleuOpaque', { dbl: true, tag: 'fenêtre' }); }, { fenêtre: W });
all &= run('C fenêtre posée sur le revêtement (mur non percé)', S => { house(S); paneZ(S, 1, 3, 1, 2.4, 8.03, 'bleuOpaque', { dbl: true, tag: 'fenêtre' }); S.box(0.95, 0.95, 8, 3.05, 1, 8.06, 'cadre'); S.box(0.95, 2.4, 8, 3.05, 2.45, 8.06, 'cadre'); }, { fenêtre: W });
all &= run('D garde-corps en boîte de verre de 1 cm', S => { house(S, [hole(4, 6, 3.1, 5.4)]); win(S, 4, 6, 3.1, 5.4, 'verre', { twin: 'verreDos', tag: 'porte-fenêtre' }); deck(S); railing(S, 'boite'); }, { 'garde-corps': FREE, 'porte-fenêtre': W });
all &= run('E garde-corps en face simple', S => { house(S); deck(S); railing(S, 'simple'); }, { 'garde-corps': FREE });
all &= run('F garde-corps en jumeaux (deux matériaux)', S => { house(S); deck(S); railing(S, 'jumeaux'); }, { 'garde-corps': FREE });
all &= run('G loggia couverte (toit à 2,6 m, joues)', S => { house(S); deck(S); S.box(2, 5.6, 8, 8, 5.8, 11, 'mur'); S.box(1.8, 3, 8, 2, 5.8, 11, 'mur'); S.box(8, 3, 8, 8.2, 5.8, 11, 'mur'); railing(S, 'boite'); }, { 'garde-corps': [FREE, DARK] });
all &= run('G2 loggia + lambris bas jamais vu derrière le verre', S => { house(S); deck(S); S.box(2, 5.6, 8, 8, 5.8, 11, 'mur'); S.box(1.8, 3, 8, 2, 5.8, 11, 'mur'); S.box(8, 3, 8, 8.2, 5.8, 11, 'mur'); S.box(2, 3, 8, 8, 4, 8.02, 'bois'); railing(S, 'boite'); }, { 'garde-corps': [FREE, DARK] });
all &= run('G3 loggia + banc bas derrière le verre (jamais vu)', S => { house(S); deck(S); S.box(2, 5.6, 8, 8, 5.8, 11, 'mur'); S.box(1.8, 3, 8, 2, 5.8, 11, 'mur'); S.box(8, 3, 8, 8.2, 5.8, 11, 'mur'); S.box(2.2, 3, 10.3, 7.8, 3.45, 10.6, 'bois'); railing(S, 'boite'); }, { 'garde-corps': [FREE, DARK] });
all &= run('H garde-corps devant une porte-fenêtre ouverte (intérieur visible)', S => { house(S, [hole(4, 6, 3.1, 5.4)]); deck(S); railing(S, 'jumeaux'); }, { 'garde-corps': [FREE, DARK] });
all &= run('I balconnet: verre à 12 cm devant une porte-fenêtre', S => { house(S, [hole(4, 6, 3.1, 5.4)]); win(S, 4, 6, 3.1, 5.4, 'verre', { twin: 'verreDos', tag: 'porte-fenêtre' }); paneZ(S, 4, 6, 3.15, 4.1, 8.12, 'verre', { twin: 'verreDos', tag: 'balconnet' }); }, { 'porte-fenêtre': W, balconnet: [W, FREE, DARK] });
all &= run('I2 balconnet à 12 cm devant une porte-fenêtre au nu du mur', S => { house(S, [hole(4, 6, 3.1, 5.4)]); paneZ(S, 4, 6, 3.1, 5.4, 7.98, 'verre', { twin: 'verreDos', tag: 'porte-fenêtre' }); paneZ(S, 4, 6, 3.15, 4.1, 8.10, 'verre', { twin: 'verreDos', tag: 'balconnet' }); }, { 'porte-fenêtre': W, balconnet: FREE });
all &= run('J piscine (eau transparente couchée)', S => { house(S); S.box(2, -1.5, 12, 8, -1.4, 16, 'blanc'); S.box(1.8, -1.5, 12, 2, 0, 16, 'blanc'); S.box(8, -1.5, 12, 8.2, 0, 16, 'blanc'); S.box(2, -1.5, 11.8, 8, 0, 12, 'blanc'); S.box(2, -1.5, 16, 8, 0, 16.2, 'blanc'); S.quad([2, -0.1, 16], [8, -0.1, 16], [8, -0.1, 12], [2, -0.1, 12], 'eau', { tag: 'eau' }); }, { eau: [FREE, DARK] });
all &= run('K puits de lumière (verre couché dans le toit)', S => { house(S, [], 'mur', { noRoof: true }); S.box(-0.4, 6, -0.4, 10.4, 6.3, 3, 'mur'); S.box(-0.4, 6, 5, 10.4, 6.3, 8.4, 'mur'); S.box(-0.4, 6, 3, 4, 6.3, 5, 'mur'); S.box(6, 6, 3, 10.4, 6.3, 5, 'mur'); S.quad([4, 6.2, 5], [6, 6.2, 5], [6, 6.2, 3], [4, 6.2, 3], 'verre', { twin: 'verreDos', tag: 'puits' }); }, { puits: [DARK, FREE] });
all &= run('L murs peints bleu pâle (opaques) avec fenêtre', S => { house(S, [hole(1, 3, 1, 2.4)], 'bleuPeint'); win(S, 1, 3, 1, 2.4, 'verre', { twin: 'verreDos', tag: 'fenêtre' }); S.T.forEach(t => { if (t.mat === 'bleuPeint') t.tag = 'mur bleu'; }); }, { fenêtre: W, 'mur bleu': NONE });
all &= run('M volets bleu pâle (planches de 3 cm)', S => { house(S, [hole(1, 3, 1, 2.4)]); win(S, 1, 3, 1, 2.4, 'verre', { twin: 'verreDos', tag: 'fenêtre' }); S.box(0.4, 1, 8, 0.95, 2.4, 8.03, 'bleuPeint', { tag: 'volet' }); S.box(3.05, 1, 8, 3.6, 2.4, 8.03, 'bleuPeint', { tag: 'volet' }); }, { fenêtre: W, volet: NONE });
all &= run('M2 volet bleu en face simple collé au mur (risque connu)', S => { house(S, [hole(1, 3, 1, 2.4)]); win(S, 1, 3, 1, 2.4, 'verre', { twin: 'verreDos', tag: 'fenêtre' }); paneZ(S, 0.4, 0.95, 1, 2.4, 8.02, 'bleuPeint', { dbl: true, tag: 'volet' }); }, { fenêtre: W, volet: [NONE, W] });
all &= run('N clôture de verre au sol', S => { house(S); paneZ(S, 1, 9, 0, 1.2, 14, 'verre', { twin: 'verreDos', tag: 'clôture' }); }, { 'clôture': FREE });
all &= run('O fenêtre en verre gris teinté', S => { house(S, [hole(1, 3, 1, 2.4)]); win(S, 1, 3, 1, 2.4, 'verreGris', { dbl: true, tag: 'fenêtre' }); }, { fenêtre: W });
all &= run('P double vitrage (deux feuilles à 2 cm)', S => { house(S, [hole(1, 3, 1, 2.4)]); paneZ(S, 1, 3, 1, 2.4, 7.86, 'verre', { twin: 'verreDos', tag: 'fenêtre' }); paneZ(S, 1, 3, 1, 2.4, 7.84, 'verre', { twin: 'verreDos', tag: 'fenêtre' }); }, { fenêtre: W });
all &= run('Q verre de 6 mm en boîte dans l’ouverture', S => { house(S, [hole(1, 3, 1, 2.4)]); win(S, 1, 3, 1, 2.4, 'verre', { thin: 0.006, twin: 'verreDos', tag: 'fenêtre' }); }, { fenêtre: W });
all &= run('R garde-corps bleu opaque (face simple)', S => { house(S); deck(S); railing(S, 'opaque'); }, { 'garde-corps': NONE });
all &= run('S garde-corps de toit-terrasse (sur la dalle du toit)', S => { house(S); railing(S, 'boite', 'garde-corps', 6.3, { z: 8.3 }); }, { 'garde-corps': [FREE, DARK] });
all &= run('T fenêtre sous l’avant-toit (linteau à 10 cm du toit épais)', S => { house(S, [hole(1, 3, 4.5, 5.9)]); win(S, 1, 3, 4.5, 5.9, 'verre', { twin: 'verreDos', tag: 'fenêtre' }); }, { fenêtre: W });
all &= run('T2 fenêtre sous un toit en face simple sans épaisseur (risque connu)', S => { house(S, [hole(1, 3, 4.5, 6)], 'mur', { noRoof: true }); S.quad([-0.4, 6, 8.4], [10.4, 6, 8.4], [10.4, 6, -0.4], [-0.4, 6, -0.4], 'mur', { dbl: true }); win(S, 1, 3, 4.5, 6, 'verre', { twin: 'verreDos', tag: 'fenêtre' }); }, { fenêtre: [W, DARK] });
all &= run('V garde-corps dont le côté terrasse ne donne que sur du jamais vu (veto du haut libre)', S => { house(S); deck(S); railing(S, 'boite'); S.T.forEach(t => { if (t.mat === 'mur' && t.v.every(v => v[2] === 8)) t.tag = 'derrière'; }); },
  { 'garde-corps': DARK }, (S, V) => { S.T.forEach((t, i) => { if (t.tag === 'derrière') { V.front[i] = 0; V.back[i] = 0; } }); });

console.log('\n--- scènes ajoutées par la revue ---');
// X1 fenêtre en bandeau collée sous une dalle de toit mince (20 cm), sans débord
all &= run('X1 bandeau sous dalle mince sans débord', S => { house(S, [hole(1, 9, 4.8, 6)], 'mur', { noRoof: true }); S.box(0, 6, 0, 10, 6.2, 8, 'mur'); win(S, 1, 9, 4.8, 6, 'verre', { twin: 'verreDos', tag: 'fenêtre' }); }, { fenêtre: W });
// X1b idem, verre posé au nu extérieur du mur (vitre à 7,99)
all &= run('X1b bandeau au nu du mur sous dalle mince', S => { house(S, [hole(1, 9, 4.8, 6)], 'mur', { noRoof: true }); S.box(0, 6, 0, 10, 6.2, 8, 'mur'); paneZ(S, 1, 9, 4.8, 6, 7.99, 'verre', { twin: 'verreDos', tag: 'fenêtre' }); }, { fenêtre: W });
// X2 mur-rideau pleine hauteur d'étage sous un toit épais débordant
all &= run('X2 mur-rideau sous toit débordant', S => { house(S, [hole(1, 9, 3.1, 6)]); win(S, 1, 9, 3.1, 6, 'verre', { twin: 'verreDos', tag: 'fenêtre' }); }, { fenêtre: W });
// X3 grande baie bleu opaque d'une seule vitre (3 x 3,2 m = 9,6 m2)
all &= run('X3 baie bleu opaque de 9,6 m2 (risque connu: plus de 8 m2, reste éteinte comme avant)', S => { house(S, [hole(1, 4, 0, 3.2)]); win(S, 1, 4, 0, 3.2, 'bleuOpaque', { dbl: true, tag: 'fenêtre' }); }, { fenêtre: [W, NONE] });
// X4 serre de verre dans la cour (murs et toit en verre, rien dedans)
all &= run('X4 serre de verre vide', S => { house(S); S.box(2, 0, 13, 5, 2.2, 15, 'verre', { twin: 'verreDos', tag: 'serre' }); }, { serre: [FREE, DARK, W] });
// X6 fenêtre derrière des lattes de bois à 10 cm (moitié couverte)
all &= run('X6 fenêtre derrière des lattes', S => { house(S, [hole(1, 3, 1, 2.4)]); win(S, 1, 3, 1, 2.4, 'verre', { twin: 'verreDos', tag: 'fenêtre' }); for (let x = 0.9; x < 3.1; x += 0.1) S.box(x, 0.9, 8.05, x + 0.05, 2.5, 8.1, 'bois'); }, { fenêtre: W });
// X10 porte d'entrée peinte bleu pâle, en jumeaux sans épaisseur, dans une ouverture
all &= run('X10 porte bleu pâle en jumeaux (risque connu: allumée)', S => { house(S, [hole(4, 5, 0, 2.1)]); win(S, 4, 5, 0, 2.1, 'bleuPeint', { twin: 'blanc', tag: 'porte' }); }, { porte: [NONE, W] });
// X11 fenêtre transparente dans une coque sans intérieur, murs en faces simples double face
all &= run('X11 coque en faces simples', S => {
  const q = (a, b, c, d, o) => S.quad(a, b, c, d, 'mur', { dbl: true, ...o });
  q([0, 0, 0], [0, 0, 8], [0, 3, 8], [0, 3, 0]); q([10, 0, 8], [10, 0, 0], [10, 3, 0], [10, 3, 8]); q([10, 0, 0], [0, 0, 0], [0, 3, 0], [10, 3, 0]);
  q([0, 0, 8], [1, 0, 8], [1, 3, 8], [0, 3, 8]); q([3, 0, 8], [10, 0, 8], [10, 3, 8], [3, 3, 8]); q([1, 0, 8], [3, 0, 8], [3, 1, 8], [1, 1, 8]); q([1, 2.4, 8], [3, 2.4, 8], [3, 3, 8], [1, 3, 8]);
  q([0, 3, 8], [10, 3, 8], [10, 3, 0], [0, 3, 0]); q([0, 0, 0], [10, 0, 0], [10, 0, 8], [0, 0, 8]);
  paneZ(S, 1, 3, 1, 2.4, 8, 'verre', { dbl: true, tag: 'fenêtre' });
}, { fenêtre: W });
// X12 garde-corps de verre à 15 cm devant un mur plein (allège), plus large que la porte-fenêtre
all &= run('X12 garde-corps à 15 cm devant mur et porte étroite (risque connu: allumé)', S => { house(S, [hole(4.5, 5.5, 3.1, 5.4)]); win(S, 4.5, 5.5, 3.1, 5.4, 'verre', { twin: 'verreDos', tag: 'porte-fenêtre' }); paneZ(S, 3, 7, 3.15, 4.1, 8.15, 'verre', { twin: 'verreDos', tag: 'balconnet' }); }, { balconnet: [FREE, DARK, W], 'porte-fenêtre': W });

// V2 comme V, avec une main courante de bois de 6 cm posée sur le verre
all &= run('V2 garde-corps avec main courante, côté terrasse jamais vu', S => { house(S); deck(S); railing(S, 'boite'); S.box(2.1, 4.02, 10.9, 7.9, 4.08, 11.0, 'bois'); S.T.forEach(t => { if (t.mat === 'mur' && t.v.every(v => v[2] === 8)) t.tag = 'derrière'; }); },
  { 'garde-corps': [DARK, FREE] }, (S, V) => { S.T.forEach((t, i) => { if (t.tag === 'derrière') { V.front[i] = 0; V.back[i] = 0; } }); });
// X1c dalle de 15 cm
all &= run('X1c bandeau sous dalle de 15 cm sans débord', S => { house(S, [hole(1, 9, 4.8, 6)], 'mur', { noRoof: true }); S.box(0, 6, 0, 10, 6.15, 8, 'mur'); win(S, 1, 9, 4.8, 6, 'verre', { twin: 'verreDos', tag: 'fenêtre' }); }, { fenêtre: W });
// X6b lattes couvrant 70 %
all &= run('X6b fenêtre derrière des lattes (70 %)', S => { house(S, [hole(1, 3, 1, 2.4)]); win(S, 1, 3, 1, 2.4, 'verre', { twin: 'verreDos', tag: 'fenêtre' }); for (let x = 0.9; x < 3.1; x += 0.1) S.box(x, 0.9, 8.05, x + 0.07, 2.5, 8.1, 'bois'); }, { fenêtre: W });

// X6c lattes à 30 cm de la vitre (vitre au fond d'un mur épais), 70 % couvert
all &= run('X6c lattes à 30 cm de la vitre (70 %)', S => { house(S, [hole(1, 3, 1, 2.4)]); paneZ(S, 1, 3, 1, 2.4, 7.75, 'verre', { twin: 'verreDos', tag: 'fenêtre' }); for (let x = 0.9; x < 3.1; x += 0.1) S.box(x, 0.9, 8.05, x + 0.07, 2.5, 8.1, 'bois'); }, { fenêtre: [W, DARK] });

console.log('\n--- scènes ajoutées par la relecture de l’intégration (v633.176) ---');
// Y1 mur bleu pâle, vitre dessinée au nu de sa face extérieure (arêtes partagées): le mur ne rejoint pas la vitre
all &= run('Y1 mur bleu pâle, vitre au nu du mur', S => { house(S, [hole(1, 3, 1, 2.4)], 'bleuPeint'); paneZ(S, 1, 3, 1, 2.4, 8, 'verre', { twin: 'verreDos', tag: 'fenêtre' }); S.T.forEach(t => { if (t.mat === 'bleuPeint') t.tag = 'mur bleu'; }); }, { fenêtre: W, 'mur bleu': NONE });
// Y2 fenêtre bleu pâle opaque en boîte de 1 cm dans l'ouverture
all &= run('Y2 fenêtre bleu opaque en boîte de 1 cm', S => { house(S, [hole(1, 3, 1, 2.4)]); win(S, 1, 3, 1, 2.4, 'bleuOpaque', { thin: 0.01, tag: 'fenêtre' }); }, { fenêtre: W });
// Y3 volets bleu pâle de 1,9 cm plaqués sur le mur: restent de la peinture
all &= run('Y3 volets bleu pâle de 1,9 cm plaqués sur le mur', S => { house(S, [hole(1, 3, 1, 2.4)]); win(S, 1, 3, 1, 2.4, 'verre', { twin: 'verreDos', tag: 'fenêtre' }); S.box(0.4, 1, 8, 0.95, 2.4, 8.019, 'bleuPeint', { tag: 'volet' }); S.box(3.05, 1, 8, 3.6, 2.4, 8.019, 'bleuPeint', { tag: 'volet' }); }, { fenêtre: W, volet: NONE });
// Y4 fenêtre posée à 12 cm devant un revêtement bleu pâle (mur non percé, cadre): le revêtement n'est pas un verre
all &= run('Y4 fenêtre à 12 cm devant un revêtement bleu pâle', S => { house(S, [], 'bleuPeint'); paneZ(S, 1, 3, 1, 2.4, 8.12, 'verre', { twin: 'verreDos', tag: 'fenêtre' }); S.box(0.95, 0.95, 8, 3.05, 1, 8.14, 'cadre'); S.box(0.95, 2.4, 8, 3.05, 2.45, 8.14, 'cadre'); S.box(0.95, 1, 8, 1, 2.4, 8.14, 'cadre'); S.box(3, 1, 8, 3.05, 2.4, 8.14, 'cadre'); }, { fenêtre: W });
console.log(all ? '\nTOUT PASSE' : '\nDES ÉCHECS');
