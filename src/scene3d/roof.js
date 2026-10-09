// Toits en pente (9 octobre 2026): géométrie commune au serveur (api/roofs.js, qui ajuste le modèle au relevé LiDAR) et
// au moteur (engine.js, qui dessine les versants). Aucune dépendance.
//
// Un toit: { he, w: [aile, ...] }; he: hauteur de l'égout le plus bas (m au-dessus du sol moyen de l'empreinte, le repère
// des murs dans le moteur: les murs montent jusque là). Une aile: [th, u0, v0, u1, v1, he, hr, rv, cap, ends]
// - th: angle du repère (radians); u = x cos th + n sin th, v = -x sin th + n cos th (x est, n nord, mètres locaux);
// - u0, v0, u1, v1: rectangle de l'aile dans ce repère, le faîte parallèle à u;
// - he: hauteur de l'égout de l'aile, hr: hauteur du faîte (ou du plat du sommet);
// - rv: position du faîte entre v0 (0) et v1 (1); 0 ou 1: un seul versant (appentis), le haut en v0 ou en v1;
// - cap: part de la montée où le toit s'aplatit (1: faîte pointu; 0,7: sommet plat, toit brisé ou plat à quatre versants);
// - ends: bits 1 et 2: pignon (mur vertical) au bout u0 et au bout u1, sinon croupe (versant de même pente que le côté le
//   plus raide); bits 4 et 8: bout caché sous une autre aile (rien de dessiné au bout, faîte jusqu'au bord).
// Une aile dont l'égout est plus haut que celui du toit reçoit un bandeau de mur de he (toit) à he (aile) sur ses quatre
// côtés (la partie intérieure disparaît sous les autres ailes: maison au-dessus de son garage). Un côté en biais de
// l'empreinte (pan coupé) dont les deux bouts sont sur le bord d'une aile rogne les faces de cette aile.
export const GABLE_A = 1, GABLE_B = 2, HIDDEN_A = 4, HIDDEN_B = 8;

const signedArea = (r) => r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
const dedupe = (p) => p.filter((q, i) => { const r = p[(i + 1) % p.length]; return Math.hypot(q[0] - r[0], q[1] - r[1]) > 1e-3 || Math.abs(q[2] - r[2]) > 1e-3; });

// Faces d'une aile dans son repère: { p: [[u, v, z], ...], wall } (polygones convexes, plans).
function wingFaces(u0, v0, u1, v1, ze, zr, rv, cap, ends) {
  const F = [], W = v1 - v0, L = u1 - u0, c = Math.min(1, Math.max(0.05, cap));
  if (zr - ze < 0.02) { F.push({ p: [[u0, v0, ze], [u1, v0, ze], [u1, v1, ze], [u0, v1, ze]] }); return F; } // plat
  const hidA = !!(ends & HIDDEN_A), hidB = !!(ends & HIDDEN_B), gA = !!(ends & GABLE_A) || hidA, gB = !!(ends & GABLE_B) || hidB;
  if (rv <= 0.001 || rv >= 0.999) { // un seul versant
    const up = rv >= 0.999, vLo = up ? v0 : v1, vHi = up ? v1 : v0, vC = vLo + (vHi - vLo) * c;
    F.push({ p: [[u0, vLo, ze], [u1, vLo, ze], [u1, vC, zr], [u0, vC, zr]] });
    if (c < 0.999) F.push({ p: [[u0, vC, zr], [u1, vC, zr], [u1, vHi, zr], [u0, vHi, zr]] });
    if (!hidA) F.push({ wall: true, p: [[u0, vLo, ze], [u0, vC, zr], [u0, vHi, zr], [u0, vHi, ze]] });
    if (!hidB) F.push({ wall: true, p: [[u1, vLo, ze], [u1, vC, zr], [u1, vHi, zr], [u1, vHi, ze]] });
  } else {
    const vr = v0 + rv * W, runL = vr - v0, runR = v1 - vr, runE = Math.min(runL, runR);
    const vL = v0 + c * runL, vR = v1 - c * runR; // bords du plat du sommet (confondus avec le faîte quand cap = 1)
    let dA = gA ? 0 : c * runE, dB = gB ? 0 : c * runE; // retrait des croupes le long du faîte
    if (dA + dB > L) { const f = L / (dA + dB); dA *= f; dB *= f; }
    F.push({ p: [[u0, v0, ze], [u1, v0, ze], [u1 - dB, vL, zr], [u0 + dA, vL, zr]] });
    F.push({ p: [[u1, v1, ze], [u0, v1, ze], [u0 + dA, vR, zr], [u1 - dB, vR, zr]] });
    if (c < 0.999 && u1 - dB - (u0 + dA) > 1e-3) F.push({ p: [[u0 + dA, vL, zr], [u1 - dB, vL, zr], [u1 - dB, vR, zr], [u0 + dA, vR, zr]] });
    if (!hidA) F.push(gA ? { wall: true, p: [[u0, v0, ze], [u0, vL, zr], [u0, vR, zr], [u0, v1, ze]] } : { p: [[u0, v0, ze], [u0 + dA, vL, zr], [u0 + dA, vR, zr], [u0, v1, ze]] });
    if (!hidB) F.push(gB ? { wall: true, p: [[u1, v0, ze], [u1, vL, zr], [u1, vR, zr], [u1, v1, ze]] } : { p: [[u1, v0, ze], [u1 - dB, vL, zr], [u1 - dB, vR, zr], [u1, v1, ze]] });
  }
  return F.map(f => ({ ...f, p: dedupe(f.p) })).filter(f => f.p.length >= 3);
}

// Partie d'une face à gauche de la droite a -> b (z interpolé le long des arêtes coupées), ou null.
function clipFace(f, a, b) {
  const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const out = [], P = f.p;
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length], sp = side(p), sq = side(q), ip = sp >= -1e-6, iq = sq >= -1e-6;
    if (ip) out.push(p);
    if (ip !== iq && Math.abs(sp - sq) > 1e-9) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]); }
  }
  const d = dedupe(out); return d.length >= 3 ? { ...f, p: d } : null;
}

// Sommets dans le sens direct vus de l'extérieur: normale vers le haut pour un versant, vers l'extérieur de l'aile pour
// un mur (normale de Newell).
function orient(P, wall, cu, cv) {
  let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0;
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); cx += a[0] / P.length; cy += a[1] / P.length; }
  const ok = wall ? nx * (cx - cu) + ny * (cy - cv) >= 0 : nz >= 0;
  return ok ? P : P.slice().reverse();
}

// Faces du toit d'une empreinte (mètres locaux x, n et hauteur z au-dessus du sol moyen): [{ p: [[x, n, z], ...], wall, strip }]
// (wall: pignon ou bandeau vertical, à la couleur des murs; strip: bandeau d'égout, un mur avec ses fenêtres),
// sommets dans le sens direct vus de l'extérieur (x est, n nord, z haut: repère direct; le moteur passe en (x, z, -n),
// une rotation, qui garde ce sens).
export function roofFaces(ring, roof) {
  const out = [];
  if (!roof || !roof.w || !roof.w.length || ring.length < 3) return out;
  const R0 = signedArea(ring) < 0 ? ring.slice().reverse() : ring;
  for (const w of roof.w) {
    const [th, u0, v0, u1, v1, ze, zr, rv, cap, ends] = w;
    const cs = Math.cos(th), sn = Math.sin(th), toF = ([x, n]) => [x * cs + n * sn, -x * sn + n * cs], fromF = ([u, v, z]) => [u * cs - v * sn, u * sn + v * cs, z];
    let F = wingFaces(u0, v0, u1, v1, ze, zr, rv, cap, ends);
    if (ze > roof.he + 0.3) {
      const h0 = roof.he;
      F.push({ wall: true, strip: true, p: [[u0, v0, h0], [u1, v0, h0], [u1, v0, ze], [u0, v0, ze]] }, { wall: true, strip: true, p: [[u1, v0, h0], [u1, v1, h0], [u1, v1, ze], [u1, v0, ze]] },
        { wall: true, strip: true, p: [[u1, v1, h0], [u0, v1, h0], [u0, v1, ze], [u1, v1, ze]] }, { wall: true, strip: true, p: [[u0, v1, h0], [u0, v0, h0], [u0, v0, ze], [u0, v1, ze]] });
    }
    // Pans coupés: côté en biais de l'empreinte dont les deux bouts sont sur le bord de l'aile.
    const R = R0.map(toF), onEdge = (p) => p[0] >= u0 - 0.35 && p[0] <= u1 + 0.35 && p[1] >= v0 - 0.35 && p[1] <= v1 + 0.35 && Math.min(Math.abs(p[0] - u0), Math.abs(p[0] - u1), Math.abs(p[1] - v0), Math.abs(p[1] - v1)) <= 0.35;
    for (let i = 0; i < R.length; i++) {
      const a = R[i], b = R[(i + 1) % R.length], dx = b[0] - a[0], dy = b[1] - a[1]; if (Math.hypot(dx, dy) < 0.5) continue;
      const ang = Math.abs(Math.atan2(dy, dx)) % (Math.PI / 2); if (ang < 0.17 || ang > Math.PI / 2 - 0.17) continue; // le long des axes (10°)
      if (!onEdge(a) || !onEdge(b)) continue;
      F = F.map(f => clipFace(f, a, b)).filter(Boolean);
    }
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    for (const f of F) out.push({ wall: !!f.wall, strip: !!f.strip, p: orient(f.p, f.wall, cu, cv).map(fromF) });
  }
  return out;
}

// Hauteur du point le plus haut du toit (faîte le plus haut), pour viser ou dégager les arbres.
export const roofTop = (roof) => (roof && roof.w && roof.w.length ? Math.max(...roof.w.map(w => w[6])) : null);
