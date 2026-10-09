// Dégagement entre les arbres et les bâtiments (vue 3D, 8 octobre 2026; Stéphane: « il ne faut pas que les arbres
// entrent en conflit avec les bâtiments »): aucun tronc, aucune couronne de feuillu, aucun cône de conifère, ni la nappe
// du sous-bois ni sa lisière ne traversent un bâtiment dessiné (formes du projet et voisins d'Overture). Un grand arbre
// peut surplomber un toit bas (sa couronne passe alors entièrement au-dessus), de préférence quand le relevé LiDAR montre
// du feuillage au-dessus du toit, jamais celui d'une forme du projet absente d'Overture; un arbre collé à un mur pousse à l'opposé (couronne décalée, plus petite). Mesuré avant
// sur 6 quartiers: 0,4 % des arbres à Stoneham, 9 à 21 % en ville traversaient un bâtiment. Fonctions pures, sans
// three.js: vérifiables dans Node.

export const CLR_H = 0.3; // m: écart minimal entre un mur et un tronc, une couronne ou un cône
export const CLR_V = 0.3; // m: écart minimal entre un toit et le dessous d'une couronne qui le surplombe
export const CLR_SHEET = 0.6; // m: écart minimal entre une case de la nappe du sous-bois et un bâtiment
export const CLR_SHEET_MOVED = 0.3; // m: idem après le décalage au hasard des sommets du bord de la nappe

// Lobes des feuillus [x, y, z, rayon] (unité: l'échelle sx, sy, sx de l'instance) et étages des conifères
// [bas, haut, rayon]: les mêmes que les géométries du moteur (lobes(), conifer()), qui les importent d'ici.
export const LOBE_PARTS = [[0, 0, 0, 1], [0.6, 0.2, 0.15, 0.62], [-0.55, 0.1, 0.35, 0.58], [0.1, -0.05, -0.6, 0.6], [-0.1, 0.62, -0.1, 0.55], [0.25, 0.45, 0.5, 0.5]];
export const CON_TIERS = [[0.0, 0.62, 1.0], [0.28, 0.82, 0.74], [0.55, 1.0, 0.46]], CON_TIERS_LOW = [[0, 0.7, 1], [0.4, 1, 0.6]];
const DENT = 0.08; // bord inférieur dentelé des cônes: un sommet sur deux descend de 8 % de la hauteur de l'étage

function inRing(x, n, r) { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > n) !== (b[1] > n) && x < ((b[0] - a[0]) * (n - a[1])) / (b[1] - a[1]) + a[0]) ins = !ins; } return ins; }
// Distance signée d'un point à une empreinte (négative à l'intérieur; les trous éventuels comptent comme dehors),
// et point du contour le plus proche.
export function sdist(x, n, b) {
  let best = Infinity, px = 0, pn = 0, inside = inRing(x, n, b.p);
  const rings = b.holes ? [b.p, ...b.holes] : [b.p];
  for (const r of rings) {
    if (r !== b.p && inside && inRing(x, n, r)) inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[j], c = r[i], dx = c[0] - a[0], dn = c[1] - a[1], l2 = dx * dx + dn * dn || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (n - a[1]) * dn) / l2)), qx = a[0] + t * dx, qn = a[1] + t * dn, d = Math.hypot(x - qx, n - qn);
      if (d < best) { best = d; px = qx; pn = qn; }
    }
  }
  return { d: inside ? -best : best, px, pn };
}
const bbDist = (x, n, bb) => Math.hypot(Math.max(bb[0] - x, 0, x - bb[2]), Math.max(bb[1] - n, 0, n - bb[3]));

// Prismes des bâtiments tels que blocks() les extrude (pied à min(sol) - 0,5 m, toit plat à moyenne(sol) + h), à partir
// de la liste complète du moteur (formes du projet puis voisins non recouverts), et grille de cases de 16 m pour ne
// tester un arbre qu'avec les bâtiments proches. groundOf(ring) -> { min, mean } est celle du moteur; le résultat est
// gardé dans b.g pour que blocks() ne le recalcule pas.
export function prisms(list, groundOf, CELL = 16, HALF = 520) {
  const P = list.map(b => {
    const g = b.g || (b.g = groundOf(b.p)); let x0 = Infinity, n0 = Infinity, x1 = -Infinity, n1 = -Infinity;
    for (const q of b.p) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < n0) n0 = q[1]; if (q[1] > n1) n1 = q[1]; }
    return { p: b.p, holes: b.holes || null, yb: g.min - 0.5, T: g.mean + b.h, bb: [x0, n0, x1, n1], unmapped: !!b.unmapped }; // hauteur des murs (pas le faîte: un sapin entre deux maisons disparaissait, v633.182)
  });
  const G = Math.ceil(2 * HALF / CELL), cells = new Array(G * G), stamp = new Int32Array(P.length); let tick = 0;
  const ci = (v) => Math.max(0, Math.min(G - 1, Math.floor((v + HALF) / CELL)));
  P.forEach((b, k) => { for (let j = ci(b.bb[1]); j <= ci(b.bb[3]); j++) for (let i = ci(b.bb[0]); i <= ci(b.bb[2]); i++) (cells[j * G + i] || (cells[j * G + i] = [])).push(k); });
  // Bâtiments dont le cadre touche le rectangle donné (chacun une fois).
  P.query = (x0, n0, x1, n1) => {
    tick++; const out = [];
    for (let j = ci(n0); j <= ci(n1); j++) for (let i = ci(x0); i <= ci(x1); i++) {
      const c = cells[j * G + i]; if (!c) continue;
      for (const k of c) { if (stamp[k] === tick) continue; stamp[k] = tick; const b = P[k]; if (b.bb[0] <= x1 && b.bb[2] >= x0 && b.bb[1] <= n1 && b.bb[3] >= n0) out.push(b); }
    }
    return out;
  };
  return P;
}

// Portée horizontale d'une forme d'arbre depuis le centre de sa couronne (rayon englobant).
export function reachOf(s) {
  if (s.kind === 'con') return s.rb;
  let m = 0; for (let i = 0; i < s.nl; i++) { const [x, , z, r] = LOBE_PARTS[i]; m = Math.max(m, Math.hypot(x, z) + r); } return m * s.sx;
}

// Test exact d'une forme d'arbre contre un prisme, avec les marges mh (horizontale) et mv (au-dessus du toit).
// t: { x, n, y (sol), h, rot }; s: forme (voir treeShape du moteur). Lobes: ellipsoïdes de révolution (rayon r sx,
// demi-hauteur r sy), cônes: troncs de cône par étage; les facettes (icosaèdres, cônes à 6 ou 10 côtés) sont inscrites,
// donc le test est prudent. Pour un axe vertical et un prisme vertical, le point le plus large de la forme dans la
// tranche de hauteur commune décide: comparaison avec la distance du centre à l'empreinte (exacte, formes concaves comprises).
export function hitShape(t, s, b, mh = CLR_H, mv = CLR_V) {
  const T = b.T + mv, yb = b.yb, g = t.y;
  if (g < T && g + s.th > yb && bbDist(t.x, t.n, b.bb) < s.tr + mh && sdist(t.x, t.n, b).d < s.tr + mh) return true; // tronc
  if (s.kind === 'con') {
    const span = t.h - s.base;
    for (const [y0, y1, r] of s.tiers) {
      const Yr = g + s.base + span * y0, Y0 = Yr - span * DENT * (y1 - y0), Y1 = g + s.base + span * y1;
      const lo = Math.max(Y0, yb), hi = Math.min(Y1, T); if (lo >= hi) continue;
      const rad = s.rb * r * Math.min(1, (Y1 - lo) / (Y1 - Yr));
      if (bbDist(s.cx, s.cn, b.bb) < rad + mh && sdist(s.cx, s.cn, b).d < rad + mh) return true;
    }
    return false;
  }
  const cy = g + t.h - s.top * s.sy, cs = Math.cos(t.rot), sn = Math.sin(t.rot);
  for (let i = 0; i < s.nl; i++) {
    const [lx, ly, lz, r] = LOBE_PARTS[i];
    // three.js: position + Ry(rot) * (échelle * local), z = -n
    const ax = lx * s.sx, az = lz * s.sx, wx = s.cx + ax * cs + az * sn, wn = s.cn + ax * sn - az * cs;
    const Cy = cy + ly * s.sy, A = r * s.sx, B = r * s.sy;
    const lo = Math.max(Cy - B, yb), hi = Math.min(Cy + B, T); if (lo >= hi) continue;
    const u = (Math.max(lo, Math.min(hi, Cy)) - Cy) / B, rad = A * Math.sqrt(Math.max(0, 1 - u * u));
    if (bbDist(wx, wn, b.bb) < rad + mh && sdist(wx, wn, b).d < rad + mh) return true;
  }
  return false;
}

// Ajuste la forme s d'un arbre t pour qu'elle ne touche aucun prisme de P; null: l'arbre est retiré.
// t: { x, n, y, h, rot, over (1 feuillage mesuré au-dessus du toit voisin, 0 non, undefined inconnu), lidar }.
// 1) Tronc dans une empreinte (à toute hauteur) ou à moins de son rayon + 0,3 m d'un mur: retiré (aucun arbre ne
//    pousse dans un mur). Près d'une forme du projet qu'Overture n'a pas (bâtiment neuf ou absent des cartes), un
//    « arbre » LiDAR qui ne dépasse pas son toit de 1,5 m est le toit lui-même vu par le relevé: retiré aussi.
// 2) Forme déjà dégagée: telle quelle (environ 80 à 99 % des arbres selon le quartier).
// 3) Sinon, essais du moins visible au plus visible (premier essai dégagé retenu, test exact contre tous les voisins):
//    - surplomb: un arbre nettement plus haut que le toit garde sa largeur, sa couronne remonte au-dessus du toit
//      (sommet à la hauteur mesurée, couronne plus plate, au moins la moitié de sa hauteur d'origine);
//    - décalage du centre de la couronne à l'opposé des murs touchés (au plus 1,5 m et la moitié du rayon: le haut du
//      tronc reste caché), et réduction de 10 à 40 % (sommet toujours à la hauteur mesurée);
//    - surplomb combiné au décalage et à la réduction.
// 4) Rien ne passe: retiré. Minimums: 0,8 m de rayon et 0,9 m de demi-hauteur (feuillu), 0,9 m de rayon (conifère).
const S_STEPS = [1, 0.9, 0.8, 0.7, 0.6], D_STEPS = [0, 0.5, 1];
export function fitTree(t, s, P) {
  // Recherche autour du tronc: portée de la couronne, plus son décalage de départ (centre mesuré), plus 1,5 m pour les
  // essais décalés, plus la marge (sinon un bâtiment du côté du décalage n'était jamais testé).
  const R = reachOf(s) + Math.hypot(s.cx - t.x, s.cn - t.n) + 1.5 + CLR_H, near = P.query(t.x - R, t.n - R, t.x + R, t.n + R);
  if (!near.length) return s;
  for (const b of near) {
    const d = sdist(t.x, t.n, b).d;
    if (d < 0 || (t.y < b.T + CLR_V && t.y + s.th > b.yb && d < s.tr + CLR_H)) return null;
    if (b.unmapped && t.lidar && t.y + t.h <= b.T + 1.5 && d < 2.5) return null;
  }
  // Forme du projet absente d'Overture: aucune couronne au-dessus de son toit non plus (plafond vertical infini), pas
  // seulement levée: elle cacherait le sujet de la photo.
  const hitB = (sh, b) => hitShape(t, sh, b, CLR_H, b.unmapped ? Infinity : CLR_V);
  const hits = near.filter(b => hitB(s, b));
  if (!hits.length) return s;
  let ux = 0, un = 0; // à l'opposé des murs touchés, pondéré par leur proximité
  for (const b of hits) { const q = sdist(t.x, t.n, b), dx = t.x - q.px, dn = t.n - q.pn, l = Math.hypot(dx, dn) || 1, w = 1 / Math.max(0.3, q.d); ux += dx / l * w; un += dn / l * w; }
  const ul = Math.hypot(ux, un); if (ul > 1e-3) { ux /= ul; un /= ul; } else ux = un = 0;
  // Pas de surplomb sur une forme du projet absente d'Overture: le relevé est antérieur au bâtiment (ou ne le connaît
  // pas), sa clairière n'y est pas; une couronne posée sur son toit cacherait le sujet de la photo.
  const noLift = hits.some(b => b.unmapped);
  const Tmax = Math.max(...hits.map(b => b.T)) + CLR_V, cands = [];
  if (s.kind === 'con') {
    const e = DENT * (s.tiers[0][1] - s.tiers[0][0]), baseL = (Tmax - t.y + e * t.h) / (1 + e);
    const liftOk = !noLift && baseL > s.base && t.h - baseL >= Math.max(2, 0.45 * t.h); // branches sur au moins 45 % de la hauteur
    for (const k of S_STEPS) for (const df of D_STEPS) for (const lift of liftOk ? [false, true] : [false]) {
      const rb = k * s.rb; if (k < 1 && rb < 0.9) continue;
      const dd = df * Math.min(0.8, 0.3 * rb), base = lift ? baseL : s.base;
      cands.push({ cost: 10 * (1 - k) + 2 * df + (lift ? 1.5 : 0), s: { ...s, cx: s.cx + ux * dd, cn: s.cn + un * dd, rb, base, th: lift ? Math.max(s.th, base + 0.15 * (t.h - base)) : s.th } });
    }
  } else {
    const kk = 1 + s.top, avail = t.y + t.h - Tmax, syL = avail / kk;
    const liftOk = !noLift && syL < s.sy && syL >= Math.max(0.9, 0.5 * s.sy), tall = avail >= Math.max(1.8, 0.5 * kk * s.sy);
    for (const k of S_STEPS) for (const df of D_STEPS) for (const lift of liftOk ? [false, true] : [false]) {
      let sx = k * s.sx, sy = k * s.sy;
      if (lift) { sy = Math.min(sy, syL); sx = Math.min(sx, sy / 0.65); } // plus plate au-dessus d'un toit, jamais une galette
      if (sx < 0.8 || sy < 0.9) continue;
      // Décalage depuis le centre de départ (déjà écarté du toit par la mesure), le tout à 0,7 fois le rayon du tronc au
      // plus: le haut du tronc reste dans la couronne.
      const dd = df * Math.min(1.5, 0.5 * sx); let cx = s.cx + ux * dd, cn = s.cn + un * dd;
      const off = Math.hypot(cx - t.x, cn - t.n), om = 0.7 * sx; if (off > om) { cx = t.x + (cx - t.x) * om / off; cn = t.n + (cn - t.n) * om / off; }
      // Surplomb d'abord si le relevé le montre (ou, sans mesure, pour un arbre nettement plus haut que le toit).
      const liftCost = t.over === 1 ? -0.5 : t.over === 0 ? 3 : tall ? -0.5 : 3;
      cands.push({ cost: 10 * (1 - k) + 2 * df + (lift ? liftCost : 0), s: { ...s, cx, cn, sx, sy, th: Math.max(1.5, t.h - s.top * sy) } });
    }
  }
  cands.sort((a, b) => a.cost - b.cost);
  for (const c of cands) if (c.s !== s && !near.some(b => hitB(c.s, b))) return c.s;
  return null;
}

// Distance entre un triangle et une empreinte, en plan (0 s'ils se recouvrent).
export function triDist(tri, b) {
  for (const p of tri) if (sdist(p[0], p[1], b).d <= 0) return 0;
  const side = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
  const [A, B, C] = tri;
  for (const p of b.p) { const d1 = side(A, B, p), d2 = side(B, C, p), d3 = side(C, A, p); if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return 0; }
  const sd = (p, u, v) => { const dx = v[0] - u[0], dn = v[1] - u[1], l2 = dx * dx + dn * dn || 1e-9, t = Math.max(0, Math.min(1, ((p[0] - u[0]) * dx + (p[1] - u[1]) * dn) / l2)); return Math.hypot(p[0] - u[0] - t * dx, p[1] - u[1] - t * dn); };
  let best = Infinity;
  for (const r of b.holes ? [b.p, ...b.holes] : [b.p]) for (let i = 0; i < 3; i++) {
    const a = tri[i], c = tri[(i + 1) % 3];
    for (let k = 0, l = r.length - 1; k < r.length; l = k++) {
      const p = r[l], q = r[k];
      if (Math.sign(side(a, c, p)) !== Math.sign(side(a, c, q)) && Math.sign(side(p, q, a)) !== Math.sign(side(p, q, c))) return 0;
      best = Math.min(best, sd(a, p, q), sd(c, p, q), sd(p, a, c), sd(q, a, c));
    }
  }
  return best;
}

// Case de la nappe (carré de côté res, centre cx, cn) trop près d'un bâtiment? Disque inscrit et cercle circonscrit
// d'abord (distance du centre), test exact seulement entre les deux.
// Autour d'une forme du projet absente d'Overture (bâtiment neuf dans un boisé relevé avant lui), la clairière du
// chantier: 4 m sans sous-bois.
export const CLR_SHEET_NEW = 4;
export function sheetCellBlocked(cx, cn, res, P) {
  const rin = res / 2, rout = res * Math.SQRT1_2, R0 = rout + CLR_SHEET_NEW;
  for (const b of P.query(cx - R0, cn - R0, cx + R0, cn + R0)) {
    const mg = b.unmapped ? CLR_SHEET_NEW : CLR_SHEET, R = rout + mg;
    const d = sdist(cx, cn, b).d; if (d >= R) continue; if (d < rin + mg) return true;
    const x0 = cx - rin, x1 = cx + rin, n0 = cn - rin, n1 = cn + rin;
    if (Math.min(triDist([[x0, n0], [x1, n0], [x1, n1]], b), triDist([[x0, n0], [x1, n1], [x0, n1]], b)) < mg) return true;
  }
  return false;
}
// Triangle de la nappe (sommets déplacés) à moins de CLR_SHEET_MOVED d'un bâtiment?
export function sheetTriTooClose(tri, P) {
  let x0 = Infinity, n0 = Infinity, x1 = -Infinity, n1 = -Infinity; for (const p of tri) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); n0 = Math.min(n0, p[1]); n1 = Math.max(n1, p[1]); }
  const m = CLR_SHEET_MOVED; for (const b of P.query(x0 - m, n0 - m, x1 + m, n1 + m)) if (triDist(tri, b) < m) return true;
  return false;
}
