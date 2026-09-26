
// Marge pour être SUR PLACE avant le lever ou le coucher du soleil (repérage, installation, marche d'approche).
// Le départ vise donc une arrivée sur place à (lever ou coucher - cette marge), pas pile à l'heure du soleil.
export const ON_SITE_LEAD_MIN = 60;
// Heure de départ = lever (AM) ou coucher (PM) - trajet - marge sur place. Ainsi: départ -> trajet -> on arrive
// ON_SITE_LEAD_MIN minutes avant le lever ou le coucher. (Remplace l'ancienne heure de réveil.)
export const calcDeparture = (sunEvent, travel) => { if (!sunEvent || !travel) return null; return new Date(new Date(sunEvent).getTime() - ON_SITE_LEAD_MIN*60*1000 - travel*1000).toISOString(); };
