// Noms de rues de SAT2. Le satellite d'Apple n'en a aucun: on les dessine nous-mêmes, à la manière des étiquettes du
// satellite de Google (texte blanc, halo sombre, posé le long de la rue). Les rues sont celles d'OpenStreetMap, par
// Overture, déjà chargées pour la vue 3D (cache partagé scene3d, environ 500 m autour du projet).
//
// Les emplacements possibles sont calculés une fois par palier de zoom, dans le repère du monde: en déplaçant la
// carte, chaque étiquette reste collée à sa rue, et l'ordre de priorité (grandes rues d'abord) ne change pas, d'où
// des noms qui ne sautent pas d'une rue à l'autre.
import { OverlayView } from './appleSat.js';

const FONT_PX = 12.5; // taille des noms de rues du satellite de Google
const FONT = `500 ${FONT_PX}px 'Avenir Next', Avenir, -apple-system, 'Helvetica Neue', sans-serif`;
const PAD = 5; // marge autour d'une étiquette pour la détection des chevauchements
const SAME_NAME_GAP = 320; // px entre deux répétitions d'un même nom
const BEND = 18 * Math.PI / 180; // au-delà, la rue tourne trop pour y poser du texte droit
const DRIFT = 3; // px: écart maximal entre la rue et la corde du tronçon, pour que le nom reste sur la rue
const CENTER_CLEAR = 30; // px autour du rond central laissés libres

const toWorld = (lat, lng, scale) => {
  const s = Math.sin(lat * Math.PI / 180);
  return { x: (lng + 180) / 360 * scale, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale };
};

// Bouts de rue d'un même nom raccordés bout à bout (Overture les coupe à chaque intersection).
function chains(pieces) {
  const key = (p) => p.lat.toFixed(5) + ',' + p.lng.toFixed(5);
  const left = pieces.map((p) => p.pts.slice());
  const out = [];
  while (left.length) {
    let chain = left.pop();
    let grown = true;
    while (grown) {
      grown = false;
      for (let i = 0; i < left.length; i++) {
        const c = left[i];
        const a0 = key(chain[0]), a1 = key(chain[chain.length - 1]);
        const b0 = key(c[0]), b1 = key(c[c.length - 1]);
        if (a1 === b0) chain = chain.concat(c.slice(1));
        else if (a1 === b1) chain = chain.concat(c.slice(0, -1).reverse());
        else if (a0 === b1) chain = c.concat(chain.slice(1));
        else if (a0 === b0) chain = c.slice(1).reverse().concat(chain);
        else continue;
        left.splice(i, 1);
        grown = true;
        break;
      }
    }
    out.push(chain);
  }
  return out;
}

// Les points intermédiaires restent près de la corde A-B: un nom centré sur la corde tombe alors sur la rue,
// même dans une courbe douce.
function hugs(P, i, k) {
  const A = P[i], B = P[k];
  const dx = B.x - A.x, dy = B.y - A.y, l = Math.hypot(dx, dy) || 1;
  for (let q = i + 1; q < k; q++) if (Math.abs((P[q].x - A.x) * dy - (P[q].y - A.y) * dx) / l > DRIFT) return false;
  return true;
}

// Rectangles orientés: chevauchement par l'axe séparateur.
function corners(l) {
  const c = Math.cos(l.angle), s = Math.sin(l.angle);
  const hw = l.w / 2 + PAD, hh = l.h / 2 + PAD;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [l.x + x * c - y * s, l.y + x * s + y * c]);
}
function overlaps(a, b) {
  if (Math.hypot(a.x - b.x, a.y - b.y) > (a.w + b.w) / 2 + a.h + b.h + 2 * PAD) return false;
  const ca = corners(a), cb = corners(b);
  for (const poly of [ca, cb]) {
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % 4];
      const nx = y2 - y1, ny = x1 - x2;
      const pa = ca.map(([x, y]) => x * nx + y * ny), pb = cb.map(([x, y]) => x * nx + y * ny);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
  }
  return true;
}

export class StreetLabels extends OverlayView {
  constructor(scene) {
    super();
    const [lat0, lng0] = scene.origin;
    const mLng = 111320 * Math.cos(lat0 * Math.PI / 180);
    const byName = new Map();
    for (const r of scene.roads || []) {
      if (r.k !== 0 || !r.n || !r.p || r.p.length < 2) continue;
      const pts = r.p.map(([x, n]) => ({ lat: lat0 + n / 111320, lng: lng0 + x / mLng }));
      if (!byName.has(r.n)) byName.set(r.n, { w: r.w, pieces: [] });
      const e = byName.get(r.n);
      e.w = Math.max(e.w, r.w);
      e.pieces.push({ pts });
    }
    this._streets = [...byName.entries()].map(([name, e]) => ({ name, w: e.w, lines: chains(e.pieces) }));
    this._zoomKey = null;
    this._cands = [];
  }

  onAdd() {
    this._canvas = document.createElement('canvas');
    this._canvas.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;';
    // Sous la teinte de nuit (même volet), comme les noms imprimés dans les images de Google.
    const pane = this.getPanes().mapPane;
    pane.insertBefore(this._canvas, pane.firstChild);
    this._ctx = this._canvas.getContext('2d');
    // Crédit exigé par la licence d'OpenStreetMap (ODbL): lisible et relié à sa page de droits d'auteur.
    this._credit = document.createElement('a');
    this._credit.href = 'https://www.openstreetmap.org/copyright';
    this._credit.target = '_blank';
    this._credit.rel = 'noopener noreferrer';
    this._credit.textContent = 'Rues © OpenStreetMap';
    this._credit.style.cssText = "position:absolute;left:8px;bottom:34px;z-index:5;font:400 10px 'Avenir Next',Avenir,sans-serif;letter-spacing:0.02em;color:rgba(255,255,255,0.85);text-decoration:none;text-shadow:0 0 3px rgba(0,0,0,0.9);pointer-events:auto;white-space:nowrap;";
    this.getMap().getDiv().appendChild(this._credit);
  }

  onRemove() {
    if (this._canvas) this._canvas.remove();
    if (this._credit) this._credit.remove();
    this._canvas = this._credit = this._ctx = null;
  }

  // Emplacements possibles pour un palier de zoom: le long des tronçons assez droits et assez longs pour le nom.
  _candidates(zoom) {
    const scale = 256 * Math.pow(2, zoom);
    const ctx = this._ctx;
    ctx.font = FONT;
    const cands = [];
    for (const st of this._streets) {
      const tw = ctx.measureText(st.name).width;
      for (const line of st.lines) {
        const P = line.map((p) => toWorld(p.lat, p.lng, scale));
        let i = 0;
        while (i < P.length - 1) {
          // Tronçon droit: on avance tant que la direction reste proche de celle du départ.
          const a0 = Math.atan2(P[i + 1].y - P[i].y, P[i + 1].x - P[i].x);
          let j = i + 1;
          while (j < P.length - 1) {
            const a = Math.atan2(P[j + 1].y - P[j].y, P[j + 1].x - P[j].x);
            let d = Math.abs(a - a0);
            if (d > Math.PI) d = 2 * Math.PI - d;
            if (d > BEND || !hugs(P, i, j + 1)) break;
            j++;
          }
          const A = P[i], B = P[j];
          const len = Math.hypot(B.x - A.x, B.y - A.y);
          if (len >= tw + 16) {
            let angle = Math.atan2(B.y - A.y, B.x - A.x);
            if (angle > Math.PI / 2) angle -= Math.PI;
            if (angle < -Math.PI / 2) angle += Math.PI;
            // Un nom au milieu, puis d'autres le long des grands tronçons.
            const n = Math.max(1, Math.floor(len / (tw + SAME_NAME_GAP)));
            for (let k = 0; k < n; k++) {
              const t = (k + 0.5) / n;
              cands.push({ name: st.name, x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t, angle, w: tw, h: FONT_PX + 2, prio: st.w * 10000 + len });
            }
          }
          i = j;
        }
      }
    }
    cands.sort((a, b) => b.prio - a.prio);
    return cands;
  }

  draw() {
    const map = this.getMap();
    const proj = this.getProjection();
    if (!map || !proj || !this._canvas) return;
    const div = map.getDiv();
    const W = div.clientWidth, H = div.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (this._canvas.width !== Math.round(W * dpr) || this._canvas.height !== Math.round(H * dpr)) {
      this._canvas.width = Math.round(W * dpr);
      this._canvas.height = Math.round(H * dpr);
      this._canvas.style.width = W + 'px';
      this._canvas.style.height = H + 'px';
    }
    const ctx = this._ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Les emplacements suivent le palier entier; pendant une animation de zoom, on garde ceux du palier visé
    // et on les replace à l'échelle courante.
    const zoomKey = map.getZoom();
    if (zoomKey !== this._zoomKey) { this._zoomKey = zoomKey; this._cands = this._candidates(zoomKey); }
    const live = proj.getWorldWidth();
    const k = live / (256 * Math.pow(2, zoomKey));
    const c = map.getCenter();
    const cw = toWorld(c.lat(), c.lng(), live);
    const ox = cw.x - W / 2, oy = cw.y - H / 2;

    const placed = [];
    ctx.font = FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const cand of this._cands) {
      const x = cand.x * k - ox, y = cand.y * k - oy;
      // Le nom doit tenir en entier dans le cadre, selon son inclinaison.
      const ca = Math.abs(Math.cos(cand.angle)), sa = Math.abs(Math.sin(cand.angle));
      const ex = ca * cand.w / 2 + sa * cand.h / 2 + 4, ey = sa * cand.w / 2 + ca * cand.h / 2 + 4;
      if (x < ex || x > W - ex || y < ey || y > H - ey) continue;
      if (Math.hypot(x - W / 2, y - H / 2) < CENTER_CLEAR + cand.w / 2 * 0.3) continue;
      const lab = { x, y, angle: cand.angle, w: cand.w, h: cand.h, name: cand.name };
      if (placed.some((p) => (p.name === lab.name && Math.hypot(p.x - x, p.y - y) < SAME_NAME_GAP) || overlaps(p, lab))) continue;
      placed.push(lab);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(cand.angle);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 3;
      ctx.strokeText(cand.name, 0, 0.5);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(cand.name, 0, 0.5);
      ctx.restore();
      if (placed.length >= 40) break;
    }
  }
}
