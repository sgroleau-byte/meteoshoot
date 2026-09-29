
export const weatherCodeIcon = { 
  0:'sunny', 1:'sunny', 2:'partly-cloudy', 3:'cloudy',  // 0-1=dégagé, 2=partiellement nuageux, 3=couvert
  45:'cloudy', 48:'cloudy',  // brouillard
  51:'rain', 53:'rain', 55:'rain',  // bruine
  56:'rain', 57:'rain',  // bruine verglaçante
  61:'rain', 63:'rain', 65:'rain',  // pluie
  66:'rain', 67:'rain',  // pluie verglaçante
  71:'snow', 73:'snow', 75:'snow',  // neige
  77:'snow',  // grains de neige
  80:'rain', 81:'rain', 82:'rain',  // averses
  85:'snow', 86:'snow',  // averses de neige
  95:'thunderstorm', 96:'thunderstorm', 99:'thunderstorm'  // orages
};
export const isGoodWeather = (c) => [0,1,2].includes(c);  // 0=dégagé, 1=principalement dégagé, 2=partiellement nuageux

// Niveau d'icône (soleil le jour, lune la nuit) selon la couverture nuageuse en %. Source unique des 8 seuils.
export const CLOUD_ICONS_DAY = ['sunny-bright', 'sunny', 'sunny-few-clouds', 'mostly-sunny', 'partly-cloudy', 'mostly-cloudy', 'cloudy-glimpse', 'cloudy'];
export const CLOUD_ICONS_NIGHT = ['moon-bright', 'moon', 'moon-few-clouds', 'moon-mostly-clear', 'moon-partly-cloudy', 'moon-mostly-cloudy', 'moon-cloudy-glimpse', 'moon-cloudy'];
export const cloudcoverToIcon = (cc, night = false) => {
  const set = night ? CLOUD_ICONS_NIGHT : CLOUD_ICONS_DAY;
  if (cc <= 10) return set[0];
  if (cc <= 20) return set[1];
  if (cc <= 30) return set[2];
  if (cc <= 40) return set[3];
  if (cc <= 55) return set[4];
  if (cc <= 70) return set[5];
  if (cc <= 85) return set[6];
  return set[7];
};

// Fraction de lumiere solaire directe (0 a 1): part qui arrive en faisceau direct du soleil
// plutot qu'en lumiere diffuse. Proche de 1 = soleil franc et ombres; proche de 0 = gris plat.
// null quand il y a trop peu de lumiere (nuit, aube, crepuscule) pour que ce soit significatif.
export const sunlitFraction = (direct, diffuse) => {
  if (direct == null || diffuse == null) return null;
  const tot = direct + diffuse;
  if (tot < 50) return null;
  return direct / tot;
};
// Icone "soleil voile": ciel couvert (couverture elevee) mais soleil qui filtre a travers une
// fine couche en altitude (cirrus). Pilote par la fraction de lumiere directe, PAS par le %
// total. Regle "l'opaque gagne": s'il y a assez de nuages BAS opaques (cloudLow), ce n'est pas
// un voile, on garde l'icone habituelle selon le %. Le voile ne sort donc que pour un couvert
// en altitude avec peu de nuages bas, et seulement si le soleil filtre vraiment. 5 niveaux.
export const VEIL_ICONS = ['sunny-veil-1', 'sunny-veil-2', 'sunny-veil-3', 'sunny-veil-4', 'sunny-veil-5'];
export const VEIL_OPAQUE_LOW = 38; // au-dela, des nuages bas opaques sont presents -> pas de voile
export const veilIcon = (cc, cloudLow, sunFraction) => {
  if (cc == null || cc <= 70) return null;                          // pas couvert -> systeme habituel
  if (cloudLow == null || cloudLow > VEIL_OPAQUE_LOW) return null;  // nuages bas opaques -> opaque gagne
  if (sunFraction == null) return null;                            // nuit / pas de lumiere
  if (sunFraction >= 0.60) return VEIL_ICONS[0];
  if (sunFraction >= 0.45) return VEIL_ICONS[1];
  if (sunFraction >= 0.32) return VEIL_ICONS[2];
  if (sunFraction >= 0.20) return VEIL_ICONS[3];
  if (sunFraction >= 0.10) return VEIL_ICONS[4];
  return null;                                                      // trop eteint -> couvert opaque normal
};

// Teinte doree graduee selon le % de soleil direct, calee sur l'echelle des icones de voile.
// Sert au % horaire (soleil direct) ET a l'indice d'opportunite AM/PM dans la rangee des jours.
export const SUN_DIRECT_COLOR = (pct) => pct == null ? '#6f7d7b'
  : pct >= 60 ? '#E9D27A' : pct >= 45 ? '#E4CB78' : pct >= 32 ? '#DBCD92'
  : pct >= 20 ? '#CFC8A4' : pct >= 10 ? '#C3BDAA' : '#A7A99C';
// Seuil a partir duquel l'indice "belle opportunite" s'allume (en % de soleil direct). Calibrable.
export const SHOOT_OPP_MIN = 50;
// Fenetres de shoot (def. Stephane), en minutes autour du lever / coucher.
// AM = 1h avant le lever a 1h apres; PM = 1h30 avant le coucher a 1h apres.
export const SHOOT_WINDOWS = { am: { before: 60, after: 60 }, pm: { before: 90, after: 60 } };

// Icône d'un jour de la bande météo (et du widget iPhone) à partir du résumé quotidien: la pluie, la neige
// et l'orage priment; sans donnée horaire, l'icône du code météo; sinon voile ou niveau de nuages.
export const dayIcon = (day) => {
  const { cloudcover, icon: originalIcon, sunFraction = null, cloudLow = null } = day || {};
  if (originalIcon === 'thunderstorm') return 'thunderstorm';
  if (originalIcon === 'snow') return 'snow';
  if (originalIcon === 'rain') return 'rain';
  if (cloudcover === null || cloudcover === undefined) {
    if (originalIcon === 'sunny') return 'sunny';
    if (originalIcon === 'partly-cloudy') return 'partly-cloudy';
    return originalIcon || 'cloudy';
  }
  const veil = veilIcon(cloudcover, cloudLow, sunFraction);
  if (veil) return veil;
  return cloudcoverToIcon(cloudcover);
};
