// Points d'entrée le long des rues d'après le relief LiDAR (24 octobre 2026, Stéphane: « augmenter la précision des
// entrées, stationnements, chemins de gravier »).
// Hors des villes, un fossé longe la rue de chaque côté; une entrée le traverse sur un ponceau, où le terrain remonte
// au niveau de l'accotement. Le terrain (DTM à 1 m) est déroulé le long de chaque rue: pour chaque mètre et chaque
// côté, le creux du fossé D(s) = minimum de la hauteur relative au centre de la rue entre le bord et 6 m au-delà.
// La médiane glissante M(s) (±30 m) dit s'il y a un fossé (M ≤ DITCH, en mètres); une entrée est une suite de 2,5 à
// 20 m où D remonte à plus de la moitié de la profondeur (D ≥ M / 2). Chaque entrée donne un point sur le bord de la
// rue, la normale vers l'extérieur et la longueur de l'interruption (l'apron au bord est plus large que l'entrée).
// Les tronçons avec fossé sont rendus aussi: là, les entrées tirées de la couleur de l'image sont superflues.
const DITCH = -0.2, GAP_MIN = 2.5, GAP_MAX = 20, BEYOND = 6, HALF_WIN = 30, MERGE_M = 10;

function median(a) { const s = a.filter(v => v === v).sort((p, q) => p - q); return s.length ? s[s.length >> 1] : NaN; }

// win: fenêtre LiDAR de readCanopy (dtm, W, H, fr); roads: [{w, k, p}] en mètres locaux.
// -> { entries: [{x, n, nx, nn, gap, w}], ditched: [{a: [x, n], b: [x, n], side, w}] }
export function ditchEntries(win, roads) {
  const { dtm, W, H, fr } = win, entries = [], ditched = [];
  if (!dtm || !fr) return { entries, ditched };
  const z = (x, n) => { const [u, v] = fr.toPx(x, n); const i = Math.floor(u), j = Math.floor(v); if (i < 0 || j < 0 || i + 1 >= W || j + 1 >= H) return NaN; const fx = u - i, fy = v - j, g = (a, b) => dtm[(j + b) * W + i + a]; return (g(0, 0) * (1 - fx) + g(1, 0) * fx) * (1 - fy) + (g(0, 1) * (1 - fx) + g(1, 1) * fx) * fy; };
  for (const r of roads) {
    if (r.k !== 0 || r.w < 4) continue; // asphalte seulement, pas les entrées déjà connues (3 m)
    const pts = r.p, S = []; // échantillons: centre, normale (vers la gauche)
    for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.5) continue; const ex = (b[0] - a[0]) / L, en = (b[1] - a[1]) / L; for (let s = 0; s < L; s += 1) S.push([a[0] + ex * s, a[1] + en * s, -en, ex]); }
    if (S.length < 2 * HALF_WIN) continue;
    for (const side of [1, -1]) {
      const D = new Float64Array(S.length);
      for (let k = 0; k < S.length; k++) { const [cx, cn, nx, nn] = S[k], zc = z(cx, cn); let m = Infinity; for (let d = r.w / 2 - 0.5; d <= r.w / 2 + BEYOND; d += 0.5) { const v = z(cx + side * nx * d, cn + side * nn * d) - zc; if (v === v && v < m) m = v; } D[k] = m === Infinity ? NaN : m; }
      const M = new Float64Array(S.length);
      for (let k = 0; k < S.length; k++) M[k] = median(Array.from(D.slice(Math.max(0, k - HALF_WIN), Math.min(S.length, k + HALF_WIN + 1))));
      // Tronçons avec fossé, puis interruptions
      let run = -1, gap = -1;
      const flush = (k) => { if (run >= 0 && k - run >= 10) { const a = S[run], b = S[k - 1]; ditched.push({ a: [a[0], a[1]], b: [b[0], b[1]], side, w: r.w }); } run = -1; };
      const flushGap = (k) => { if (gap >= 0) { const len = k - gap; if (len >= GAP_MIN && len <= GAP_MAX) { const c = S[Math.floor((gap + k) / 2)]; entries.push({ x: c[0] + side * c[2] * (r.w / 2), n: c[1] + side * c[3] * (r.w / 2), nx: side * c[2], nn: side * c[3], gap: len, w: r.w }); } } gap = -1; };
      for (let k = 0; k <= S.length; k++) {
        const has = k < S.length && M[k] === M[k] && M[k] <= DITCH;
        if (!has) { flushGap(k); flush(k); continue; }
        if (run < 0) run = k;
        const isGap = D[k] === D[k] && D[k] >= M[k] / 2;
        if (isGap) { if (gap < 0) gap = k; } else flushGap(k);
      }
    }
  }
  // Deux interruptions à moins de MERGE_M l'une de l'autre (apron large, ponceau double): une seule entrée, au milieu.
  entries.sort((a, b) => a.x - b.x);
  const merged = [];
  for (const e of entries) {
    const near = merged.find(m => Math.hypot(m.x - e.x, m.n - e.n) < MERGE_M && m.nx * e.nx + m.nn * e.nn > 0.7);
    if (near) { const w = near.gap + e.gap; near.x = (near.x * near.gap + e.x * e.gap) / w; near.n = (near.n * near.gap + e.n * e.gap) / w; near.gap = Math.min(GAP_MAX, w); }
    else merged.push({ ...e });
  }
  return { entries: merged, ditched };
}
