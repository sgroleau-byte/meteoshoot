
// Marge pour être SUR PLACE avant le lever ou le coucher du soleil (repérage, installation, marche d'approche).
// Le départ vise donc une arrivée sur place à (lever ou coucher - cette marge), pas pile à l'heure du soleil.
export const ON_SITE_LEAD_MIN = 60;
// Heure de départ = lever (AM) ou coucher (PM) - trajet - marge sur place. Ainsi: départ -> trajet -> on arrive
// ON_SITE_LEAD_MIN minutes avant le lever ou le coucher. (Remplace l'ancienne heure de réveil.)
// Heure de shooting entrée dans la fiche (« HH:MM », début sur place, par exemple un intérieur avant l'extérieur):
// départ = cette heure - trajet, sans marge (Stéphane, 4 octobre 2026). refDate fixe le jour (aujourd'hui par défaut).
export const calcDepartureFromShootTime = (shootTime, travel, refDate = new Date()) => {
  if (!shootTime || !travel) return null;
  const [h, m] = String(shootTime).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const d = new Date(refDate); d.setHours(h, m, 0, 0);
  return new Date(d.getTime() - travel * 1000).toISOString();
};
export const calcDeparture = (sunEvent, travel) => { if (!sunEvent || !travel) return null; return new Date(new Date(sunEvent).getTime() - ON_SITE_LEAD_MIN*60*1000 - travel*1000).toISOString(); };
