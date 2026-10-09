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
