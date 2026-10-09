// Profil d'horizon du relief: pour 36 directions (tous les 10 degrés depuis le nord, sens horaire), l'angle le plus haut
// que fait le sol jusqu'à 5 km, vu de 1,6 m au-dessus du sol du lieu. Pas de 10 m jusqu'à 300 m, 25 m jusqu'à 1,5 km,
// puis 100 m. Même calcul côté serveur (api/horizon.js: barre « ombre du terrain » de la bande horaire de la fiche
// projet) et dans la vue 3D (engine.js, sur le relief qu'elle a chargé): les deux donnent le même profil par
// construction, que la 3D ait été ouverte ou non (v633.186). Module sans dépendance: importé par les deux côtés.
// hTri(x, n): hauteur du sol en mètres à x mètres à l'est et n mètres au nord du lieu.
export const HORIZON_V = 1;
export const HORIZON_DIRS = 36;
export function horizonProfile(hTri, eye = 1.6) {
  const z0 = hTri(0, 0) + eye, out = [];
  for (let d = 0; d < HORIZON_DIRS; d++) {
    const br = d * (360 / HORIZON_DIRS) * Math.PI / 180, sx = Math.sin(br), cx = Math.cos(br); let maxAngle = 0;
    for (let dist = 10; dist <= 5000; dist += dist < 300 ? 10 : dist < 1500 ? 25 : 100) {
      const z = hTri(dist * sx, dist * cx); if (!(z > z0)) continue;
      const ang = Math.atan2(z - z0, dist) * 180 / Math.PI; if (ang > maxAngle) maxAngle = ang;
    }
    out.push({ bearing: d * (360 / HORIZON_DIRS), maxAngle: Math.round(maxAngle * 100) / 100 });
  }
  return out;
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
