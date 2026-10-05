// Empreintes dessinées dans le projet, converties en mètres autour d'une origine (x vers l'est, n vers le
// nord), et côtés de chaque forme avec leur orientation (pour la légende de la vue 3D: « Forme 1, côté sud-ouest »).
export const DIRS = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'];

export const signedArea = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
export const centroid = (r) => { let x = 0, n = 0; for (const p of r) { x += p[0]; n += p[1]; } return [x / r.length, n / r.length]; };

// Formes dessinées -> contours locaux en sens antihoraire, hauteur réglée et drapeau « jamais réglée »
// (30 m est la valeur par défaut du dessin, pas une vraie hauteur); i = index de la forme dans le projet.
export function localRings(buildings, origin) {
  const mLat = 111320, mLng = 111320 * Math.cos(origin[0] * Math.PI / 180);
  return (buildings || []).map((b, i) => {
    let r = (b.polygon || []).map(q => [(q.lng - origin[1]) * mLng, (q.lat - origin[0]) * mLat]);
    if (signedArea(r) < 0) r = r.reverse();
    return { p: r, h: Math.max(2, b.height || 10), def: b.height === 30 || b.height == null, i };
  }).filter(b => b.p.length >= 3);
}

// Côtés d'un contour antihoraire: milieu, longueur, normale extérieure (à droite du sens de parcours) et orientation.
export function edgesOf(ring) {
  const edges = [];
  for (let j = 0; j < ring.length; j++) {
    const A = ring[j], B = ring[(j + 1) % ring.length];
    const ex = B[0] - A[0], en = B[1] - A[1], len = Math.hypot(ex, en);
    if (len < 0.05) continue;
    const nx = en / len, nn = -ex / len, bearing = (Math.atan2(nx, nn) * 180 / Math.PI + 360) % 360;
    edges.push({ len, nrm: [nx, nn], dir: DIRS[Math.round(bearing / 45) % 8], mid: [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2] });
  }
  return edges;
}
