// Pentes des toits d'après le LiDAR de Ressources naturelles Canada (9 octobre 2026).
//
// Jusqu'ici, chaque bâtiment voisin était un prisme à toit plat, à la hauteur du palier dominant du relevé: une maison à
// deux versants devenait une boîte arrêtée à mi-pente. La surface LiDAR (dsm, altitude du toit) lue dans chaque
// empreinte montre pourtant la forme du toit au mètre près. On l'ajuste ici à un modèle simple, aile par aile:
// - une aile est un rectangle maximal de l'empreinte (une maison en L en a deux, qui se croisent), dans le repère de son
//   rectangle englobant minimal;
// - pour chaque aile, le toit est un faîte parallèle à l'un des côtés (le plus long d'abord; le court aussi quand l'aile
//   est presque carrée), deux versants (faîte centré ou décentré; au bout, un seul versant: appentis), des bouts en pignon
//   (mur) ou en croupe (versant), et au besoin un sommet aplati (toit brisé, toit plat à quatre versants). Chaque
//   variante est une régression linéaire (égout, montée) sur une forme normalisée; les pixels à plus de 1 m du modèle
//   (cheminées, lucarnes, branches) sont écartés et le modèle refait. Le toit plat (médiane) ne cède à un toit en pente
//   que si celui-ci explique nettement plus de pixels (à 0,5 m près: 10 points de plus, erreur réduite d'un quart).
// - les ailes sont retenues par couverture décroissante (au plus quatre); une aile secondaire qui croise une aile plus
//   haute s'arrête au faîte de celle-ci (au-delà, elle serait cachée ou en sortirait comme un aileron);
// - les hauteurs sont rapportées au sol moyen de l'empreinte (sol nu aux sommets et au centre), le repère des murs dans le
//   moteur (engine.js, groundOf).
// Le résultat (7e champ du bâtiment, format et géométrie dans src/scene3d/roof.js) laisse la hauteur h intacte: le moteur
// monte les murs à l'égout et pose les versants dessus. Sans toit en pente reconnu (toit plat, empreinte décalée, toit
// sous les arbres, grand bâtiment), rien ne change. Empreintes de plus de 12 sommets ou de plus de 40 rectangles: toit
// plat (immeubles complexes).
import { minAreaRect } from '../src/scene3d/ring.js';
import { GABLE_A, GABLE_B, HIDDEN_A, HIDDEN_B } from '../src/scene3d/roof.js';

const INSET = 0.7; // m: les pixels à moins de 0,7 m du bord mêlent toit et sol (ou mur)
const MIN_PX = 12; // pixels pour ajuster une aile
const MIN_WING = 2.5; // m: largeur et longueur minimales d'une aile
const MIN_RISE = 1.0; // m: montée minimale d'un toit en pente (moins: plat)
const MIN_EAVE = 2.0; // m: égout au moins à cette hauteur au-dessus du sol moyen
const SLOPE_MIN = 0.08, SLOPE_MAX = 2.7; // pentes admises (4,5° à 70°: toit à un versant presque plat, toit brisé)
const TOL = 0.5, OUT = 1.0; // m: pixel expliqué; pixel aberrant
const GAIN_INL = 0.1, GAIN_RMSE = 0.9, GAIN_RMSE_ALONE = 0.6; // ce qu'un toit en pente doit gagner sur le toit plat
// Pénalités de complexité (en part de pixels expliqués): le modèle simple l'emporte à moins d'un gain net.
const PEN = { cap: 0.06, asym: 0.03, mixed: 0.02, hip: 0.01, shed: 0.02, shortAxis: 0.04 };
const RV = [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1];
const MAX_V = 12, MAX_RECTS = 40, MAX_WINGS = 4, MAX_BOX = 40000;

const signedArea = (r) => r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
const ccw = (r) => (signedArea(r) < 0 ? r.slice().reverse() : r);
const centroid = (r) => r.reduce((c, p) => [c[0] + p[0] / r.length, c[1] + p[1] / r.length], [0, 0]);
function inRing(x, y, r) { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) ins = !ins; } return ins; }
const segDist = (x, n, a, b) => { const dx = b[0] - a[0], dn = b[1] - a[1], l2 = dx * dx + dn * dn || 1e-9, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (n - a[1]) * dn) / l2)); return Math.hypot(x - a[0] - t * dx, n - a[1] - t * dn); };
const ringDist = (x, n, r) => { let d = Infinity; for (let i = 0, j = r.length - 1; i < r.length; j = i++) d = Math.min(d, segDist(x, n, r[j], r[i])); return d; };
const q1 = (v) => Math.round(v * 10) / 10, q3 = (v) => Math.round(v * 1000) / 1000;

// Régression z = a + b g, en écartant les pixels à plus de OUT du modèle (jusqu'à quatre passes); a0: départ (toit plat).
// Retourne { a, b, inl (part des pixels à TOL près), rmse (des pixels gardés) } ou null (moins de la moitié des pixels gardés).
function fitLine(g, z, a0 = null) {
  const n = g.length, keep = new Uint8Array(n).fill(1);
  let a = 0, b = 0;
  if (a0 != null) { a = a0; for (let i = 0; i < n; i++) keep[i] = Math.abs(z[i] - a) <= OUT ? 1 : 0; }
  for (let pass = 0; pass < 4; pass++) {
    let m = 0, sg = 0, sz = 0, sgg = 0, sgz = 0;
    for (let i = 0; i < n; i++) if (keep[i]) { m++; sg += g[i]; sz += z[i]; sgg += g[i] * g[i]; sgz += g[i] * z[i]; }
    if (m < 4) return null;
    const det = m * sgg - sg * sg;
    b = Math.abs(det) > 1e-9 ? (m * sgz - sg * sz) / det : 0; a = (sz - b * sg) / m;
    let changed = false;
    for (let i = 0; i < n; i++) { const k = Math.abs(z[i] - a - b * g[i]) <= OUT ? 1 : 0; if (k !== keep[i]) { keep[i] = k; changed = true; } }
    if (!changed) break;
  }
  let inl = 0, se = 0, nk = 0;
  for (let i = 0; i < n; i++) { const e = z[i] - a - b * g[i]; if (Math.abs(e) <= TOL) inl++; if (keep[i]) { se += e * e; nk++; } }
  if (nk < Math.max(4, 0.5 * n)) return null;
  return { a, b, inl: inl / n, rmse: Math.sqrt(se / nk) };
}

// Rectangles maximaux (indices de cellules inclusifs) d'une grille de cellules intérieures.
function maximalRects(inside, nu, nv) {
  const full = (i0, i1, j0, j1) => { for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (!inside[i][j]) return false; return true; };
  const out = [];
  for (let i0 = 0; i0 < nu; i0++) for (let i1 = i0; i1 < nu; i1++) for (let j0 = 0; j0 < nv; j0++) for (let j1 = j0; j1 < nv; j1++) {
    if (!full(i0, i1, j0, j1)) continue;
    if ((i0 > 0 && full(i0 - 1, i1, j0, j1)) || (i1 < nu - 1 && full(i0, i1 + 1, j0, j1)) || (j0 > 0 && full(i0, i1, j0 - 1, j1)) || (j1 < nv - 1 && full(i0, i1, j0, j1 + 1))) continue;
    out.push([i0, i1, j0, j1]);
  }
  return out;
}

// Ajustement d'une aile: P = [[u, v, z]] (pixels dans le rectangle), base = sol moyen. Retourne { pitched, flat } ou null.
// pitched: { axis (0: faîte le long de u, 1: le long de v), rv, ends, cap, he, hr, inl, rmse, score }; flat: { he, inl, rmse }.
function fitWing(P, [u0, v0, u1, v1], base) {
  const z = P.map(p => p[2]), zs = z.slice().sort((a, b) => a - b), med = zs[zs.length >> 1];
  const f0 = fitLine(z.map(() => 0), z, med);
  const flat = f0 && f0.a - base >= MIN_EAVE ? { he: f0.a - base, inl: f0.inl, rmse: f0.rmse } : null;
  let best = null;
  const L = u1 - u0, Wd = v1 - v0;
  for (const axis of [0, 1]) {
    const len = axis ? Wd : L, wid = axis ? L : Wd;
    if (len < MIN_WING || wid < MIN_WING) continue;
    const al = P.map(p => (axis ? p[1] - v0 : p[0] - u0)), ac = P.map(p => (axis ? p[0] - u0 : p[1] - v0));
    for (const rv of RV) {
      const shed = rv === 0 || rv === 1, cr = rv * wid, runE = shed ? wid : Math.min(cr, wid - cr);
      for (const ends of shed ? [GABLE_A | GABLE_B] : [GABLE_A | GABLE_B, 0, GABLE_A, GABLE_B]) for (const cap of [1, 0.7]) {
        const g = new Array(P.length);
        for (let i = 0; i < P.length; i++) {
          const c = ac[i], a = al[i];
          let gv = shed ? (rv === 0 ? 1 - c / wid : c / wid) : (c <= cr ? c / cr : (wid - c) / (wid - cr));
          if (!(ends & GABLE_A)) gv = Math.min(gv, a / runE);
          if (!(ends & GABLE_B)) gv = Math.min(gv, (len - a) / runE);
          g[i] = Math.min(Math.max(gv, 0), cap) / cap;
        }
        const f = fitLine(g, z); if (!f || f.b < MIN_RISE || f.a - base < MIN_EAVE) continue;
        const sv = f.b / cap, slopes = shed ? [sv / wid] : [sv / cr, sv / (wid - cr)];
        if (Math.max(...slopes) > SLOPE_MAX || Math.min(...slopes) < SLOPE_MIN) continue;
        const pen = (cap < 1 ? PEN.cap : 0) + (shed ? PEN.shed : rv !== 0.5 ? PEN.asym : 0) + (shed ? 0 : ends === 0 ? PEN.hip : ends === (GABLE_A | GABLE_B) ? 0 : PEN.mixed) + (!shed && len < wid ? PEN.shortAxis : 0);
        const score = f.inl - 0.1 * f.rmse - pen;
        if (!best || score > best.score) best = { score, axis, rv, ends, cap, he: f.a - base, hr: f.a + f.b - base, inl: f.inl, rmse: f.rmse };
      }
    }
  }
  const pitched = best && (!flat ? best.inl >= 0.4 : (best.inl >= flat.inl + GAIN_INL && best.rmse <= GAIN_RMSE * flat.rmse) || best.rmse <= GAIN_RMSE_ALONE * flat.rmse) ? best : null;
  if (pitched) return { pitched, flat, best };
  if (flat && flat.inl >= 0.5) return { pitched: null, flat, best };
  return { pitched: null, flat: null, best, none: true };
}

// win: fenêtre LiDAR (readCanopy, api/trees.js: dsm, dtm, seen, W, H, fr); bld: bâtiments (anneaux en mètres locaux),
// modifiés en place: b[6] = { he, w } (voir src/scene3d/roof.js). Retourne les comptes par genre.
export function lidarRoofs(win, bld, log = () => {}, dbg = null) {
  const { dsm, dtm, seen, W, H, fr } = win;
  const pxAt = (x, n) => { const [i, j] = fr.toPx(x, n), ii = Math.floor(i), jj = Math.floor(j); return ii >= 0 && jj >= 0 && ii < W && jj < H ? jj * W + ii : -1; };
  const st = { n: 0, gable: 0, hip: 0, shed: 0, mixed: 0, cap: 0, flat: 0, skipped: 0, wings: 0 };
  for (const b of bld) {
    const r = ccw(b[0]); if (r.length > MAX_V) { st.skipped++; continue; }
    const c = centroid(r); let gs = 0, gn = 0;
    for (const p of [...r, c]) { const k = pxAt(p[0], p[1]); if (k >= 0 && seen[k]) { gs += dtm[k]; gn++; } }
    if (!gn) continue;
    const base = gs / gn;
    let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
    for (const p of r) { const [i, j] = fr.toPx(p[0], p[1]); i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); }
    i0 = Math.max(0, Math.floor(i0)); j0 = Math.max(0, Math.floor(j0)); i1 = Math.min(W - 1, Math.ceil(i1)); j1 = Math.min(H - 1, Math.ceil(j1));
    if (i1 < i0 || j1 < j0 || (i1 - i0 + 1) * (j1 - j0 + 1) > MAX_BOX) { st.skipped++; continue; }
    const pts = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * W + i; if (!seen[k]) continue; const [x, n] = fr.toLocal(i + 0.5, j + 0.5); if (!inRing(x, n, r) || ringDist(x, n, r) < INSET) continue; pts.push([x, n, dsm[k]]); }
    if (pts.length < MIN_PX) continue;
    const mr = minAreaRect(r); if (!mr.ring) continue;
    const th = mr.th, cs = Math.cos(th), sn = Math.sin(th), toF = ([x, n]) => [x * cs + n * sn, -x * sn + n * cs];
    const R = r.map(toF), Q = pts.map(p => { const [u, v] = toF(p); return [u, v, p[2]]; });
    const axis = (k) => { const s = R.map(p => p[k]).sort((p, q) => p - q), o = []; for (const v of s) if (!o.length || v - o[o.length - 1] > 0.3) o.push(v); return o; };
    const us = axis(0), vs = axis(1), nu = us.length - 1, nv = vs.length - 1; if (nu < 1 || nv < 1) continue;
    const inside = []; for (let i = 0; i < nu; i++) { inside.push([]); for (let j = 0; j < nv; j++) inside[i].push(inRing((us[i] + us[i + 1]) / 2, (vs[j] + vs[j + 1]) / 2, R)); }
    const rects = maximalRects(inside, nu, nv).map(([a, b2, c2, d]) => [us[a], vs[c2], us[b2 + 1], vs[d + 1]]).filter(([u0, v0, u1, v1]) => u1 - u0 >= MIN_WING && v1 - v0 >= MIN_WING);
    if (!rects.length || rects.length > MAX_RECTS) { st.skipped++; continue; }
    const cands = [];
    for (const rc of rects) {
      const idx = []; for (let i = 0; i < Q.length; i++) { const q = Q[i]; if (q[0] >= rc[0] && q[0] <= rc[2] && q[1] >= rc[1] && q[1] <= rc[3]) idx.push(i); }
      if (idx.length < MIN_PX) continue;
      const fit = fitWing(idx.map(i => Q[i]), rc, base);
      if (dbg) dbg(b, { base, th, rc, n: idx.length, ...fit });
      if (fit.none) continue;
      cands.push({ rc, idx, ...fit });
    }
    // Ailes retenues par couverture (pixels pas encore couverts, pondérés par la qualité de l'ajustement).
    const covered = new Uint8Array(Q.length), wings = [];
    while (wings.length < MAX_WINGS) {
      let best = null;
      for (const cd of cands) {
        if (cd.used) continue;
        let nw = 0; for (const i of cd.idx) if (!covered[i]) nw++;
        if (nw < Math.max(8, 0.25 * cd.idx.length)) continue;
        const sc = nw * (1 + (cd.pitched ? cd.pitched.inl : cd.flat.inl));
        if (!best || sc > best.sc) best = { cd, sc };
      }
      if (!best) break;
      best.cd.used = true; for (const i of best.cd.idx) covered[i] = 1; wings.push(best.cd);
    }
    if (!wings.some(w => w.pitched)) { st.flat++; continue; }
    // Dans le repère commun: aile { u0, v0, u1, v1, axis, rv, ends, cap, he, hr }; plat: axis -1.
    const ws = wings.map(w => { const [u0, v0, u1, v1] = w.rc; return w.pitched ? { u0, v0, u1, v1, ...w.pitched } : { u0, v0, u1, v1, axis: -1, rv: 0.5, ends: 0, cap: 1, he: w.flat.he, hr: w.flat.he }; });
    ws.sort((a, b) => b.hr - a.hr);
    // Une aile secondaire qui croise le faîte d'une aile plus haute, perpendiculaire, s'arrête à ce faîte (bout caché).
    for (let bi = 1; bi < ws.length; bi++) {
      const B = ws[bi]; if (B.axis < 0) continue;
      for (let ai = 0; ai < bi; ai++) {
        const A = ws[ai]; if (A.axis < 0 || A.axis === B.axis) continue;
        if (B.u1 <= A.u0 || B.u0 >= A.u1 || B.v1 <= A.v0 || B.v0 >= A.v1) continue;
        if (A.axis === 0) { // faîte de A le long de u, à v = vA; faîte de B le long de v
          const vA = A.v0 + A.rv * (A.v1 - A.v0); if (!(B.v0 < vA && vA < B.v1)) continue;
          if (B.v1 <= A.v1 + 0.3) { B.v1 = vA; B.ends |= HIDDEN_B; } else if (B.v0 >= A.v0 - 0.3) { B.v0 = vA; B.ends |= HIDDEN_A; }
        } else {
          const uA = A.u0 + A.rv * (A.u1 - A.u0); if (!(B.u0 < uA && uA < B.u1)) continue;
          if (B.u1 <= A.u1 + 0.3) { B.u1 = uA; B.ends |= HIDDEN_B; } else if (B.u0 >= A.u0 - 0.3) { B.u0 = uA; B.ends |= HIDDEN_A; }
        }
      }
    }
    const kept = ws.filter(w => w.u1 - w.u0 >= 1 && w.v1 - w.v0 >= 1);
    if (!kept.some(w => w.axis >= 0)) { st.flat++; continue; }
    const he = Math.min(...kept.map(w => w.he));
    // Format de sortie: faîte le long de u; une aile dont le faîte suit v passe dans le repère tourné d'un quart de tour
    // (u' = v, v' = -u: le faîte vu depuis v0' = -u1 est à 1 - rv).
    const w = kept.map(a => (a.axis === 1
      ? [q3(th + Math.PI / 2), q1(a.v0), q1(-a.u1), q1(a.v1), q1(-a.u0), q1(a.he), q1(a.hr), 1 - a.rv, a.cap, a.ends]
      : [q3(th), q1(a.u0), q1(a.v0), q1(a.u1), q1(a.v1), q1(a.he), q1(a.hr), a.rv, a.cap, a.ends]));
    while (b.length < 6) b.push(0);
    b[6] = { he: q1(he), w };
    st.n++; st.wings += w.length;
    const d = kept.find(a => a.axis >= 0), gab = d.ends & (GABLE_A | GABLE_B);
    if (d.rv === 0 || d.rv === 1) st.shed++; else if (gab === (GABLE_A | GABLE_B)) st.gable++; else if (!gab) st.hip++; else st.mixed++;
    if (d.cap < 1) st.cap++;
  }
  log(`toits LiDAR: ${st.n} en pente (${st.gable} à deux versants, ${st.hip} à croupes, ${st.shed} à un versant, ${st.mixed} mixtes, ${st.cap} à sommet plat; ${st.wings} ailes), ${st.flat} plats, ${st.skipped} non examinés`);
  return st;
}
