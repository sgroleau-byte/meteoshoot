// Saisons du feuillage dans la vue 3D (23 octobre 2026): couleur des feuillus selon la date et le lieu, d'après un
// calendrier MOYEN (pas l'année en cours): dates de phénologie du satellite MODIS (produit MCD12Q2, pixels de 500 m,
// moyenne 2012 à 2021) relevées sur une grille de points du Canada et des États-Unis (src/scene3d/phenology.js,
// généré par tools/phenology-harvest.py). Pour un lieu: régression latitude + altitude, corrigée par les écarts des
// points voisins (pondération en inverse du carré de la distance). Le satellite donne le MILIEU du brunissement
// (perte de moitié de la verdure: Stoneham vers le 17 septembre, Québec le 5 octobre, Toronto le 12), la fin
// (feuilles tombées, cinq semaines plus tard), le débourrement et la feuillaison du printemps. Le pic de couleur
// visible suit le milieu du brunissement de 30 % de l'intervalle jusqu'à la chute au nord du 46e parallèle, davantage
// vers le sud (6 % de plus par degré, 70 % au plus): plus la saison est douce, plus le satellite, qui voit la verdure
// baisser, devance l'oeil (webcam de Toronto le 23 octobre 2026: ville encore à moitié verte, rouges épars, pic vers le
// 24; Québec vers le 12; New York début novembre).
// Essences (api/trees.js, code k de chaque arbre): 0 feuillu quelconque, 1 conifère, 2 érable (rouge et orangé, tôt),
// 3 feuillu jaune (orme, tilleul, frêne, bouleau, peuplier, érable de Norvège), 4 chêne et hêtre (brun roux, tard, garde
// ses feuilles), 5 mélèze (conifère qui jaunit tard puis se dénude), 6 érable pourpre (pourpre tout l'été).
// Ce module ne touche qu'à la couleur et à la part de feuilles (cover, 0 nu à 1 plein): positions, cimes et formes
// LiDAR restent telles quelles. Étape 2 (23 octobre 2026): le moteur efface les feuilles dans le motif des couronnes
// à mesure que cover baisse, fait apparaître un lacis de branches (voir twigTex et coverShader dans engine.js) et
// étale un tapis de feuilles (litter) au pied des arbres.
import { PHENO } from './phenology.js';

export const ESS = { FEUILLU: 0, CONIFERE: 1, ERABLE: 2, JAUNE: 3, CHENE: 4, MELEZE: 5, POURPRE: 6 };
export const isConifer = (k) => k === ESS.CONIFERE || k === ESS.MELEZE;

const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const KI = { mgd: 3, dor: 4, gup: 5, mgu: 6 };
const kmBetween = (la1, ln1, la2, ln2) => { const dy = (la2 - la1) * 111.32, dx = (ln2 - ln1) * 111.32 * Math.cos((la1 + la2) * 0.5 * Math.PI / 180); return Math.hypot(dx, dy); };

// Calendrier moyen d'un lieu (jours de l'année, fractionnaires): mgd milieu du brunissement, dor feuilles tombées,
// gup débourrement, mgu feuillaison, peak pic de couleur. elev en mètres au-dessus de la mer.
export function climatology(lat, lng, elev = 0) {
  const out = {};
  for (const k of Object.keys(KI)) {
    const [a, b, c] = PHENO.fit[k];
    let sw = 0, sr = 0;
    for (const p of PHENO.pts) {
      const d = kmBetween(lat, lng, p[0], p[1]); if (d > 700) continue;
      const w = 1 / (d * d + 900); // 30 km de rayon de lissage: un point à 30 km pèse la moitié d'un point superposé
      sw += w; sr += w * (p[KI[k]] - (a + b * p[0] + c * p[2]));
    }
    out[k] = a + b * lat + c * elev + (sw ? sr / sw : 0);
  }
  out.peak = out.mgd + Math.min(0.7, 0.3 + 0.06 * Math.max(0, 46 - lat)) * (out.dor - out.mgd);
  return out;
}

export function dayOfYear(ms) { const d = new Date(ms); const y0 = new Date(d.getFullYear(), 0, 1).getTime(); return (ms - y0) / 86400000 + 1; }

// Palettes (sRGB). Été: verts de feuillage au soleil. Pic: par essence; feuillu quelconque: le mélange validé dans le
// moteur depuis le 8 octobre 2026. Nu: gris brun des branches.
const SUMMER = ['#3d6629', '#456d2e', '#4c7533', '#3b622a', '#527c38', '#446b2f', '#406a2c', '#4a7234']; // le moteur éclaircit beaucoup au soleil: verts posés, pas vert pomme
const SPRING = ['#7da64c', '#88af54', '#74a047'];
const PEAK = {
  [ESS.FEUILLU]: ['#c4652b', '#d08a2e', '#b8973a', '#8e8f3e', '#c9a23a', '#b4642c', '#a9552b', '#d9a441', '#7d8c3c'], // sans les verts de l'ancienne palette: la montée part déjà du vert d'été
  [ESS.ERABLE]: ['#b9472a', '#c4652b', '#a9552b', '#d0702e', '#b03a28', '#cf5a2c', '#c86a2a'],
  [ESS.JAUNE]: ['#d9a441', '#d08a2e', '#c9a33a', '#e0b24a', '#b8973a', '#d6a338'],
  [ESS.CHENE]: ['#8e5a2e', '#a0633a', '#7a4f2e', '#9c4a30', '#8a5532'],
  [ESS.MELEZE]: ['#c9952c', '#d4a43a', '#c08a2a'],
  [ESS.POURPRE]: ['#7a3a2c', '#853f2e'],
};
const PURPLE = ['#4a2a34', '#553040', '#46283a'];
const BARE = ['#5c534c', '#655a52', '#574e47', '#6a5f56', '#60564f']; // branches: gris brun chaud, plus clair que les troncs (Stéphane, 23 octobre 2026: « pas une forêt brûlée »)
// Feuilles qui restent pendant la chute: elles gardent leur couleur, à peine ternie vers le cuivre; le brun n'arrive
// qu'avec les branches. Tapis de feuilles au sol: la couleur du pic, assombrie (à l'ombre, mouillée).
const DULL = ['#9a6b3c', '#a8763f', '#8f6238'];
const LITTER_DARK = [0.42, 0.29, 0.16];
const CONIFER = ['#2f4a33', '#3a5638', '#33503a', '#445e3c']; // sapins, épinettes, pins: vert foncé toute l'année

const hsh01 = (c) => { const v = Math.sin(c * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); }; // second aléa tiré de c
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const pick = (pal, c) => hex(pal[Math.min(pal.length - 1, Math.floor(c * pal.length))]);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Décalages par essence (jours): début et pic de couleur, fin de la chute; vitesse de chute.
const OFF = {
  [ESS.FEUILLU]: { peak: 0, dor: 0 },
  [ESS.ERABLE]: { peak: -4, dor: -4 },
  [ESS.JAUNE]: { peak: 0, dor: 0 },
  [ESS.CHENE]: { peak: 8, dor: 14 },
  [ESS.MELEZE]: { peak: 14, dor: 8 },
  [ESS.POURPRE]: { peak: 4, dor: 0 },
};

// État saisonnier d'un lieu à une date: { doy, clim, color(k, c) -> [r, g, b] sRGB, cover(k, c) -> part de feuilles 0..1 }.
// c: aléa fixe de l'arbre (0..1), qui décale son calendrier de ±9 jours (la webcam de Toronto montre des arbres rouges
// à côté d'arbres encore verts) et choisit sa teinte.
export function seasonState(lat, lng, elev, ms) {
  const clim = climatology(lat, lng, elev), doy = dayOfYear(ms);
  const phase = (k, c) => {
    const o = OFF[k] || OFF[ESS.FEUILLU], j = (c - 0.5) * 18;
    const peak = clim.peak + o.peak + j, dor = clim.dor + o.dor + j * 0.55; // la chute resserre l'écart entre arbres (Tremblant tout nu d'un coup)
    const turn = sm(peak - 20, peak, doy); // montée de la couleur sur trois semaines
    const end = Math.max(dor - 5, peak + 14); // feuilles tombées: un peu avant la dormance du satellite (Tremblant nu le 23 octobre 2026), jamais en moins de deux semaines
    const drop = sm(peak + 3, end, doy); // chute, du pic aux feuilles tombées
    // Part qui s'accroche après la chute (Stéphane: « ça vire jamais brun à 100 % »): chênes et hêtres gardent leurs
    // feuilles cuivrées, et un arbre sur cinq, quelle que soit l'essence, garde un tiers de ses feuilles colorées trois
    // semaines de plus; tout s'efface ensuite sur trois semaines (vent, neige).
    const keep0 = k === ESS.CHENE ? 0.55 : hsh01(c) < 0.2 ? 0.35 : 0.08;
    const keep = keep0 * (1 - sm(end + 20, end + 45, doy));
    const fall = drop * (1 - keep);
    const leaf = sm(clim.gup + j * 0.5, clim.mgu + 6 + j * 0.5, doy); // feuillaison du printemps
    const mature = sm(clim.mgu + 6, clim.mgu + 26, doy); // vert tendre vers vert d'été
    const litter = Math.min(sm(peak + 6, end + 2, doy), 1 - sm(end + 10, end + 40, doy)); // tapis au sol: s'étale avec la chute, disparaît sur un mois
    return { turn, fall, drop, leaf, mature, litter, spring: doy < clim.mgd - 40 };
  };
  return {
    doy, clim,
    cover(k, c) { if (k === ESS.CONIFERE) return 1; const p = phase(k, c); return p.spring ? p.leaf : 1 - p.fall; },
    bare(c) { return pick(BARE, c); },
    litter(k, c) { if (k === ESS.CONIFERE) return 0; const p = phase(k, c); return p.spring ? 0 : p.litter; },
    litterColor(k, c) { const pk = pick(PEAK[k] || PEAK[ESS.FEUILLU], c); return mix(pk, LITTER_DARK, 0.45); },
    color(k, c) {
      if (k === ESS.CONIFERE) return pick(CONIFER, c);
      const p = phase(k, c), bare = pick(BARE, c);
      if (p.spring) { const young = pick(SPRING, c), green = k === ESS.POURPRE ? pick(PURPLE, c) : k === ESS.MELEZE ? mix(pick(SUMMER, c), pick(CONIFER, c), 0.5) : pick(SUMMER, c); return mix(bare, mix(young, green, p.mature), p.leaf); }
      const green = k === ESS.POURPRE ? pick(PURPLE, c) : k === ESS.MELEZE ? mix(pick(SUMMER, c), pick(CONIFER, c), 0.5) : pick(SUMMER, c);
      const col = mix(green, pick(PEAK[k] || PEAK[ESS.FEUILLU], c), p.turn);
      return mix(col, pick(DULL, c), 0.45 * p.drop); // les feuilles qui restent gardent leur couleur, à peine ternies
    },
  };
}
