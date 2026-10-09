// Jeux de conditions pour le banc du ciel (tools/sky/shoot.mjs). Les champs météo sont ceux d'une rangée horaire de
// l'application (cloudLow, cloudMid, cloudHigh en %, sunFraction 0 à 1, wc code météo, convBase et convDepth en m,
// precip mm/h, cape J/kg, lcl m, frz m, prof et profZ: profil vertical sur 12 niveaux de pression).
const D = '2026-10-09';
const at = (h) => `${D}T${h}`;
const sunset = (min) => ({ rel: 'sunset', min, date: D });
const sunrise = (min) => ({ rel: 'sunrise', min, date: D });
const toSun = { towardSun: true };

export const SETS = {
  base: [
    { name: '01_clair_midi', time: at('13:00'), weather: { cloudLow: 0, cloudMid: 0, cloudHigh: 0, sunFraction: 0.98, wc: 0 }, view: { towardSun: false } },
    { name: '02_cumulus_40', time: at('13:00'), weather: { cloudLow: 40, sunFraction: 0.75, convBase: 1300, convDepth: 700, wc: 2, cape: 300 } },
    { name: '02b_cumulus_40_soleil', time: at('13:00'), weather: { cloudLow: 40, sunFraction: 0.75, convBase: 1300, convDepth: 700, wc: 2, cape: 300 }, view: toSun },
    { name: '03_congestus_70', time: at('15:00'), weather: { cloudLow: 70, sunFraction: 0.4, convBase: 1000, convDepth: 3500, wc: 3, cape: 900 } },
    { name: '04_stratocumulus_90', time: at('11:00'), weather: { cloudLow: 90, sunFraction: 0.15, wc: 3 } },
    { name: '05_stratus_100', time: at('10:00'), weather: { cloudLow: 100, cloudMid: 30, sunFraction: 0.03, wc: 3 } },
    { name: '06_orage', time: at('16:00'), weather: { cloudLow: 85, cloudMid: 60, cloudHigh: 80, sunFraction: 0.1, wc: 95, convBase: 700, convDepth: 10000, precip: 2.5, cape: 1500, pSun: 0.05 } },
    { name: '06b_orage_soleil', time: at('16:00'), weather: { cloudLow: 85, cloudMid: 60, cloudHigh: 80, sunFraction: 0.1, wc: 95, convBase: 700, convDepth: 10000, precip: 2.5, cape: 1500, pSun: 0.05 }, view: toSun },
    { name: '07_averses_percees', time: at('15:00'), weather: { cloudLow: 65, cloudMid: 20, sunFraction: 0.45, wc: 80, convBase: 900, convDepth: 6000, precip: 0.6, cape: 1100, pSun: 0.5 } },
    { name: '08_coucher_eclaircies', time: sunset(-12), weather: { cloudLow: 45, cloudMid: 50, cloudHigh: 20, sunFraction: 0.5, pSun: 0.5, convBase: 1200, convDepth: 900 } },
    { name: '08b_coucher_eclaircies_soleil', time: sunset(-12), weather: { cloudLow: 45, cloudMid: 50, cloudHigh: 20, sunFraction: 0.5, pSun: 0.5, convBase: 1200, convDepth: 900 }, view: toSun },
    { name: '08c_coucher_plus4_soleil', time: sunset(4), weather: { cloudLow: 45, cloudMid: 50, cloudHigh: 20, sunFraction: 0.5, pSun: 0.5, convBase: 1200, convDepth: 900 }, view: toSun },
    { name: '08d_coucher_plus9_soleil', time: sunset(9), weather: { cloudLow: 45, cloudMid: 50, cloudHigh: 20, sunFraction: 0.5, pSun: 0.5, convBase: 1200, convDepth: 900 }, view: toSun },
    { name: '08e_coucher_plus9_dos', time: sunset(9), weather: { cloudLow: 45, cloudMid: 50, cloudHigh: 20, sunFraction: 0.5, pSun: 0.5, convBase: 1200, convDepth: 900 }, view: { towardSun: false } },
    { name: '08f_coucher_plus2_dos', time: sunset(2), weather: { cloudLow: 45, cloudMid: 50, cloudHigh: 20, sunFraction: 0.5, pSun: 0.5, convBase: 1200, convDepth: 900 }, view: { towardSun: false } },
    { name: '09_coucher_altocumulus_soleil', time: sunset(-5), weather: { cloudLow: 10, cloudMid: 70, sunFraction: 0.5, pSun: 0.5 }, view: toSun },
    { name: '09b_altocumulus_plus10_soleil', time: sunset(10), weather: { cloudLow: 10, cloudMid: 70, sunFraction: 0.5, pSun: 0.5 }, view: toSun },
    { name: '09c_altocumulus_plus10_dos', time: sunset(10), weather: { cloudLow: 10, cloudMid: 70, sunFraction: 0.5, pSun: 0.5 }, view: { towardSun: false } },
    { name: '10_apres_coucher_soleil', time: sunset(18), weather: { cloudLow: 45, cloudMid: 50, cloudHigh: 20, sunFraction: 0.5, pSun: 0.5, convBase: 1200, convDepth: 900 }, view: toSun },
    { name: '10b_apres_coucher_dos', time: sunset(18), weather: { cloudLow: 45, cloudMid: 50, cloudHigh: 20, sunFraction: 0.5, pSun: 0.5, convBase: 1200, convDepth: 900 }, view: { towardSun: false } },
    { name: '11_heure_bleue', time: sunset(35), weather: { cloudLow: 30, cloudMid: 40, sunFraction: 0.5 }, view: toSun },
    { name: '12_cirrus_60', time: at('14:00'), weather: { cloudHigh: 60, sunFraction: 0.8 }, view: toSun },
    { name: '13_cirrostratus_100', time: at('14:00'), weather: { cloudHigh: 100, sunFraction: 0.45 }, view: toSun },
    { name: '14_altostratus_100', time: at('14:00'), weather: { cloudMid: 100, sunFraction: 0.1 } },
    { name: '15_lever_cumulus_soleil', time: sunrise(15), weather: { cloudLow: 35, cloudMid: 20, sunFraction: 0.6, pSun: 0.6, convBase: 900, convDepth: 600 }, view: toSun },
    { name: '16_nuit', time: at('22:00'), weather: { cloudLow: 40 } },
    { name: '17_drone_cumulus', time: at('13:00'), weather: { cloudLow: 40, sunFraction: 0.75, convBase: 1300, convDepth: 700, wc: 2, cape: 300 }, view: { camH: 70, Rr: 160 } },
    { name: '18_drone_orage', time: at('16:00'), weather: { cloudLow: 85, cloudMid: 60, cloudHigh: 80, sunFraction: 0.1, wc: 95, convBase: 700, convDepth: 10000, precip: 2.5, cape: 1500, pSun: 0.05 }, view: { camH: 70, Rr: 160, towardSun: true } },
  ],
};
