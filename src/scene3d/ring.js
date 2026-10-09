// Mise au net de contours tracés sur une grille (surfaces pavées d'après l'imagerie, empreintes de toits d'après le
// LiDAR): fonctions pures, partagées par le moteur (src/scene3d) et les fonctions serveur (api/).
// Surfaces pavées d'après l'imagerie (contours tracés sur une grille de 0,4 m, marches de 2 à 3 m): mise au net en
// polygones aux côtés droits. 1) rééchantillonnage au mètre et moyenne glissante sur ±4 m (efface les marches);
// 2) Douglas-Peucker à 1,2 m (segments droits); 3) directions dominantes (histogramme des angles modulo 180°, cases de
// 5°, pondéré par la longueur; pics portant au moins 10 % du périmètre ou 12 m; la perpendiculaire de la principale est
// ajoutée); 4) chaque côté à moins de 12° d'une direction dominante y est aligné; 5) côtés consécutifs presque
// parallèles (< 15°) fusionnés; 6) sommets = intersections des côtés voisins (jonction par projection si l'intersection
// part trop loin). Les formes restent approximatives (voir docs/vue-3d.md), mais nettes plutôt qu'organiques.
export function smoothRing(r, step = 1, half = 4) {
  if (r.length < 3) return r;
  const pts = [];
  for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); const n = Math.max(1, Math.round(l / step)); for (let k = 0; k < n; k++) { const t = k / n; pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); } }
  const N = pts.length; if (N < 8) return r;
  const w = Math.min(Math.round(half / step), Math.floor((N - 1) / 2)), out = [];
  for (let i = 0; i < N; i++) { let x = 0, n = 0; for (let k = -w; k <= w; k++) { const q = pts[(i + k + N) % N]; x += q[0]; n += q[1]; } out.push([x / (2 * w + 1), n / (2 * w + 1)]); }
  return out;
}
export const segDist = (p, a, b) => { const dx = b[0] - a[0], dn = b[1] - a[1], l2 = dx * dx + dn * dn || 1e-9; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dn) / l2)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dn); };
export function dpClosed(r, eps) { // Douglas-Peucker sur un contour fermé (coupé au point le plus éloigné du premier)
  const n = r.length; if (n < 4) return r;
  let far = 1, fd = 0; for (let i = 1; i < n; i++) { const d = Math.hypot(r[i][0] - r[0][0], r[i][1] - r[0][1]); if (d > fd) { fd = d; far = i; } }
  const pts = r.concat([r[0]]), keep = new Uint8Array(n + 1); keep[0] = keep[far] = keep[n] = 1;
  const st = [[0, far], [far, n]];
  while (st.length) { const [a, b] = st.pop(); let best = 0, bi = -1; for (let k = a + 1; k < b; k++) { const d = segDist(pts[k], pts[a], pts[b]); if (d > best) { best = d; bi = k; } } if (best > eps) { keep[bi] = 1; st.push([a, bi], [bi, b]); } }
  const out = []; for (let i = 0; i < n; i++) if (keep[i]) out.push(r[i]); return out;
}
export const angDiff = (a, b) => { const d = Math.abs(a - b) % 180; return Math.min(d, 180 - d); };
export const meanAng = (items) => { let x = 0, y = 0; items.forEach(([a, w]) => { x += Math.cos(2 * a * Math.PI / 180) * w; y += Math.sin(2 * a * Math.PI / 180) * w; }); return ((Math.atan2(y, x) * 180 / Math.PI) / 2 + 180) % 180; };
export function regularizeRing(r, eps = 1.2, tol = 12, half = 4) { // half: portée du lissage (m); 2 pour une empreinte de maison, sinon les coins s'arrondissent
  const P = dpClosed(smoothRing(r, 1, half), eps), n = P.length; if (n < 3) return r;
  const ang = [], len = []; let total = 0;
  for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; const dx = b[0] - a[0], dn = b[1] - a[1], l = Math.hypot(dx, dn); len.push(l); total += l; ang.push(((Math.atan2(dn, dx) * 180 / Math.PI) % 180 + 180) % 180); }
  const bins = Array.from({ length: 36 }, () => []); for (let i = 0; i < n; i++) bins[Math.floor(ang[i] / 5) % 36].push([ang[i], len[i]]);
  const w = bins.map(b => b.reduce((s, x) => s + x[1], 0)), sm = w.map((v, i) => v + w[(i + 35) % 36] + w[(i + 1) % 36]);
  const dirs = [];
  for (let i = 0; i < 36; i++) if (sm[i] >= sm[(i + 35) % 36] && sm[i] > sm[(i + 1) % 36] && sm[i] >= Math.max(12, total * 0.1)) dirs.push({ th: meanAng([...bins[(i + 35) % 36], ...bins[i], ...bins[(i + 1) % 36]]), w: sm[i] });
  if (!dirs.length) return P;
  dirs.sort((a, b) => b.w - a.w); const perp = (dirs[0].th + 90) % 180; if (!dirs.some(d => angDiff(d.th, perp) < tol)) dirs.push({ th: perp, w: 0 });
  const lines = [];
  for (let i = 0; i < n; i++) {
    let th = ang[i], bd = tol; dirs.forEach(d => { const dd = angDiff(ang[i], d.th); if (dd < bd) { bd = dd; th = d.th; } });
    const a = P[i], b = P[(i + 1) % n]; lines.push({ x: (a[0] + b[0]) / 2, n: (a[1] + b[1]) / 2, th, len: len[i], i1: (i + 1) % n, parts: [[th, len[i]]] });
  }
  let changed = true;
  while (changed && lines.length > 3) {
    changed = false;
    for (let i = 0; i < lines.length && lines.length > 3; i++) {
      const A = lines[i], B = lines[(i + 1) % lines.length]; if (angDiff(A.th, B.th) >= 15) continue;
      const wt = A.len + B.len; A.x = (A.x * A.len + B.x * B.len) / wt; A.n = (A.n * A.len + B.n * B.len) / wt; A.parts = A.parts.concat(B.parts); A.th = meanAng(A.parts); A.len = wt; A.i1 = B.i1;
      lines.splice((i + 1) % lines.length, 1); changed = true; break;
    }
  }
  if (lines.length < 3) return P;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const A = lines[i], B = lines[(i + 1) % lines.length], V = P[A.i1];
    const ta = A.th * Math.PI / 180, tb = B.th * Math.PI / 180, ax = Math.cos(ta), an = Math.sin(ta), bx = Math.cos(tb), bn = Math.sin(tb), det = ax * bn - an * bx;
    let ok = false;
    if (Math.abs(det) > 1e-6) { const t = ((B.x - A.x) * bn - (B.n - A.n) * bx) / det, px = A.x + ax * t, pn = A.n + an * t; if (Math.hypot(px - V[0], pn - V[1]) <= Math.max(6, 0.75 * Math.max(A.len, B.len))) { out.push([px, pn]); ok = true; } }
    if (!ok) { const pa = (V[0] - A.x) * ax + (V[1] - A.n) * an, pb = (V[0] - B.x) * bx + (V[1] - B.n) * bn; out.push([A.x + ax * pa, A.n + an * pa], [B.x + bx * pb, B.n + bn * pb]); }
  }
  const res = []; for (const p of out) { const q = res[res.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.4) res.push(p); }
  if (res.length > 3 && Math.hypot(res[0][0] - res[res.length - 1][0], res[0][1] - res[res.length - 1][1]) <= 0.4) res.pop();
  return res.length >= 3 ? res : P;
}

// Mise d'équerre d'une empreinte de toit (9 octobre 2026): le contour tracé sur la grille LiDAR a des escaliers sur les
// bords d'un toit tourné par rapport à la grille, et la mise au net ci-dessus prend leurs diagonales pour des côtés
// (coins coupés, octogones, biseaux). Ici, l'axe principal du toit est celui de son rectangle englobant minimal, et
// seules deux directions sont admises, l'axe et sa perpendiculaire, sauf un vrai côté en biais (plus de minDiag mètres
// à plus de 35° des axes: pan coupé; plus court, c'est un coin rogné par un arbre; moins incliné, un escalier de maisons
// en rangée décalées, rendu par une marche). Côtés
// consécutifs de même direction fusionnés (moyenne pondérée) s'ils sont presque alignés, sinon reliés par une marche;
// sommets aux intersections; côtés de moins de 1 m retirés; un rectangle rempli à 86 % devient le rectangle (coin rogné
// par un arbre). Retourne null si le résultat n'est pas un polygone sain (moins de 4 sommets, aire qui s'écarte de plus
// de 30 % de celle du contour): l'appelant garde alors la mise au net ordinaire.
const polyArea = (r) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
export function minAreaRect(r) {
  let best = { area: Infinity, th: 0, ring: null };
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length]; if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.3) continue;
    const th = Math.atan2(q[1] - p[1], q[0] - p[0]), cs = Math.cos(th), sn = Math.sin(th);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, n] of r) { const u = x * cs + n * sn, v = -x * sn + n * cs; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (area < best.area) best = { area, th, ring: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => [u * cs - v * sn, u * sn + v * cs]) };
  }
  return best;
}
// Direction dominante d'un contour (radians, modulo 90°): celle des côtés qui, à 10° près, totalisent le plus de longueur.
export function dominantAngle(r) {
  const sides = [];
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]); if (len > 0.3) sides.push({ a: Math.atan2(q[1] - p[1], q[0] - p[0]), len }); }
  const diff = (a, b) => { let d = Math.abs(a - b) % (Math.PI / 2); return Math.min(d, Math.PI / 2 - d); };
  let best = 0, bs = -1;
  for (const s of sides) { let sc = 0; for (const t of sides) if (diff(s.a, t.a) < Math.PI / 18) sc += t.len; if (sc > bs) { bs = sc; best = s.a; } }
  return best;
}
// Rectangle englobant d'un contour dans le repère d'angle th: { area, th, ring }.
export function frameRect(r, th) {
  const cs = Math.cos(th), sn = Math.sin(th);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, n] of r) { const u = x * cs + n * sn, v = -x * sn + n * cs; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  if (!(u1 > u0 && v1 > v0)) return { area: Infinity, th, ring: null };
  return { area: (u1 - u0) * (v1 - v0), th, ring: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => [u * cs - v * sn, u * sn + v * cs]) };
}
export function orthogonalizeRing(raw, { eps = 0.8, half = 2, minDiag = 6, tol = 35, minSide = 1.0, minStep = 0.8, rectFill = 0.86 } = {}, dbg = {}) {
  const P = dpClosed(smoothRing(raw, 1, half), eps); if (P.length < 4) { dbg.why = 'P<4'; return null; }
  // Axe: la direction (modulo 90°) qui porte le plus de longueur de côtés (à 10° près). Le rectangle englobant minimal
  // s'aligne parfois sur la diagonale d'un coin coupé, et les vrais murs passeraient pour des biais.
  const th = dominantAngle(P), A0 = polyArea(P), mr = frameRect(P, th); if (!mr.ring) { dbg.why = 'rect'; return null; }
  if (A0 / mr.area >= rectFill) return mr.ring;
  const cs = Math.cos(th), sn = Math.sin(th), toF = ([x, n]) => [x * cs + n * sn, -x * sn + n * cs], fromF = ([u, v]) => [u * cs - v * sn, u * sn + v * cs];
  const Q = P.map(toF), n = Q.length, mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  // Côtés: classe 0 (le long de u, v constant c), 1 (le long de v, u constant c), 2 (biais long, droite par son milieu).
  // Un biais court est retiré: ses voisins se rejoignent en coin (ou en marche s'ils sont parallèles) à son milieu.
  let S = [];
  for (let i = 0; i < n; i++) {
    const a = Q[i], b = Q[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    const ang = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI) % 180, dH = Math.min(ang, 180 - ang), dV = Math.abs(ang - 90);
    const cls = dH <= tol ? 0 : dV <= tol ? 1 : len >= minDiag ? 2 : -1;
    S.push({ cls, len, a, b, c: cls === 0 ? (a[1] + b[1]) / 2 : cls === 1 ? (a[0] + b[0]) / 2 : 0, m: mid(a, b), th: Math.atan2(dy, dx) });
  }
  for (let i = 0; i < S.length; i++) if (S[i].cls === -1) { const m = S[i].m, A = S[(i + S.length - 1) % S.length], B = S[(i + 1) % S.length]; A.b = m; B.a = m; S.splice(i, 1); i--; }
  if (S.length < 3) { dbg.why = 'sides<3 (' + n + ' côtés)'; return null; }
  const lineOf = (s) => (s.cls === 0 ? { p: [0, s.c], d: [1, 0] } : s.cls === 1 ? { p: [s.c, 0], d: [0, 1] } : { p: s.m, d: [Math.cos(s.th), Math.sin(s.th)] });
  const merge = (A, B) => { const wt = A.len + B.len || 1; return { cls: A.cls, len: wt, a: A.a, b: B.b, c: (A.c * A.len + B.c * B.len) / wt, m: mid(A.m, B.m), th: A.th }; };
  let V = [];
  for (let pass = 0; pass < 10; pass++) {
    // Côtés consécutifs de même classe: fusionnés s'ils sont presque alignés, sinon une marche (côté perpendiculaire) les relie.
    for (let i = 0; i < S.length && S.length > 2; i++) {
      const A = S[i], B = S[(i + 1) % S.length]; if (A === B || A.cls !== B.cls || A.cls === 2) continue;
      if (Math.abs(A.c - B.c) < minStep) { const M = merge(A, B); S.splice(i, 1, M); S.splice(S.indexOf(B), 1); i--; continue; }
      const j = mid(A.b, B.a), riser = { cls: 1 - A.cls, len: Math.abs(A.c - B.c), a: A.b, b: B.a, c: A.cls === 0 ? j[0] : j[1], m: j, th: 0 };
      S.splice(i + 1, 0, riser); i++;
    }
    if (S.length < 3) { dbg.why = 'fusion<3'; return null; }
    // Sommets: intersection de chaque côté avec le suivant.
    V = [];
    for (let i = 0; i < S.length; i++) {
      const A = S[i], B = S[(i + 1) % S.length], L1 = lineOf(A), L2 = lineOf(B), det = L1.d[0] * L2.d[1] - L1.d[1] * L2.d[0];
      if (Math.abs(det) < 1e-6) { V.push(mid(A.b, B.a)); continue; }
      const t = ((L2.p[0] - L1.p[0]) * L2.d[1] - (L2.p[1] - L1.p[1]) * L2.d[0]) / det;
      V.push([L1.p[0] + L1.d[0] * t, L1.p[1] + L1.d[1] * t]);
    }
    // Longueurs réelles; le plus court sous minSide est retiré (ses voisins parallèles fusionnent, sinon ils se rejoignent en coin).
    let si = -1, sl = minSide;
    for (let i = 0; i < S.length; i++) { const a = V[(i + S.length - 1) % S.length], b = V[i]; S[i].len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (S[i].len < sl) { sl = S[i].len; si = i; } }
    if (si < 0 || S.length <= 4) break;
    const X = S[si], A = S[(si + S.length - 1) % S.length], B = S[(si + 1) % S.length];
    if (A.cls === B.cls && A.cls !== 2) { const M = merge(A, B); S[S.indexOf(A)] = M; S.splice(S.indexOf(B), 1); S.splice(S.indexOf(X), 1); }
    else { A.b = X.m; B.a = X.m; S.splice(si, 1); }
  }
  if (V.length < 4) { dbg.why = 'R<4'; return null; }
  const A1 = polyArea(V); if (!(A1 > 0) || Math.abs(A1 - A0) > 0.3 * A0) { dbg.why = 'aire ' + Math.round(A0) + ' -> ' + Math.round(A1) + ' (' + V.length + ' sommets)'; dbg.R = V.map(fromF); return null; }
  if (A1 / mr.area >= rectFill) return mr.ring;
  return V.map(fromF);
}
