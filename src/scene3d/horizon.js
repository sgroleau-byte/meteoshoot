// Profil d'horizon du relief: pour 36 directions (tous les 10 degrés depuis le nord, sens horaire), l'angle le plus haut
// que fait le sol jusqu'à 20 km, vu de 1,6 m au-dessus du sol du lieu, courbure de la Terre comprise (réfraction
// ordinaire, coefficient 0,13: 2,7 m à 5 km, 27 m à 20 km). Pas de 10 m jusqu'à 300 m, 25 m jusqu'à 1,5 km, 100 m jusqu'à
// 5 km, puis 200 m. Même calcul côté serveur (api/horizon.js: barre « ombre du terrain » de la bande horaire de la fiche
// projet) et dans la vue 3D (engine.js, sur le relief qu'elle a chargé): les deux donnent le même profil par
// construction, que la 3D ait été ouverte ou non (v633.186). Jusqu'à la v633.193 (HORIZON_V 1), le profil s'arrêtait à
// 5 km alors que la 3D portait l'ombre du relief jusqu'à 10 km. Module sans dépendance: importé par les deux côtés.
// hTri(x, n): hauteur du sol en mètres à x mètres à l'est et n mètres au nord du lieu.
export const HORIZON_V = 2;
export const HORIZON_DIRS = 36;
export const EARTH_R = 6371000, REFRACT_K = 0.13; // rayon terrestre et coefficient de réfraction ordinaire
export const curvDrop = (d) => d * d * (1 - REFRACT_K) / (2 * EARTH_R); // abaissement apparent d'un point du sol à d mètres
export function horizonProfile(hTri, eye = 1.6) {
  const z0 = hTri(0, 0) + eye, out = [];
  for (let d = 0; d < HORIZON_DIRS; d++) {
    const br = d * (360 / HORIZON_DIRS) * Math.PI / 180, sx = Math.sin(br), cx = Math.cos(br); let maxAngle = 0;
    for (let dist = 10; dist <= 20000; dist += dist < 300 ? 10 : dist < 1500 ? 25 : dist < 5000 ? 100 : 200) {
      const z = hTri(dist * sx, dist * cx) - curvDrop(dist); if (!(z > z0)) continue;
      const ang = Math.atan2(z - z0, dist) * 180 / Math.PI; if (ang > maxAngle) maxAngle = ang;
    }
    out.push({ bearing: d * (360 / HORIZON_DIRS), maxAngle: Math.round(maxAngle * 100) / 100 });
  }
  return out;
}
// Relief lointain polaire de /api/terrain (far: anneau k au rayon r0 x grow^k, direction j à j x 360 / dirs degrés depuis
// le nord, sens horaire), hauteurs H (Float32Array rings x dirs, en mètres): hauteur dans le plan du triangle du maillage
// dessiné (engine.js farMesh: triangles (a, b, c) et (b, d, c), a = (k, j), b = (k, j + 1), c = (k + 1, j), d = (k + 1,
// j + 1), en coordonnées est et nord), pour qu'un objet posé au-delà de r0 ne flotte pas; prolongé au-delà du premier et du
// dernier anneau. Même fonction côté client et serveur.
export function farSampler(far, H) {
  const R = far.rings, D = far.dirs, lg = Math.log(far.grow), r0 = far.r0, TAU = 2 * Math.PI;
  const rr = new Float64Array(R); for (let k = 0; k < R; k++) rr[k] = r0 * Math.pow(far.grow, k);
  const sn = new Float64Array(D), cs = new Float64Array(D); for (let j = 0; j < D; j++) { sn[j] = Math.sin(j * TAU / D); cs[j] = Math.cos(j * TAU / D); }
  const bary = (px, pn, x1, n1, x2, n2, x3, n3) => { const det = (n2 - n3) * (x1 - x3) + (x3 - x2) * (n1 - n3), l1 = ((n2 - n3) * (px - x3) + (x3 - x2) * (pn - n3)) / det, l2 = ((n3 - n1) * (px - x3) + (x1 - x3) * (pn - n3)) / det; return [l1, l2, 1 - l1 - l2]; };
  return (x, n) => {
    const r = Math.hypot(x, n);
    let kf = r > r0 ? Math.log(r / r0) / lg : 0; if (kf > R - 1) kf = R - 1;
    const k = Math.min(R - 2, Math.floor(kf));
    let b = Math.atan2(x, n); if (b < 0) b += TAU;
    const j0 = Math.floor(b / TAU * D) % D, j1 = (j0 + 1) % D, r1 = rr[k], r2 = rr[k + 1];
    const ax = r1 * sn[j0], an = r1 * cs[j0], bx = r1 * sn[j1], bn = r1 * cs[j1], cx = r2 * sn[j0], cn = r2 * cs[j0], dx = r2 * sn[j1], dn = r2 * cs[j1];
    const ha = H[k * D + j0], hb = H[k * D + j1], hc = H[(k + 1) * D + j0], hd = H[(k + 1) * D + j1];
    const w = bary(x, n, ax, an, bx, bn, cx, cn);
    if (w[0] >= -1e-9 && w[1] >= -1e-9 && w[2] >= -1e-9) return w[0] * ha + w[1] * hb + w[2] * hc;
    const v = bary(x, n, bx, bn, dx, dn, cx, cn);
    return v[0] * hb + v[1] * hd + v[2] * hc;
  };
}
// Relief complet: la grille carrée en deçà du premier anneau lointain, la grille polaire au-delà (ses premiers anneaux
// partent de la surface de la grille carrée: pas de marche).
export function combinedSampler(nearFn, farFn, r0) {
  if (!farFn) return nearFn;
  return (x, n) => (x * x + n * n < r0 * r0 ? nearFn(x, n) : farFn(x, n));
}
// Hauteurs du relief lointain décodées (base64 Int16 en décimètres au-dessus de far.hMin).
export function farHeights(far, decode) {
  const q = decode(far.h, far.rings * far.dirs), H = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) H[i] = far.hMin + q[i] / 10;
  return H;
}
// Échantillonneur de la grille non uniforme de /api/terrain (axe ax en mètres, hauteurs H en mètres, N x N): hauteur sur
// la surface du maillage par le plan du triangle de la cellule, même diagonale que src/scene3d/terrain.js (hTriOf).
export function gridSampler(ax, H) {
  const N = ax.length;
  const idx = (v) => { if (v <= ax[0]) return 0; if (v >= ax[N - 1]) return N - 2; let lo = 0, hi = N - 2; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ax[m] <= v) lo = m; else hi = m - 1; } return lo; };
  return (x, n) => {
    const i = idx(x), j = idx(n), u = (x - ax[i]) / (ax[i + 1] - ax[i]), v = (n - ax[j]) / (ax[j + 1] - ax[j]);
    const k = j * N + i, h00 = H[k], h10 = H[k + 1], h01 = H[k + N], h11 = H[k + N + 1];
    return v <= u ? h00 + (h10 - h00) * u + (h11 - h10) * v : h00 + (h11 - h01) * u + (h01 - h00) * v;
  };
}
