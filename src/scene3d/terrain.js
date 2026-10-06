// Relief autour d'un lieu pour la vue 3D: grille non uniforme de hauteurs (2 m au centre, pas croissant jusqu'à
// 500 m à 20 km) calculée par la fonction serveur /api/terrain (LiDAR de Ressources naturelles Canada, sinon modèle
// numérique d'élévation du Canada), gardée dans le cache partagé Supabase scene3d_cache (clé « dem_ ») et en mémoire
// le temps de la session. Fournit aussi la géométrie du sol: hauteur en tout point de la surface du maillage et
// drapage des surfaces planes (rues, parcs, eau) sur ce maillage, pour qu'elles épousent la pente sans flotter ni
// s'enfoncer.
import { supabase } from '../lib/supabase.js';
import { sceneKey } from './data.js';

const mem = new Map();
const TBL = 'scene3d_cache'; // même table que les environs, clés préfixées
export const TERRAIN_V = 1;
const API_BASE = (typeof __MS_TARGET__ !== 'undefined' && __MS_TARGET__ === 'native') ? 'https://www.meteoshoot.com' : '';
export const TEX_PERIOD = 9.0909; // période de la texture du sol en mètres (6600 répétitions sur 60 km, comme avant)

export function loadTerrain(lat, lng) {
  const key = 'dem_' + sceneKey(lat, lng);
  if (mem.has(key)) return mem.get(key);
  const la = Number(Number(lat).toFixed(5)), ln = Number(Number(lng).toFixed(5));
  const p = (async () => {
    let stale = false;
    try {
      const { data } = await supabase.from(TBL).select('data').eq('key', key).maybeSingle();
      if (data?.data?.h) { if ((data.data.v || 1) >= TERRAIN_V) return data.data; stale = true; }
    } catch (e) { /* cache indisponible: on calcule */ }
    const url = `${API_BASE}/api/terrain?lat=${la}&lng=${ln}&v=${TERRAIN_V}`;
    let res = await fetch(url);
    if (!res.ok) throw new Error('terrain ' + res.status);
    let t = await res.json();
    if (t?.h && (t.v || 1) < TERRAIN_V) { res = await fetch(url, { cache: 'reload' }); if (res.ok) t = await res.json(); }
    if (!t?.h || !t.ax) throw new Error('terrain: réponse invalide');
    delete t.ms;
    try {
      if (stale) await supabase.from(TBL).update({ version: TERRAIN_V, data: t }).eq('key', key);
      else await supabase.from(TBL).insert({ key, lat: la, lng: ln, version: TERRAIN_V, data: t });
    } catch (e) { /* non connecté ou déjà en cache */ }
    return t;
  })();
  mem.set(key, p);
  p.catch(() => mem.delete(key));
  return p;
}

// Relief calculé -> objet de terrain (hauteurs en mètres au-dessus de la mer).
export function makeTerrain(t) {
  const ax = t.ax, N = ax.length, bin = atob(t.h), q = new Int16Array(N * N), u8 = new Uint8Array(q.buffer);
  for (let i = 0; i < u8.length && i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const H = new Float32Array(N * N); for (let k = 0; k < N * N; k++) H[k] = t.hMin + q[k] / 10;
  return terrainFrom(ax, H, t.src || {}, false);
}
// Sol plat (en attendant le relief, ou sans relief): 3 km maillés à 50 m, puis deux cellules jusqu'à 30 km.
export function flatTerrain() {
  const ax = [-30000]; for (let v = -1500; v <= 1500; v += 50) ax.push(v); ax.push(30000);
  return terrainFrom(ax, new Float32Array(ax.length * ax.length), {}, true);
}

function pointInRing(p, r) { let inside = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; }

function terrainFrom(ax, H0, src, flat) {
  const N = ax.length, H = new Float32Array(H0); // H0: relief d'origine; H: relief creusé sous l'eau (carveWater)
  const idx = (v) => { if (v <= ax[0]) return 0; if (v >= ax[N - 1]) return N - 2; let lo = 0, hi = N - 2; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ax[m] <= v) lo = m; else hi = m - 1; } return lo; };
  // Hauteur sur la surface du maillage: plan du triangle de la cellule (diagonale du coin bas-gauche au coin haut-droit,
  // la même que celle du maillage dessiné), donc continue d'une cellule à l'autre et exacte sous les surfaces drapées.
  function hTriOf(A, x, n) {
    const i = idx(x), j = idx(n), u = (x - ax[i]) / (ax[i + 1] - ax[i]), v = (n - ax[j]) / (ax[j + 1] - ax[j]);
    const k = j * N + i, h00 = A[k], h10 = A[k + 1], h01 = A[k + N], h11 = A[k + N + 1];
    return v <= u ? h00 + (h10 - h00) * u + (h11 - h10) * v : h00 + (h11 - h01) * u + (h01 - h00) * v;
  }
  const hTri = (x, n) => hTriOf(H, x, n);
  // Normales lissées aux noeuds (différences centrées sur la grille non uniforme), interpolées en tout point: les surfaces
  // drapées (rues, parcs) sont ombrées comme le sol sous elles, sans facettes. Recalculées après creusage (carveWater).
  let NRM = null;
  function nodeNormals() {
    NRM = new Float32Array(N * N * 3);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, i0 = Math.max(0, i - 1), i1 = Math.min(N - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(N - 1, j + 1);
      const dx = (H[j * N + i1] - H[j * N + i0]) / (ax[i1] - ax[i0]), dn = (H[j1 * N + i] - H[j0 * N + i]) / (ax[j1] - ax[j0]);
      const l = Math.hypot(dx, 1, dn); NRM[3 * k] = -dx / l; NRM[3 * k + 1] = 1 / l; NRM[3 * k + 2] = dn / l; // y = H(x, n), z = -n
    }
  }
  function normalAt(x, n) {
    if (!NRM) nodeNormals();
    const i = idx(x), j = idx(n), u = Math.max(0, Math.min(1, (x - ax[i]) / (ax[i + 1] - ax[i]))), v = Math.max(0, Math.min(1, (n - ax[j]) / (ax[j + 1] - ax[j])));
    const k = j * N + i, out = [0, 0, 0];
    for (let c = 0; c < 3; c++) out[c] = (NRM[3 * k + c] * (1 - u) + NRM[3 * (k + 1) + c] * u) * (1 - v) + (NRM[3 * (k + N) + c] * (1 - u) + NRM[3 * (k + N + 1) + c] * u) * v;
    const l = Math.hypot(out[0], out[1], out[2]) || 1; return [out[0] / l, out[1] / l, out[2] / l];
  }
  const UP = [0, 1, 0], upNormal = () => UP;
  // Eau: le modèle de terrain est bruité ou en marches sur les rivières (le LiDAR ne voit pas l'eau). Chaque plan d'eau
  // reçoit une surface lisse interpolée depuis la hauteur du relief le long de ses rives (moyenne pondérée par l'inverse
  // du carré de la distance, rives proches seulement), 30 cm sous elles, et le terrain est creusé 60 cm sous cette surface
  // à l'intérieur du contour pour ne jamais percer l'eau. Idempotent: repart toujours du relief d'origine.
  const surfaces = new Map(); // plan d'eau -> fonction de hauteur
  function waterSurface(w) { return surfaces.get(w) || hTri; }
  function carveWater(waters) {
    H.set(H0); surfaces.clear(); NRM = null;
    for (const w of waters || []) {
      const o = w.o || w, holes = w.h || []; if (!o || o.length < 3) continue;
      const pts = []; [o, ...holes].forEach(r => r.forEach(p => pts.push([p[0], p[1], hTriOf(H0, p[0], p[1])])));
      const surf = (x, n) => {
        let dmin = Infinity; for (const p of pts) { const d = Math.hypot(p[0] - x, p[1] - n); if (d < dmin) dmin = d; }
        const R = Math.max(3 * dmin, 40); let s = 0, ws = 0;
        for (const p of pts) { const d = Math.hypot(p[0] - x, p[1] - n); if (d > R) continue; const wt = 1 / (d * d + 1); s += p[2] * wt; ws += wt; }
        return (ws ? s / ws : hTriOf(H0, x, n)) - 0.3;
      };
      surfaces.set(w, surf);
      let minx = Infinity, maxx = -Infinity, minn = Infinity, maxn = -Infinity; o.forEach(p => { if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0]; if (p[1] < minn) minn = p[1]; if (p[1] > maxn) maxn = p[1]; });
      const i0 = idx(minx), i1 = Math.min(N - 1, idx(maxx) + 1), j0 = idx(minn), j1 = Math.min(N - 1, idx(maxn) + 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const p = [ax[i], ax[j]]; if (!pointInRing(p, o) || holes.some(h => pointInRing(p, h))) continue;
        const k = j * N + i, y = surf(p[0], p[1]) - 0.6; if (H[k] > y) H[k] = y;
      }
    }
  }
  // Statistiques dans un rayon (mètres) autour de l'origine: plus haut point, utile pour placer les nuages.
  function maxWithin(r) { let m = -Infinity; for (let j = 0; j < N; j++) { if (Math.abs(ax[j]) > r) continue; for (let i = 0; i < N; i++) { if (Math.abs(ax[i]) > r) continue; const h = H[j * N + i]; if (h > m) m = h; } } return m === -Infinity ? 0 : m; }
  let hMin = Infinity, hMax = -Infinity; for (let k = 0; k < N * N; k++) { if (H[k] < hMin) hMin = H[k]; if (H[k] > hMax) hMax = H[k]; }
  // Le relief gêne-t-il la vue entre deux points (ligne droite, en mètres, hauteurs absolues)?
  function blocked(x0, n0, y0, x1, n1, y1) {
    for (let s = 1; s < 24; s++) { const t = s / 24; if (hTri(x0 + (x1 - x0) * t, n0 + (n1 - n0) * t) > y0 + (y1 - y0) * t + 0.3) return true; }
    return false;
  }
  // Drapage: triangles 2D [[x, n], ...] -> positions (x, y, z) de triangles posés sur la surface, découpés aux cellules
  // et à leur diagonale pour que chaque morceau soit dans le plan du maillage. Orientation antihoraire vue du ciel.
  // hFn: hauteur à utiliser (le relief par défaut; la surface lisse d'un plan d'eau); nFn: normale (celle du relief, ou
  // verticale pour l'eau). Renvoie { pos, nrm }.
  function drape(tris, hFn, nFn) {
    const out = [], nrm = [], hOf = hFn || hTri, nOf = nFn || normalAt;
    const put = (p) => { out.push(p[0], hOf(p[0], p[1]), -p[1]); const q = nOf(p[0], p[1]); nrm.push(q[0], q[1], q[2]); };
    const fan = (poly) => { if (poly.length < 3) return; for (let k = 1; k + 1 < poly.length; k++) { const a = poly[0], b = poly[k], c = poly[k + 1]; if (Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) < 1e-6) continue; put(a); put(b); put(c); } };
    const clipHalf = (poly, f) => { // garde f(p) >= 0
      const res = []; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length], fp = f(p), fq = f(q); if (fp >= 0) res.push(p); if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); res.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); } } return res;
    };
    for (const tri of tris) {
      let [a, b, c] = tri; const ar = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(ar) < 1e-6) continue; if (ar < 0) { const t = b; b = c; c = t; }
      const i0 = idx(Math.min(a[0], b[0], c[0])), i1 = idx(Math.max(a[0], b[0], c[0])), j0 = idx(Math.min(a[1], b[1], c[1])), j1 = idx(Math.max(a[1], b[1], c[1]));
      const e0 = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]), e1 = (p) => (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]), e2 = (p) => (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
      const inside = (p) => e0(p) >= 0 && e1(p) >= 0 && e2(p) >= 0;
      for (let j = j0; j <= j1; j++) {
        const n0 = ax[j], n1 = ax[j + 1];
        for (let i = i0; i <= i1; i++) {
          const x0 = ax[i], x1 = ax[i + 1], c00 = [x0, n0], c10 = [x1, n0], c11 = [x1, n1], c01 = [x0, n1];
          if (inside(c00) && inside(c10) && inside(c11) && inside(c01)) { put(c00); put(c10); put(c11); put(c00); put(c11); put(c01); continue; } // cellule entière
          let poly = clipHalf([a, b, c], (p) => p[0] - x0); poly = clipHalf(poly, (p) => x1 - p[0]); poly = clipHalf(poly, (p) => p[1] - n0); poly = clipHalf(poly, (p) => n1 - p[1]);
          if (poly.length < 3) continue;
          const diag = (p) => (p[0] - x0) * (n1 - n0) - (p[1] - n0) * (x1 - x0); // >= 0: sous la diagonale (v <= u)
          fan(clipHalf(poly, diag)); fan(clipHalf(poly, (p) => -diag(p)));
        }
      }
    }
    return { pos: new Float32Array(out), nrm: new Float32Array(nrm) };
  }
  return { ax, H, N, flat, src, hMin, hMax, hTri, normalAt, upNormal, maxWithin, blocked, drape, carveWater, waterSurface };
}
