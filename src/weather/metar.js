// Observations des aéroports (METAR), 15 octobre 2026. Décodage partagé entre la fonction serveur api/metar.js et le
// client: couverture du ciel en huitièmes, par étage (bas sous 2 km, moyen, haut) et par couche (type, base, huitièmes).
// Les observations humaines canadiennes donnent les huitièmes de chaque couche dans les remarques (RMK SC1AC1CI1: 1/8 de
// stratocumulus, 1/8 d'altocumulus, 1/8 de cirrus), avec « SC TR » pour une trace. Les stations automatiques (AUTO) ne
// donnent que les couches vues par le céilomètre (environ 3 km au plus): seuls leurs nuages bas sont fiables.

const LOW_T = new Set(['ST', 'SC', 'CU', 'TCU', 'CB', 'CF', 'SF', 'NS']);
const MID_T = new Set(['AC', 'AS', 'ACC']);
const OBSC = new Set(['FG', 'BR', 'HZ', 'FU', 'SN', 'DZ', 'RA', 'BS', 'IC', 'PL', 'SG', 'GR', 'GS', 'DU', 'SA', 'VA', 'PO', 'SS', 'DS', 'BD', 'BN', 'BY']);
const AMT = { FEW: 1.5, SCT: 3.5, BKN: 6, OVC: 8 };
const CAT = { FEW: [1, 2], SCT: [3, 4], BKN: [5, 7], OVC: [8, 8] }; // huitièmes possibles par catégorie du corps
const KNOWN = new Set(['CI', 'CS', 'CC', 'AC', 'AS', 'ACC', ...LOW_T, ...OBSC]);
const FT = 0.3048;
const LOW_MAX_FT = 6500; // ~2 km au-dessus du sol: même limite que les nuages bas d'Open-Meteo

// raw: texte METAR complet. Rend null si l'observation ne dit rien du ciel (station sans céilomètre).
export function parseMetar(raw) {
  if (!raw) return null;
  const [body, rmk = ''] = raw.split(' RMK ');
  const auto = /\bAUTO\b/.test(body);
  const layers = [...body.matchAll(/\b(FEW|SCT|BKN|OVC)(\d{3}|\/\/\/)(CB|TCU|\/\/\/)?\b/g)].map((m) => ({ cover: m[1], baseFt: m[2] === '///' ? null : Number(m[2]) * 100, conv: m[3] === 'CB' || m[3] === 'TCU' ? m[3] : null }));
  const vv = /\bVV(\d{3}|\/\/\/)\b/.exec(body);
  const clear = /\b(SKC|CLR|NSC|NCD)\b/.test(body);
  const visM = /\s(\d{1,2})SM\s/.exec(body), visF = /\s(\d)\/(\d)SM\s/.exec(body);
  const visKm = visM ? Math.round(Number(visM[1]) * 1.609) : visF ? Math.round((Number(visF[1]) / Number(visF[2])) * 16) / 10 : null;
  // Remarques canadiennes: premier mot fait uniquement de « type + chiffre »
  // (types connus seulement: « AO2 » des stations américaines n'est pas une couche de 2/8)
  let octas = null;
  for (const w of rmk.split(/\s+/)) {
    if (/^(?:[A-Z]{2,3}\d)+$/.test(w) && !w.startsWith('SLP')) {
      const toks = [...w.matchAll(/([A-Z]{2,3})(\d)/g)].map((m) => [m[1], Number(m[2])]);
      if (toks.every(([t]) => KNOWN.has(t))) { octas = toks; break; }
    }
  }
  const traces = new Set([...rmk.matchAll(/\b([A-Z]{2,3}) TR\b/g)].map((m) => m[1]));
  const cb = layers.some((l) => l.conv === 'CB') || !!(octas && octas.some(([t]) => t === 'CB'));
  const tcu = layers.some((l) => l.conv === 'TCU') || !!(octas && octas.some(([t]) => t === 'TCU'));
  const out = { human: !auto, cb, tcu, visKm, layers: [] };
  if (octas && !auto) {
    const clouds = octas.filter(([t]) => !OBSC.has(t));
    let low = octas.filter(([t]) => OBSC.has(t)).reduce((s, [, n]) => s + n, 0), mid = 0, high = 0;
    const paired = clouds.length === layers.length;
    clouds.forEach(([t, n], i) => {
      const amt = traces.has(t) && n <= 1 ? 0 : n; // trace: 0 (même lecture que le banc qui a calé la correction)
      const baseFt = paired ? layers[i].baseFt : null;
      const tier = baseFt != null ? (baseFt <= LOW_MAX_FT ? 0 : baseFt <= 20000 ? 1 : 2) : (LOW_T.has(t) ? 0 : MID_T.has(t) ? 1 : 2);
      if (tier === 0) low += amt; else if (tier === 1) mid += amt; else high += amt;
      out.layers.push({ type: t, octas: amt, baseM: baseFt != null ? Math.round(baseFt * FT) : null });
    });
    // bornes de la catégorie du corps (couverture cumulée): total = couche la plus haute, bas = plus haute couche basse
    let tot = low + mid + high;
    if (layers.length) {
      const [lo, hi] = CAT[layers[layers.length - 1].cover]; tot = Math.min(Math.max(tot, lo), hi); // même lecture que le banc (des traces seules comptent comme 1/8)
      const lows = layers.filter((l) => l.baseFt != null && l.baseFt <= LOW_MAX_FT);
      if (lows.length) { const [lo2, hi2] = CAT[lows[lows.length - 1].cover]; low = Math.min(Math.max(low, lo2), hi2); }
    }
    low = Math.min(8, low); mid = Math.min(8, mid); high = Math.min(8, high);
    return { ...out, kind: 'octas', tot: Math.min(8, tot), low, mid, high };
  }
  if (clear && !layers.length && !vv) return { ...out, kind: auto ? 'auto-clear' : 'clear', tot: auto ? null : 0, low: 0, mid: auto ? null : 0, high: auto ? null : 0 };
  if (vv) return { ...out, kind: 'obscured', tot: 8, low: 8, mid: null, high: null };
  if (layers.length) {
    // Groupes du corps: couverture cumulée (une couche inclut celles du dessous)
    const low = Math.max(0, ...layers.filter((l) => l.baseFt != null && l.baseFt <= LOW_MAX_FT).map((l) => AMT[l.cover]));
    layers.forEach((l) => out.layers.push({ type: l.conv || null, cover: l.cover, octas: AMT[l.cover], baseM: l.baseFt != null ? Math.round(l.baseFt * FT) : null }));
    return { ...out, kind: auto ? 'auto' : 'sky', tot: auto ? null : Math.max(...layers.map((l) => AMT[l.cover])), low, mid: null, high: null };
  }
  return null;
}

export const kmBetween = (a, b, c, d) => {
  const r = Math.PI / 180, x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(x));
};
