import React from 'react';

// ===== ICONS =====
// Rayons d'un soleil (8 tiges) autour du centre (cx,cy), rayon r, ecart gap, longueur len
export const sunRays = (cx, cy, r, gap, len, sw, color = '#ffe26b') => [0,45,90,135,180,225,270,315].map((a, i) => {
  const t = a * Math.PI / 180;
  const x1 = cx + Math.cos(t) * (r + gap), y1 = cy + Math.sin(t) * (r + gap);
  const x2 = cx + Math.cos(t) * (r + gap + len), y2 = cy + Math.sin(t) * (r + gap + len);
  return <line key={i} x1={x1.toFixed(1)} y1={y1.toFixed(1)} x2={x2.toFixed(1)} y2={y2.toFixed(1)} stroke={color} strokeWidth={sw} strokeLinecap="round"/>;
});
// Gros soleil place DERRIERE le nuage : un masque avale la portion cachee, les rayons
// depassent tout autour. Affichage volontairement optimiste pour les paliers 21-70%.
export const SUN_CLOUD_PATH = "M8 18c0-4 3-7 7-7s7 3 7 7c2 0 4 2 4 4s-2 4-4 4H8c-3 0-5-2.5-5-5s2-5 5-5z";
export let __sbcSeq = 0;
export const SunBehindCloud = ({ className, sr, gap, len, scx, scy, ccx, ccy, cs, ccolor }) => {
  const uid = React.useMemo(() => 'sbc' + (__sbcSeq++), []);
  const tf = `translate(${(ccx - 15 * cs).toFixed(2)} ${(ccy - 18.5 * cs).toFixed(2)}) scale(${cs})`;
  return <svg className={className} viewBox="0 0 32 32" fill="none">
    <defs>
      <mask id={uid} maskUnits="userSpaceOnUse">
        <rect x="0" y="0" width="32" height="32" fill="#fff"/>
        <g transform={tf}><path d={SUN_CLOUD_PATH} fill="#000" stroke="#000" strokeWidth="3.4" vectorEffect="non-scaling-stroke" strokeLinejoin="round"/></g>
      </mask>
    </defs>
    <g mask={`url(#${uid})`}>
      <circle cx={scx} cy={scy} r={sr} stroke="#ffe26b" strokeWidth="1.5"/>
      {sunRays(scx, scy, sr, gap, len, 1.5)}
    </g>
    <g transform={tf}><path d={SUN_CLOUD_PATH} stroke={ccolor} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round"/></g>
  </svg>;
};

// Soleil voile: disque translucide + rayons conserves + fins filaments de cirrus par-dessus.
// 5 niveaux (1 = voile tres leger, soleil filtre franc; 5 = voile dense, soleil a peine devine).
// Plus le niveau monte, plus le jaune se desature, plus les rayons raccourcissent et plus les
// filaments sont presents. Volontairement sobre (pas un gros soleil eclatant). Niveau choisi
// par veilIcon() selon la lumiere directe.
export const VEIL_STREAKS = {
  top: 'M3.5 10 Q10 8.5 16.5 9.8 T29 9.4',
  up:  'M3.5 14 Q11 12.6 18 13.8 T30 13.2',
  mid: 'M3 16.2 Q10 15 17 16 T30 15.6',
  lo:  'M3.5 18.5 Q10.5 17 17 18.4 T29.5 18',
  low: 'M5 22.5 Q11 21.2 17 22.2 T28 21.8'
};
export const VEIL_CFG = {
  1: { col: '#E9D27A', len: 2.8, rayOp: 0.85, strokeOp: 0.9,  fillOp: 0.18, streaks: [['lo', 0.4, '#AEB6B6'], ['low', 0.32, '#AEB6B6']] },
  2: { col: '#E4CB78', len: 2.5, rayOp: 0.74, strokeOp: 0.82, fillOp: 0.15, streaks: [['top', 0.46, '#AEB6B6'], ['lo', 0.55, '#AEB6B6'], ['low', 0.45, '#AEB6B6']] },
  3: { col: '#DBCD92', len: 2.2, rayOp: 0.6,  strokeOp: 0.72, fillOp: 0.13, streaks: [['top', 0.58, '#9CA3AF'], ['lo', 0.66, '#9CA3AF'], ['low', 0.55, '#9CA3AF']] },
  4: { col: '#CFC8A4', len: 1.9, rayOp: 0.46, strokeOp: 0.6,  fillOp: 0.11, streaks: [['top', 0.66, '#9CA3AF'], ['up', 0.74, '#9CA3AF'], ['lo', 0.78, '#9CA3AF'], ['low', 0.64, '#9CA3AF']] },
  5: { col: '#C3BDAA', len: 1.6, rayOp: 0.34, strokeOp: 0.5,  fillOp: 0.1,  streaks: [['top', 0.76, '#939AA3'], ['up', 0.82, '#939AA3'], ['mid', 0.8, '#939AA3'], ['lo', 0.84, '#939AA3'], ['low', 0.74, '#939AA3']] }
};
export const SunVeil = ({ className, level }) => {
  const c = VEIL_CFG[level] || VEIL_CFG[3];
  return <svg className={className} viewBox="0 0 32 32" fill="none">
    <circle cx="16" cy="16" r="6" fill={c.col} fillOpacity={c.fillOp} stroke="none"/>
    <g opacity={c.rayOp}>{sunRays(16, 16, 6, 1.9, c.len, 1.5, c.col)}</g>
    <circle cx="16" cy="16" r="6" fill="none" stroke={c.col} strokeWidth="1.5" opacity={c.strokeOp}/>
    {c.streaks.map(([k, o, sc], i) => <path key={i} d={VEIL_STREAKS[k]} fill="none" stroke={sc} strokeWidth="1.1" strokeLinecap="round" opacity={o}/>)}
  </svg>;
};

// Soleil "de fumee": disque plein teinte (ambre -> orange -> rouge selon la densite) + halo
// diffus, rayons courts et ternes. Pour les jours ou la fumee de feux voile la lumiere.
export const SMOKE_CFG = {
  1: { disc: '#E6B25C', halo: '#E6B25C', halOp: 0.13, halR: 9,   dR: 4.8 },
  2: { disc: '#D9853C', halo: '#D9853C', halOp: 0.16, halR: 9.5, dR: 4.8 },
  3: { disc: '#C5532C', halo: '#B5532C', halOp: 0.18, halR: 10,  dR: 4.4 }
};
// Teinte de fond appliquee aux cases (jour et heures) selon le niveau de fumee.
export const SMOKE_TINT = { 1: 'rgba(230,178,92,0.07)', 2: 'rgba(217,133,60,0.11)', 3: 'rgba(197,83,44,0.15)' };
export const SunSmoke = ({ className, level }) => {
  const c = SMOKE_CFG[level] || SMOKE_CFG[2];
  return <svg className={className} viewBox="0 0 32 32" fill="none">
    <circle cx="16" cy="16" r={c.halR} fill={c.halo} fillOpacity={c.halOp}/>
    <g opacity="0.5">{sunRays(16, 16, c.dR, 1.5, 1.4, 1.5, c.disc)}</g>
    <circle cx="16" cy="16" r={c.dR} fill={c.disc} fillOpacity="0.92" stroke={c.disc} strokeWidth="0.8"/>
  </svg>;
};

export const WeatherIcon = ({ type, className = "w-6 h-6" }) => {
  const icons = {
    // Niveau 1: 0-10% - Gros soleil éclatant, rayons longs
    'sunny-bright': <svg className={className} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="6" stroke="#ffe26b" strokeWidth="2"/>
      {sunRays(16, 16, 6, 1.9, 4.2, 2)}
    </svg>,
    // Niveau 2: 11-20% - Gros soleil (même grosseur que les autres)
    'sunny': <svg className={className} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="6" stroke="#ffe26b" strokeWidth="1.5"/>
      {sunRays(16, 16, 6, 1.9, 3.4, 1.5)}
    </svg>,
    // Niveau 3: 21-30% - Gros soleil derrière, petit nuage décalé à gauche
    'sunny-few-clouds': <SunBehindCloud className={className} sr={6} gap={1.7} len={3.6} scx={18} scy={13} ccx={14.5} ccy={24.5} cs={0.5} ccolor="#AEB6B6"/>,
    // Niveau 4: 31-40% - Gros soleil derrière, nuage moyen
    'mostly-sunny': <SunBehindCloud className={className} sr={6} gap={1.7} len={3.6} scx={18} scy={13} ccx={14.5} ccy={24.5} cs={0.64} ccolor="#9CA3AF"/>,
    // Niveau 5: 41-55% - Gros soleil derrière, nuage plus gros
    'partly-cloudy': <SunBehindCloud className={className} sr={6} gap={1.7} len={3.6} scx={18} scy={13} ccx={14} ccy={24.5} cs={0.8} ccolor="#9CA3AF"/>,
    // Niveau 6: 56-70% - Soleil avalé par un gros nuage, juste la calotte qui pointe
    'mostly-cloudy': <SunBehindCloud className={className} sr={4} gap={1.5} len={2.4} scx={18.5} scy={12.5} ccx={14} ccy={18.5} cs={0.95} ccolor="#9CA3AF"/>,
    // Niveau 7: 71-85% - Nuage avec petite lueur de soleil
    'cloudy-glimpse': <svg className={className} viewBox="0 0 32 32" fill="none" strokeWidth="1.5">
      <circle cx="26" cy="5" r="2" stroke="#ffe26b" strokeWidth="1" strokeDasharray="2 1"/>
      <path d="M6 18c0-4 3-7 7-7s7 3 7 7c2 0 4 2 4 4s-2 4-4 4H6c-3 0-5-2.5-5-5s2-5 5-5z" stroke="#808080"/>
    </svg>,
    // Niveau 8: 86-100% - Nuage complet
    'cloudy': <svg className={className} viewBox="0 0 32 32" fill="none" stroke="#808080" strokeWidth="1.5">
      <path d="M8 18c0-4 3-7 7-7s7 3 7 7c2 0 4 2 4 4s-2 4-4 4H8c-3 0-5-2.5-5-5s2-5 5-5z"/>
    </svg>,
    // Soleil voile (ciel couvert en altitude mais soleil qui filtre) - 5 niveaux selon la lumiere directe
    'sunny-veil-1': <SunVeil className={className} level={1}/>,
    'sunny-veil-2': <SunVeil className={className} level={2}/>,
    'sunny-veil-3': <SunVeil className={className} level={3}/>,
    'sunny-veil-4': <SunVeil className={className} level={4}/>,
    'sunny-veil-5': <SunVeil className={className} level={5}/>,
    // Fumee de feux (ciel enfume) - 3 niveaux selon la concentration
    'sun-smoke-1': <SunSmoke className={className} level={1}/>,
    'sun-smoke-2': <SunSmoke className={className} level={2}/>,
    'sun-smoke-3': <SunSmoke className={className} level={3}/>,
    // Pluie forte
    'rain': <svg className={className} viewBox="0 0 32 32" fill="none" strokeWidth="1.5">
      <path d="M8 12c0-4 3-6 6-6s6 2 6 6c2 0 3 1.5 3 3s-1 3-3 3H8c-2.5 0-4-2-4-4s1.5-4 4-4z" stroke="#6B7280"/>
      <line x1="9" y1="20" x2="6" y2="26" stroke="#7dd3c6" strokeWidth="2"/><line x1="15" y1="20" x2="12" y2="26" stroke="#7dd3c6" strokeWidth="2"/><line x1="21" y1="20" x2="18" y2="26" stroke="#7dd3c6" strokeWidth="2"/>
    </svg>,
    // Neige forte
    'snow': <svg className={className} viewBox="0 0 32 32" fill="none" strokeWidth="1.5">
      <path d="M8 12c0-4 3-6 6-6s6 2 6 6c2 0 3 1.5 3 3s-1 3-3 3H8c-2.5 0-4-2-4-4s1.5-4 4-4z" stroke="#6B7280"/>
      <circle cx="8" cy="24" r="1.5" fill="#7dd3c6"/><circle cx="14" cy="26" r="1.5" fill="#7dd3c6"/><circle cx="20" cy="24" r="1.5" fill="#7dd3c6"/>
      <circle cx="11" cy="28" r="1" fill="#7dd3c6"/><circle cx="17" cy="29" r="1" fill="#7dd3c6"/>
    </svg>,
    // Orage
    'thunderstorm': <svg className={className} viewBox="0 0 32 32" fill="none" strokeWidth="1.5">
      <path d="M8 10c0-4 3-6 6-6s6 2 6 6c2 0 3 1.5 3 3s-1 3-3 3H8c-2.5 0-4-2-4-4s1.5-4 4-4z" stroke="#4B5563"/>
      <path d="M16 17l-3 5h4l-3 6" stroke="#ffe26b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>,
    
    // ===== ICÔNES LUNE (NUIT) - Croissant bleu nuit =====
    // Niveau 1-2: 0-20% - Lune dégagée
    'moon-bright': <svg className={className} viewBox="0 0 32 32" fill="none" stroke="#7dd3c6" strokeWidth="2" strokeLinecap="round">
      <path d="M23 8a8 8 0 1 1-10.2 11.3A6 6 0 1 0 23 8z"/>
    </svg>,
    'moon': <svg className={className} viewBox="0 0 32 32" fill="none" stroke="#7dd3c6" strokeWidth="2" strokeLinecap="round">
      <path d="M23 8a8 8 0 1 1-10.2 11.3A6 6 0 1 0 23 8z"/>
    </svg>,
    // Niveau 3-4: 21-40% - Lune avec petit nuage
    'moon-few-clouds': <svg className={className} viewBox="0 0 32 32" fill="none" strokeWidth="2" strokeLinecap="round">
      <path d="M25 5a6 6 0 1 1-7.7 8.5A4.5 4.5 0 1 0 25 5z" stroke="#7dd3c6"/>
      <path d="M5 24c0-2 1.5-3.5 3.5-3.5s3.5 1.5 3.5 3.5c1.5 0 2.5 1 2.5 2.2s-1 2.3-2.5 2.3H5c-2 0-3-1.5-3-3s1-3 3-3z" stroke="#9CA3AF" strokeWidth="1.5"/>
    </svg>,
    'moon-mostly-clear': <svg className={className} viewBox="0 0 32 32" fill="none" strokeWidth="2" strokeLinecap="round">
      <path d="M25 5a6 6 0 1 1-7.7 8.5A4.5 4.5 0 1 0 25 5z" stroke="#7dd3c6"/>
      <path d="M5 22c0-3 2.5-5 5-5s5 2 5 5c1.5 0 3 1.2 3 3s-1.5 3-3 3H5c-2 0-3.5-1.5-3.5-3.5S3 22 5 22z" stroke="#9CA3AF" strokeWidth="1.5"/>
    </svg>,
    // Niveau 5-6: 41-70% - Lune partiellement cachée
    'moon-partly-cloudy': <svg className={className} viewBox="0 0 32 32" fill="none" strokeWidth="2" strokeLinecap="round">
      <path d="M25 4a5 5 0 1 1-6.4 7A3.8 3.8 0 1 0 25 4z" stroke="#7dd3c6"/>
      <path d="M5 20c0-3.5 2.5-6 5.5-6s5.5 2.5 5.5 6c2 0 3.5 1.5 3.5 3.5s-1.5 3.5-3.5 3.5H5c-2.5 0-4-2-4-4s1.5-4 4-4z" stroke="#9CA3AF" strokeWidth="1.5"/>
    </svg>,
    'moon-mostly-cloudy': <svg className={className} viewBox="0 0 32 32" fill="none" strokeWidth="2" strokeLinecap="round">
      <path d="M26 3a4 4 0 1 1-5 5.2A3 3 0 1 0 26 3z" stroke="#7dd3c6"/>
      <path d="M6 18c0-4 3-7 7-7s7 3 7 7c2 0 4 2 4 4s-2 4-4 4H6c-3 0-5-2.5-5-5s2-5 5-5z" stroke="#808080" strokeWidth="1.5"/>
    </svg>,
    // Niveau 7-8: 71-100% - Nuageux/Couvert
    'moon-cloudy-glimpse': <svg className={className} viewBox="0 0 32 32" fill="none" strokeWidth="1.5" strokeLinecap="round">
      <path d="M27 2a3 3 0 1 1-3.8 4A2.3 2.3 0 1 0 27 2z" stroke="#7dd3c6" strokeWidth="1.5"/>
      <path d="M6 18c0-4 3-7 7-7s7 3 7 7c2 0 4 2 4 4s-2 4-4 4H6c-3 0-5-2.5-5-5s2-5 5-5z" stroke="#808080"/>
    </svg>,
    'moon-cloudy': <svg className={className} viewBox="0 0 32 32" fill="none" stroke="#808080" strokeWidth="1.5">
      <path d="M8 18c0-4 3-7 7-7s7 3 7 7c2 0 4 2 4 4s-2 4-4 4H8c-3 0-5-2.5-5-5s2-5 5-5z"/>
    </svg>,
  };
  return icons[type] || icons.cloudy;
};
