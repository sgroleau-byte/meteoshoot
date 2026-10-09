// Hauteur réelle des bâtiments voisins d'après le LiDAR de Ressources naturelles Canada (7 octobre 2026).
//
// Les mosaïques HRDEM existent en deux versions: le sol nu (dtm, déjà utilisé pour le relief, api/terrain.js) et la
// surface (dsm), qui inclut les toits. Leur différence, lue à l'intérieur de chaque empreinte Overture, donne la
// hauteur du bâtiment au mètre près, là où OpenStreetMap n'a qu'une estimation (nombre d'étages, ou 7,5 m par défaut).
// Vérifié sur le Courtyard by Marriott du boulevard Pierre-Bertrand à Québec: 31 m au toit (Overture: environ 11 m).
//
// Limites: date du relevé variable selon la région (un bâtiment construit depuis n'y est pas: on garde alors la
// hauteur d'Overture), couverture partielle hors des zones habitées.
import { openCog, readWindow } from './cog.js';
import { toLCC } from './terrain.js';

const STAC = 'https://datacube.services.geo.ca/stac/api/collections';
const UA = 'MeteoShoot (www.meteoshoot.com)';
const MIN_H = 2.5; // en dessous: le bâtiment n'existait pas au relevé (ou est démoli), on garde Overture
const MIN_PX = 6; // empreinte trop petite pour une mesure fiable
const ROUGH = 1.2; // m: écart maximal avec les voisins pour un point de toit (plat ou en pente); la cime des arbres est rugueuse
const PLATEAU = 0.12; // part minimale des points lisses pour qu'un palier compte (écarte cheminées et équipements)

// Hauteur d'un bâtiment à partir de ses points « surface moins sol »: [{ v, rough }].
// Les arbres au-dessus d'un toit (la surface voit leur cime) sont souvent rugueux: on ne garde que les points lisses,
// ceux des toits plats ou en pente. Parmi eux, le plus haut palier qui couvre au moins 12 % de l'empreinte donne la
// hauteur: la tour plutôt que son socle ou une aile basse, sans les petits équipements sur le toit. Une grande cime
// peut aussi former un palier lisse: maxH écarte les paliers impossibles pour une petite maison ou une remise.
// Sans palier net: la médiane des points lisses.
export function pickHeight(pts, maxH = Infinity) {
  const smooth = pts.filter((p) => p.rough <= ROUGH).map((p) => p.v).sort((a, b) => a - b);
  const all = pts.map((p) => p.v).sort((a, b) => a - b);
  const med = all[Math.floor(all.length / 2)];
  if (smooth.length < MIN_PX) return { h: null, med, tower: false }; // toit caché (arbres): pas de mesure fiable
  // Histogramme au mètre, lissé sur trois cases (±1 m).
  const lo = Math.floor(smooth[0]), bins = new Map();
  for (const v of smooth) { const b = Math.floor(v) - lo; bins.set(b, (bins.get(b) || 0) + 1); }
  const n = smooth.length, top = Math.floor(smooth[n - 1]) - lo;
  let best = -1;
  for (let b = top; b >= 0; b--) {
    if (lo + b + 0.5 > maxH) continue;
    const share = ((bins.get(b - 1) || 0) + (bins.get(b) || 0) + (bins.get(b + 1) || 0)) / n;
    if (share >= PLATEAU) { best = b; break; }
  }
  const sMed = smooth[Math.floor(n / 2)];
  if (best < 0) return { h: sMed <= maxH ? sMed : null, med, tower: false };
  // Valeur du palier: médiane des points lisses à ±1,5 m de son centre.
  const c = lo + best + 0.5, near = smooth.filter((v) => Math.abs(v - c) <= 1.5);
  const h = near[Math.floor(near.length / 2)];
  return { h, med, tower: h - sMed > Math.max(8, 0.4 * sMed) };
}

// Mosaïques d'une collection qui touchent le cadre. Une erreur (catalogue indisponible, délai) remonte: elle ne doit
// pas passer pour une absence de LiDAR, sinon la scène serait gardée sans hauteurs mesurées.
export async function items(coll, bbox) {
  const r = await fetch(`${STAC}/${coll}/items?bbox=${bbox.join(',')}&limit=10`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`catalogue LiDAR ${r.status}`);
  const j = await r.json();
  return (j.features || []).filter((f) => f.assets && f.assets.dsm && f.assets.dtm).map((f) => ({ dsm: f.assets.dsm.href, dtm: f.assets.dtm.href, coll, date: String((f.properties && (f.properties.datetime || f.properties.start_datetime)) || '').slice(0, 10) }));
}

// Fenêtre au mètre (niveau 0) d'une mosaïque qui couvre le cadre [E0, N0, E1, N1] (Lambert du Canada).
export async function window1m(url, E0, N0, E1, N1) {
  const cog = await openCog(url);
  const L = cog.levels[0];
  const c0 = Math.max(0, Math.floor((E0 - L.x0) / L.res)), c1 = Math.min(L.width, Math.ceil((E1 - L.x0) / L.res));
  const r0 = Math.max(0, Math.floor((L.y0 - N1) / L.res)), r1 = Math.min(L.height, Math.ceil((L.y0 - N0) / L.res));
  if (c1 - c0 < 2 || r1 - r0 < 2) return null;
  const win = await readWindow(cog, 0, c0, r0, c1, r1);
  return { ...win, x0: L.x0, y0: L.y0, res: L.res };
}

const inRing = (x, y, r) => {
  let ins = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) ins = !ins;
  }
  return ins;
};

// bld: [anneau en mètres locaux (x est, n nord), h, étages, genre] autour de (lat, lng). Modifie bld en place:
// h et étages mesurés, et un 5e champ à 1 quand la hauteur vient du LiDAR. Retourne { measured, failed }: failed
// quand une lecture a échoué (la scène ne doit alors pas être gardée en cache comme définitive).
export async function lidarHeights(lat, lng, bld, log = () => {}) {
  // Les bâtiments déjà mesurés (empreintes LiDAR, api/footprints.js: 5e champ à 1) ne sont pas relus.
  const todo = bld.map((b, i) => (b[4] === 1 ? -1 : i)).filter(i => i >= 0);
  if (!todo.length) return { measured: 0, failed: false };
  const mLat = 111320, mLng = 111320 * Math.cos(lat * Math.PI / 180);
  // Cadre des empreintes à mesurer (en mètres locaux), puis en Lambert du Canada.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of todo) for (const [x, n] of bld[i][0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, n); y1 = Math.max(y1, n); }
  const toL = (x, n) => toLCC(lat + n / mLat, lng + x / mLng);
  const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, n]) => toL(x, n));
  const E0 = Math.min(...corners.map((c) => c[0])) - 2, E1 = Math.max(...corners.map((c) => c[0])) + 2;
  const N0 = Math.min(...corners.map((c) => c[1])) - 2, N1 = Math.max(...corners.map((c) => c[1])) + 2;
  const bbox = [lng + x0 / mLng, lat + y0 / mLat, lng + x1 / mLng, lat + y1 / mLat];
  // 1 m d'abord, puis 2 m pour les trous de couverture du 1 m (mêmes tuiles de 500 km dans les deux collections).
  const err = { '1m': false, '2m': false };
  const [l1, l2] = await Promise.all(['1m', '2m'].map((r) => items(`hrdem-mosaic-${r}`, bbox).catch((e) => { err[r] = true; log(`hauteurs ${r}: ${e.message}`); return []; })));
  let failed = err['1m']; // le 2 m ne compte que s'il sert (voir plus bas)
  const list = [...l1, ...l2];
  if (!list.length) { failed = failed || err['2m']; log(failed ? 'hauteurs: catalogue LiDAR indisponible' : 'hauteurs: pas de LiDAR ici'); return { measured: 0, failed }; }

  const done = bld.map(b => b[4] === 1);
  const missing = new Array(bld.length).fill(true); // pas encore couvert par une mosaïque lue
  let measured = 0;
  for (const it of list) {
    // Mosaïque à 2 m: seulement s'il reste des bâtiments que le 1 m ne couvrait pas.
    if (it.coll === 'hrdem-mosaic-2m' && !bld.some((_, bi) => !done[bi] && missing[bi])) break;
    if (it === l1[l1.length - 1] && err['2m'] && bld.some((_, bi) => !done[bi] && missing[bi])) failed = true;
    let dsm, dtm;
    try { [dsm, dtm] = await Promise.all([window1m(it.dsm, E0, N0, E1, N1), window1m(it.dtm, E0, N0, E1, N1)]); } catch (e) { failed = true; log(`hauteurs: ${e.message}`); continue; }
    if (!dsm || !dtm || dsm.c0 !== dtm.c0 || dsm.r0 !== dtm.r0 || dsm.w !== dtm.w || dsm.h !== dtm.h || dsm.res !== dtm.res) continue;
    const { w, h, c0, r0, res } = dsm;
    const px = (E, N) => [(E - dsm.x0) / res - c0 - 0.5, (dsm.y0 - N) / res - r0 - 0.5]; // centre du pixel (0,0) en (0,0)
    const hAt = (i, j) => { if (i < 0 || j < 0 || i >= w || j >= h) return NaN; const k = j * w + i; return dsm.data[k] - dtm.data[k]; };
    bld.forEach((b, bi) => {
      if (done[bi]) return;
      const ring = b[0].map(([x, n]) => px(...toL(x, n)));
      let i0 = Infinity, j0 = Infinity, i1 = -Infinity, j1 = -Infinity;
      for (const [i, j] of ring) { i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); }
      i0 = Math.max(0, Math.ceil(i0)); j0 = Math.max(0, Math.ceil(j0)); i1 = Math.min(w - 1, Math.floor(i1)); j1 = Math.min(h - 1, Math.floor(j1));
      if (i1 < i0 || j1 < j0) return;
      // Pixels de l'empreinte; « intérieurs » si leurs quatre voisins y sont aussi (on écarte les bords, où le
      // relevé mêle le toit et le sol).
      const inside = new Map();
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (inRing(i, j, ring)) inside.set(j * w + i, true);
      const all = [], core = [];
      inside.forEach((_, k) => {
        const i = k % w, j = (k - i) / w, v = hAt(i, j);
        if (!(v === v)) return;
        // Rugosité: plus grand écart avec les quatre voisins (un toit est lisse, la cime d'un arbre ne l'est pas).
        let rough = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const u = hAt(i + di, j + dj); if (u === u) rough = Math.max(rough, Math.abs(u - v)); }
        all.push({ v, rough });
        if (inside.has(k - 1) && inside.has(k + 1) && inside.has(k - w) && inside.has(k + w)) core.push({ v, rough });
      });
      if (all.length >= Math.max(1, inside.size * 0.5)) missing[bi] = false; // couvert (au moins à moitié) par cette mosaïque
      const vals = core.length >= MIN_PX ? core : all;
      if (vals.length < MIN_PX) return;
      // Plafond pour les petits bâtiments (une grande cime d'arbre au-dessus ne doit pas en faire une tour).
      const area = inside.size * res * res, kind = b[3];
      const maxH = area >= 400 ? Infinity : kind === 2 ? 7 : kind === 1 ? (area < 250 ? 20 : Infinity) : 13;
      const pick = pickHeight(vals, maxH);
      done[bi] = true; // mesuré ou jugé absent du relevé: on ne le relit pas dans une autre mosaïque
      if (!(pick.med >= MIN_H) || pick.h == null || !(pick.h >= MIN_H)) return; // absent au relevé, ou toit caché par les arbres
      const H = Math.round(Math.min(pick.h, 250) * 10) / 10;
      const fl = b[2];
      b[1] = H;
      // Étages: ceux d'Overture s'ils collent à la hauteur mesurée, sinon un étage par 3,3 m.
      if (!(fl && Math.abs(fl * 3.3 - H) <= 0.3 * H)) b[2] = Math.max(1, Math.round(H / 3.3));
      b[4] = 1;
      measured++;
    });
    if (done.every(Boolean)) break;
  }
  log(`hauteurs LiDAR: ${measured}/${bld.length} bâtiments${failed ? ' (lecture incomplète)' : ''}`);
  return { measured, failed };
}
