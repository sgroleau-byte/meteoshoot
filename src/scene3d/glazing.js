// Vitrages d'un modèle importé (modelImport.js, après la passe de visibilité). Module pur (tableaux typés, ni three.js
// ni DOM): testable dans Node.
//
// Vitre = triangles de verre qui se touchent et restent parallèles (8 degrés) au plus grand d'entre eux. Chaque vitre
// est jugée par ce qu'il y a derrière elle: des rayons partent de points de la vitre, perpendiculairement, des deux
// côtés. Le premier obstacle d'un côté donne:
// - INTÉRIEUR: une surface jamais vue de l'extérieur par ce côté-là (l'intérieur que la visibilité retire);
// - MUR: une surface vue de l'extérieur, à moins de 25 cm, qui n'est pas du verre (fenêtre posée sur le revêtement ou
//   dans l'épaisseur du mur);
// - EXTÉRIEUR: une surface vue de l'extérieur plus loin, ou rien (le ciel) avant deux rayons du modèle.
// Les vitres parallèles à moins de 8 cm (verre en boîte de 1 cm, double vitrage) et les jumeaux superposés sont
// traversés: une boîte de verre ne se cache plus elle-même.
//   1 fenêtre: un côté INTÉRIEUR ou MUR, l'autre EXTÉRIEUR (ou, derrière des lattes à 25 cm au plus, l'obstacle proche du
//     côté où les autres points voient l'extérieur); vitre raide (60 degrés de pente ou plus); haut pris dans le
//     mur, le cadre ou le toit (voir topFree). Opaque, foncée, allumée la nuit.
//   2 verre libre: EXTÉRIEUR des deux côtés (garde-corps, clôture de piscine, auvent). Transparent, jamais allumé.
//   3 vitrage sombre: intérieur derrière sans être une fenêtre sûre (haut libre, vitre couchée: puits de lumière,
//     piscine; verre intérieur). Opaque et foncé, jamais allumé.
// Verre opaque (glass 2: opacité 1 mais bleu pâle, la convention des fenêtres de fabricants): fenêtre seulement si, en
// plus, la vitre fait 8 m² au plus et 20 cm de large au moins, n'est pas la face d'un solide (autre face du même
// morceau traversée, ou même matériau parallèle à moins de 40 cm derrière: planche, volet, porte peints en bleu), et si
// son matériau est une fenêtre sur les deux tiers au moins de ses vitres raides (sinon c'est de la peinture); sinon 0,
// matériau inchangé.
// Tranche (vitre de moins de 5 cm de large): classement de la plus grande vitre du même morceau de verre.
//
// F: { n, pos (n*9), nrm (n*3), area, mat, dbl, mate, glass (0 rien, 1 transparent, 2 verre opaque), radius }
// front, back: pixels vus de face et de dos (après retournement des faces simples); keep: 1 si le triangle est gardé.
export const T_THIN = 0.08, D_WALL = 0.25, COPLANAR = 0.99, PARALLEL = 0.95, STEEP = 0.5, STRIP = 0.05;
export const TOP_H = [0.15, 0.5, 0.8], TOP_HALF = 0.3, TOP_V0 = 0.12, TOP_V1 = 0.9, TOP_FREE = 0.6;
export const OPQ_MAX_AREA = 8, OPQ_MIN_W = 0.2, OPQ_SOLID = 0.4;
export const SEEN_MIN = 16; // pixels (passe de 2048): en dessous, une fuite entre deux triangles, pas une surface vue
const EXT = 0, WALL = 1, INT = 2;

// Grille uniforme sur tous les triangles (cases de 35 cm au moins, 64 sur la plus grande dimension), parcourue case
// par case le long du rayon. cast(o, d, L, accept, near, any): distance du premier impact accepté (Infinity sinon);
// near reçoit les triangles à moins de 1 mm de cette distance (jumeaux superposés); any: arrêt au premier impact.
export function caster(F) {
  const p = F.pos, n = F.n;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < n * 9; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  x0 -= 0.01; y0 -= 0.01; z0 -= 0.01; x1 += 0.01; y1 += 0.01; z1 += 0.01;
  const cs = Math.max(0.35, Math.max(x1 - x0, y1 - y0, z1 - z0) / 64);
  const nx = Math.ceil((x1 - x0) / cs), ny = Math.ceil((y1 - y0) / cs), nz = Math.ceil((z1 - z0) / cs), NC = nx * ny * nz;
  const cx = (v) => Math.min(nx - 1, Math.max(0, Math.floor((v - x0) / cs)));
  const cy = (v) => Math.min(ny - 1, Math.max(0, Math.floor((v - y0) / cs)));
  const cz = (v) => Math.min(nz - 1, Math.max(0, Math.floor((v - z0) / cs)));
  const cells = (t, fn) => {
    const o = t * 9;
    const i0 = cx(Math.min(p[o], p[o + 3], p[o + 6])), i1 = cx(Math.max(p[o], p[o + 3], p[o + 6]));
    const j0 = cy(Math.min(p[o + 1], p[o + 4], p[o + 7])), j1 = cy(Math.max(p[o + 1], p[o + 4], p[o + 7]));
    const k0 = cz(Math.min(p[o + 2], p[o + 5], p[o + 8])), k1 = cz(Math.max(p[o + 2], p[o + 5], p[o + 8]));
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn((k * ny + j) * nx + i);
  };
  const start = new Uint32Array(NC + 1);
  for (let t = 0; t < n; t++) cells(t, c => { start[c + 1]++; });
  for (let c = 0; c < NC; c++) start[c + 1] += start[c];
  const items = new Int32Array(start[NC]), fill = start.slice(0, NC);
  for (let t = 0; t < n; t++) cells(t, c => { items[fill[c]++] = t; });
  const stamp = new Int32Array(n), hs = [], ht = [];
  let ray = 0;
  const hitT = (t, ox, oy, oz, dx, dy, dz) => { // Möller-Trumbore
    const o = t * 9, ax = p[o], ay = p[o + 1], az = p[o + 2];
    const e1x = p[o + 3] - ax, e1y = p[o + 4] - ay, e1z = p[o + 5] - az, e2x = p[o + 6] - ax, e2y = p[o + 7] - ay, e2z = p[o + 8] - az;
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-14) return -1;
    const inv = 1 / det, tx = ox - ax, ty = oy - ay, tz = oz - az, u = (tx * px + ty * py + tz * pz) * inv;
    if (u < -1e-7 || u > 1 + 1e-7) return -1;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < -1e-7 || u + v > 1 + 1e-7) return -1;
    const h = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return h > 1e-5 ? h : -1;
  };
  return function cast(ox, oy, oz, dx, dy, dz, L, accept, near, any) {
    ray++; hs.length = 0; ht.length = 0; if (near) near.length = 0;
    let t0 = 0, t1 = L;
    const O = [ox, oy, oz], D = [dx, dy, dz], lo = [x0, y0, z0], hi = [x1, y1, z1];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(D[a]) < 1e-12) { if (O[a] < lo[a] || O[a] > hi[a]) return Infinity; continue; }
      let ta = (lo[a] - O[a]) / D[a], tb = (hi[a] - O[a]) / D[a];
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
    }
    if (t0 > t1) return Infinity;
    let i = cx(ox + dx * t0), j = cy(oy + dy * t0), k = cz(oz + dz * t0);
    const si = dx > 0 ? 1 : -1, sj = dy > 0 ? 1 : -1, sk = dz > 0 ? 1 : -1;
    const di = dx ? cs / Math.abs(dx) : Infinity, dj = dy ? cs / Math.abs(dy) : Infinity, dk = dz ? cs / Math.abs(dz) : Infinity;
    let mi = dx ? (x0 + (i + (dx > 0 ? 1 : 0)) * cs - ox) / dx : Infinity;
    let mj = dy ? (y0 + (j + (dy > 0 ? 1 : 0)) * cs - oy) / dy : Infinity;
    let mk = dz ? (z0 + (k + (dz > 0 ? 1 : 0)) * cs - oz) / dz : Infinity;
    let best = Infinity;
    for (;;) {
      const c = (k * ny + j) * nx + i;
      for (let s = start[c], e = start[c + 1]; s < e; s++) {
        const t = items[s];
        if (stamp[t] === ray) continue;
        stamp[t] = ray;
        const h = hitT(t, ox, oy, oz, dx, dy, dz);
        if (h < 0 || h > L || h > best + 1e-3 || !accept(t, h)) continue;
        if (any) return h;
        hs.push(t); ht.push(h); if (h < best) best = h;
      }
      const tx = Math.min(mi, mj, mk);
      if (best + 1e-3 <= tx || tx > t1) break;
      if (mi === tx) { i += si; mi += di; if (i < 0 || i >= nx) break; }
      else if (mj === tx) { j += sj; mj += dj; if (j < 0 || j >= ny) break; }
      else { k += sk; mk += dk; if (k < 0 || k >= nz) break; }
    }
    if (near) for (let q = 0; q < hs.length; q++) if (ht[q] <= best + 1e-3) near.push(hs[q]);
    return best;
  };
}

export function glazingKinds(F, front, back, keep) {
  const P = F.pos, N = F.nrm, A = F.area, n = F.n;
  const q = x => Math.round(x * 1000), vkey = (t, j) => { const o = t * 9 + j * 3; return q(P[o]) + ',' + q(P[o + 1]) + ',' + q(P[o + 2]); };
  const dotN = (t, x, y, z) => N[t * 3] * x + N[t * 3 + 1] * y + N[t * 3 + 2] * z;
  const byVertex = new Map(), list = [];
  for (let t = 0; t < n; t++) {
    if (!F.glass[t]) continue;
    list.push(t);
    for (let j = 0; j < 3; j++) { const k = vkey(t, j), l = byVertex.get(k); if (l) l.push(t); else byVertex.set(k, [t]); }
  }
  list.sort((a, b) => A[b] - A[a]);
  // Vitres (parallèles) et morceaux de verre (reliés par un sommet, toutes orientations).
  const paneOf = new Int32Array(n).fill(-1), panes = [];
  for (const s of list) {
    if (paneOf[s] >= 0) continue;
    const pid = panes.length, pane = [s];
    paneOf[s] = pid;
    for (let i = 0; i < pane.length; i++) {
      const t = pane[i];
      for (let j = 0; j < 3; j++) for (const u of byVertex.get(vkey(t, j))) if (paneOf[u] < 0 && (F.glass[u] === F.glass[s] || F.mate[u] === t) && Math.abs(dotN(u, N[s * 3], N[s * 3 + 1], N[s * 3 + 2])) > COPLANAR) { paneOf[u] = pid; pane.push(u); } // types de verre mêlés: seulement les deux côtés d'un même triangle (sinon un mur bleu pâle rejoint la vitre dessinée à son nu)
    }
    panes.push(pane);
  }
  const bodyOf = new Int32Array(n).fill(-1);
  let nb = 0;
  for (const s of list) {
    if (bodyOf[s] >= 0) continue;
    const st = [s]; bodyOf[s] = nb;
    while (st.length) { const t = st.pop(); for (let j = 0; j < 3; j++) for (const u of byVertex.get(vkey(t, j))) if (bodyOf[u] < 0) { bodyOf[u] = nb; st.push(u); } }
    nb++;
  }
  const cast = caster(F), near = [], L = 2 * F.radius, opq = new Map(); // opq: matériau -> [aire fenêtre, aire autre]
  const pa0 = panes.map(p => p.reduce((x, t) => x + A[t], 0)); // aire de chaque vitre (un grand pan bleu opaque est un revêtement, pas du verre)
  const kinds = new Uint8Array(panes.length), strip = new Uint8Array(panes.length), shown = new Uint8Array(panes.length), paneArea = new Float64Array(panes.length);
  for (let pid = 0; pid < panes.length; pid++) {
    const pane = panes[pid], s = pane[0], so = s * 9;
    let a = 0, seen = false, transp = false;
    const mats = new Set();
    for (const t of pane) { a += A[t]; if (keep[t]) seen = true; if (F.glass[t] === 1) transp = true; mats.add(F.mat[t]); }
    paneArea[pid] = a; shown[pid] = seen ? 1 : 0;
    const nx = N[s * 3], ny = N[s * 3 + 1], nz = N[s * 3 + 2];
    // Largeur et hauteur dans le repère d'un côté du plus grand triangle (le plus étroit des trois).
    let wMin = Infinity;
    for (let e = 0; e < 3; e++) {
      const a0 = so + e * 3, a1 = so + ((e + 1) % 3) * 3;
      let ex = P[a1] - P[a0], ey = P[a1 + 1] - P[a0 + 1], ez = P[a1 + 2] - P[a0 + 2];
      const d = ex * nx + ey * ny + ez * nz; ex -= d * nx; ey -= d * ny; ez -= d * nz;
      const l = Math.hypot(ex, ey, ez); ex /= l; ey /= l; ez /= l;
      const fx = ny * ez - nz * ey, fy = nz * ex - nx * ez, fz = nx * ey - ny * ex;
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const t of pane) for (let j = 0; j < 3; j++) { const o = t * 9 + j * 3, pu = P[o] * ex + P[o + 1] * ey + P[o + 2] * ez, pv = P[o] * fx + P[o + 1] * fy + P[o + 2] * fz; if (pu < u0) u0 = pu; if (pu > u1) u1 = pu; if (pv < v0) v0 = pv; if (pv > v1) v1 = pv; }
      wMin = Math.min(wMin, u1 - u0, v1 - v0);
    }
    if (wMin < STRIP) { strip[pid] = 1; continue; }
    if (!seen) continue; // retirée entière: rien à décider
    // Premier obstacle dans la direction d: [EXT | WALL | INT, distance, solide]. solide (verre opaque seulement): une
    // autre face du même morceau traversée (boîte pleine: volet, planche) ou le même matériau parallèle à moins de 40 cm.
    const probe = (ox, oy, oz, dx, dy, dz) => {
      let own = -1; // distance de l'autre face du même morceau traversée (-1: aucune)
      const h = cast(ox, oy, oz, dx, dy, dz, L, (u, hh) => {
        if (paneOf[u] === pid) return false;
        if (Math.abs(dotN(u, dx, dy, dz)) <= PARALLEL) return true;
        if (hh < 1e-3) return false; // jumeau superposé
        if (F.glass[u] && hh < T_THIN) { if (bodyOf[u] === bodyOf[s]) own = Math.max(own, hh); return false; } // autre feuille du même vitrage
        return true;
      }, near);
      // Solide (verre opaque): pièce épaisse (2,5 cm ou plus: volet, porte) ou plaquée sur ce qu'il y a juste derrière (planche
      // sur le mur); une vitre bleue en boîte de 4 mm à 2,4 cm dans une ouverture reste une fenêtre.
      const solid = own >= 0.025 || (own >= 0 && h - own < 0.005);
      if (h === Infinity) return [EXT, h, solid];
      let vis = false, same = solid, glass = false;
      for (const u of near) {
        const f = dotN(u, dx, dy, dz);
        if (f < 0 ? front[u] >= SEEN_MIN : F.dbl[u] && back[u] >= SEEN_MIN) vis = true;
        if (F.glass[u] === 1 || (F.glass[u] && pa0[paneOf[u]] <= OPQ_MAX_AREA)) glass = true; // un revêtement bleu pâle n'est pas un verre
        if (Math.abs(f) > PARALLEL && h < OPQ_SOLID && mats.has(F.mat[u])) same = true;
      }
      // Un autre verre vu juste derrière n'est pas un mur: balconnet devant une porte-fenêtre, contre-fenêtre.
      return [vis ? (h <= D_WALL && !glass ? WALL : EXT) : INT, h, same];
    };
    // Points d'essai: 4 points dans chacun des plus grands triangles (2 % de l'aire de la vitre au moins), pondérés.
    const big = pane.slice().sort((x, y) => A[y] - A[x]).slice(0, 6);
    let wFree = 0, wWin = 0, wIn = 0, ox = 0, oy = 0, oz = 0, wSolid = 0, wScrP = 0, wScrM = 0;
    for (const t of big) {
      if (A[t] < 0.02 * a) break;
      const o = t * 9, w = A[t] / 4;
      for (const b of [[1 / 3, 1 / 3, 1 / 3], [0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6]]) {
        const px = b[0] * P[o] + b[1] * P[o + 3] + b[2] * P[o + 6], py = b[0] * P[o + 1] + b[1] * P[o + 4] + b[2] * P[o + 7], pz = b[0] * P[o + 2] + b[1] * P[o + 5] + b[2] * P[o + 8];
        const rp = probe(px, py, pz, nx, ny, nz), rm = probe(px, py, pz, -nx, -ny, -nz);
        if (rp[0] && rm[0]) { const np = rp[1] <= D_WALL, nm = rm[1] <= D_WALL; if (np && !nm) wScrP += w; else if (nm && !np) wScrM += w; else wIn += w; }
        else if (rp[0] || rm[0]) {
          wWin += w;
          const sg = rp[0] ? -1 : 1; ox += sg * nx * w; oy += sg * ny * w; oz += sg * nz * w; // vers l'extérieur
          if ((rp[0] ? rp : rm)[2]) wSolid += w;
        } else wFree += w;
      }
    }
    // Écran devant la vitre (lattes, brise-soleil, volet entrouvert à 25 cm ou moins: obstacle proche d'un côté, intérieur
    // loin de l'autre): compte comme fenêtre si l'obstacle proche est du côté où les autres points voient l'extérieur.
    const outP = ox * nx + oy * ny + oz * nz > 0;
    if (wWin > 0) { const add = outP ? wScrP : wScrM; wWin += add; wIn += outP ? wScrM : wScrP; ox += (outP ? 1 : -1) * nx * add; oy += (outP ? 1 : -1) * ny * add; oz += (outP ? 1 : -1) * nz * add; }
    else wIn += wScrP + wScrM;
    const tot = wFree + wWin + wIn || 1;
    let k = transp ? 3 : 0;
    if (wFree / tot >= 0.5) k = transp ? 2 : 0;
    else if (wWin / tot >= 0.5 && Math.abs(ny) <= STEEP) {
      const l = Math.hypot(ox, oy, oz), sg = l > 1e-9 ? 1 / l : 0; // normale vers l'extérieur (moyenne des votes)
      let win = topFree(cast, P, pane, pid, paneOf, sg ? ox * sg : nx, sg ? oy * sg : ny, sg ? oz * sg : nz) < TOP_FREE;
      if (win && !transp) win = a <= OPQ_MAX_AREA && wMin >= OPQ_MIN_W && wSolid / wWin < 0.5;
      k = win ? 1 : transp ? 3 : 0;
    }
    kinds[pid] = k;
    if (!transp && Math.abs(ny) <= STEEP && wWin + wIn > 0) for (const m of mats) { const v = opq.get(m) || [0, 0]; v[k === 1 ? 0 : 1] += a; opq.set(m, v); }
  }
  // Verre opaque: un matériau bleu pâle n'est du verre que si les deux tiers au moins de ses vitres raides (en aire)
  // sont des fenêtres; sinon c'est de la peinture (volets, planches, panneaux) et rien de ce matériau ne s'allume.
  for (let pid = 0; pid < panes.length; pid++) {
    if (kinds[pid] !== 1 || panes[pid].some(t => F.glass[t] === 1)) continue;
    if (panes[pid].some(t => { const v = opq.get(F.mat[t]); return v && v[0] < 2 * v[1]; })) kinds[pid] = 0;
  }
  // Tranches: classement de la plus grande vitre gardée (non tranche) du même morceau de verre.
  const bestOf = new Int32Array(nb).fill(-1);
  for (let pid = 0; pid < panes.length; pid++) if (!strip[pid] && shown[pid]) { const b = bodyOf[panes[pid][0]]; if (bestOf[b] < 0 || paneArea[pid] > paneArea[bestOf[b]]) bestOf[b] = pid; }
  for (let pid = 0; pid < panes.length; pid++) if (strip[pid]) {
    const b = bestOf[bodyOf[panes[pid][0]]];
    kinds[pid] = b >= 0 ? kinds[b] : panes[pid].some(t => F.glass[t] === 1) ? 2 : 0;
  }
  // Par triangle (le verre opaque ne change que s'il devient fenêtre) et bilan des vitres gardées.
  const kind = new Uint8Array(n), stats = { windows: 0, opaqueWindows: 0, free: 0, dark: 0, litArea: 0 };
  for (let pid = 0; pid < panes.length; pid++) {
    const k = kinds[pid];
    let opq = true;
    for (const t of panes[pid]) {
      kind[t] = F.glass[t] === 1 || k === 1 ? k : 0;
      if (!keep[t]) continue;
      if (F.glass[t] === 1) opq = false;
      if (kind[t] === 1) stats.litArea += A[t];
    }
    if (!shown[pid] || strip[pid]) continue;
    if (k === 1) { stats.windows++; if (opq) stats.opaqueWindows++; } else if (k === 2) stats.free++; else if (k === 3) stats.dark++;
  }
  stats.litArea = Math.round(stats.litArea * 10) / 10;
  return { kind, stats, kinds, panes };
}

// Part des colonnes (10, 30, 50, 70 et 90 % de la largeur) dont le dessus est libre: rien sur un segment de 60 cm à
// travers le plan de la vitre à 15, 50 et 80 cm au-dessus de son bord haut, ni sur un rayon vertical de 12 à 90 cm
// au-dessus. Garde-corps: 1 (air libre au-dessus, une main courante de 12 cm au plus ne compte pas). Fenêtre: 0 (mur,
// linteau, avant-toit, dalle de toit de 15 cm ou plus). (ox, oy, oz): normale vers l'extérieur.
function topFree(cast, P, pane, pid, paneOf, nx, ny, nz) {
  const l = Math.hypot(nz, nx), ux = nz / l, uz = -nx / l; // horizontale dans le plan
  const vx = ny * uz, vy = nz * ux - nx * uz, vz = -ny * ux; // vers le haut dans le plan (n x u)
  let u0 = Infinity, u1 = -Infinity;
  for (const t of pane) for (let j = 0; j < 3; j++) { const o = t * 9 + j * 3, pu = P[o] * ux + P[o + 2] * uz; if (pu < u0) u0 = pu; if (pu > u1) u1 = pu; }
  const hit = (sx, sy, sz, dx, dy, dz, len) => cast(sx, sy, sz, dx, dy, dz, len, (u) => paneOf[u] !== pid, null, true) !== Infinity;
  let free = 0, cols = 0;
  for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    const uc = u0 + f * (u1 - u0);
    let top = -Infinity, bx = 0, by = 0, bz = 0;
    for (const t of pane) for (let j = 0; j < 3; j++) { // bord haut de la vitre dans cette colonne
      const a = t * 9 + j * 3, b = t * 9 + ((j + 1) % 3) * 3;
      const ua = P[a] * ux + P[a + 2] * uz, ub = P[b] * ux + P[b + 2] * uz;
      if ((ua - uc) * (ub - uc) > 0 || ua === ub) continue;
      const s = (uc - ua) / (ub - ua), x = P[a] + s * (P[b] - P[a]), y = P[a + 1] + s * (P[b + 1] - P[a + 1]), z = P[a + 2] + s * (P[b + 2] - P[a + 2]);
      const tv = x * vx + y * vy + z * vz;
      if (tv > top) { top = tv; bx = x; by = y; bz = z; }
    }
    if (top === -Infinity) continue;
    cols++;
    let blocked = false;
    for (const h of TOP_H) if (!blocked && hit(bx + h * vx - TOP_HALF * nx, by + h * vy - TOP_HALF * ny, bz + h * vz - TOP_HALF * nz, nx, ny, nz, 2 * TOP_HALF)) blocked = true;
    if (!blocked && hit(bx + TOP_V0 * vx, by + TOP_V0 * vy, bz + TOP_V0 * vz, vx, vy, vz, TOP_V1 - TOP_V0)) blocked = true;
    if (!blocked) free++;
  }
  return cols ? free / cols : 0;
}
