// Empreintes dessinées dans le projet, converties en mètres autour d'une origine (x vers l'est, n vers le
// nord). Le même module sert à la vue 3D (engine.js) et à l'analyse des images (style.js): les lettres des
// volumes (A, B, C, par surface décroissante) et les numéros de côtés (A1, A2...) désignent ainsi les mêmes
// murs des deux côtés, à l'analyse comme au rendu.
//
// Convention des côtés: contour en sens antihoraire vu du ciel; le côté Ak va du sommet k au sommet k+1 et,
// vu de l'extérieur, debout devant la façade, le sommet k est à gauche et le sommet k+1 à droite.
export const DIRS = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'];

export const signedArea = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
export const centroid = (r) => { let x = 0, n = 0; for (const p of r) { x += p[0]; n += p[1]; } return [x / r.length, n / r.length]; };
export const metersPerDeg = (lat) => ({ mLat: 111320, mLng: 111320 * Math.cos(lat * Math.PI / 180) });

// Formes dessinées -> contours locaux (sens antihoraire), avec la hauteur réglée et le drapeau « jamais réglée »
// (30 m est la valeur par défaut du dessin).
export function localRings(buildings, origin) {
  const { mLat, mLng } = metersPerDeg(origin[0]);
  return (buildings || []).map((b, i) => {
    let r = (b.polygon || []).map(q => [(q.lng - origin[1]) * mLng, (q.lat - origin[0]) * mLat]);
    if (signedArea(r) < 0) r = r.reverse();
    return { p: r, h: Math.max(2, b.height || 10), def: b.height === 30 || b.height == null, i };
  }).filter(b => b.p.length >= 3);
}

// Lettres par surface décroissante, côtés numérotés dans le sens du contour avec leur normale extérieure,
// leur orientation (cap de la normale, 0 = nord, sens horaire) et leur longueur.
export function labelShapes(rings) {
  const order = rings.map((r, i) => ({ i, a: Math.abs(signedArea(r.p)) })).sort((x, y) => y.a - x.a);
  return order.map(({ i, a }, k) => {
    const r = rings[i], label = String.fromCharCode(65 + k), edges = [];
    for (let j = 0; j < r.p.length; j++) {
      const A = r.p[j], B = r.p[(j + 1) % r.p.length];
      const ex = B[0] - A[0], en = B[1] - A[1], len = Math.hypot(ex, en);
      if (len < 0.05) continue;
      const nx = en / len, nn = -ex / len; // à droite du sens de parcours = extérieur (contour antihoraire)
      const bearing = (Math.atan2(nx, nn) * 180 / Math.PI + 360) % 360;
      edges.push({ id: `${label}${j + 1}`, j, a: A, b: B, len, nrm: [nx, nn], bearing, dir: DIRS[Math.round(bearing / 45) % 8], mid: [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2] });
    }
    return { label, ring: r, area: a, edges };
  });
}

// Signature des formes (nombre et sommets, sans les hauteurs): une analyse de façades ne vaut que pour les
// formes qu'elle a vues; si le dessin change, les volumes et façades analysés sont ignorés jusqu'à la prochaine analyse.
export function shapesSignature(buildings) {
  const parts = (buildings || []).map(b => (b.polygon || []).map(q => `${Number(q.lat).toFixed(6)},${Number(q.lng).toFixed(6)}`).join(';'));
  const s = parts.join('|'); let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `${parts.length}-${h.toString(36)}`;
}

// Distance d'un point à une polyligne (mètres locaux).
export function distToPolyline(p, line) {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1]; const dx = b[0] - a[0], dn = b[1] - a[1], l2 = dx * dx + dn * dn || 1e-9;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dn) / l2));
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dn));
  }
  return best;
}
