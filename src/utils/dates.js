
export const formatDateShort = (d) => { const date = new Date(d); return `${date.getDate()} ${['JAN','FÉV','MAR','AVR','MAI','JUIN','JUIL','AOÛT','SEP','OCT','NOV','DÉC'][date.getMonth()]} ${date.getFullYear()}`; };
export const daysSince = (d) => Math.floor((new Date() - new Date(d)) / (1000 * 60 * 60 * 24));
export const getDayAbbrev = (d) => ['DIM.','LUN.','MAR.','MER.','JEU.','VEN.','SAM.'][(typeof d === 'string' ? new Date(d + 'T00:00:00') : d).getDay()];
export const getDayMonth = (d) => { const date = typeof d === 'string' ? new Date(d + 'T00:00:00') : d; return `${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2,'0')}`; };
export const isToday = (d) => (typeof d === 'string' ? new Date(d + 'T00:00:00') : d).toDateString() === new Date().toDateString();
export const formatTime = (iso) => { if (!iso) return '--:--'; const d = new Date(iso); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
export const formatDuration = (s) => { if (!s) return '-'; return `${String(Math.floor(s/3600)).padStart(2,'0')}H${String(Math.floor((s%3600)/60)).padStart(2,'0')}`; };
// Format duree relative "3H45" pour la banniere "derniere mise a jour il y a XX".
// Floor sur la minute, pas d'arrondi: on prefere "0H59" plutot que "1H00" si on n'a pas tout a fait passe l'heure.
export const formatTimeSince = (ts, now = Date.now()) => {
  if (!ts) return null;
  const diffMs = Math.max(0, now - ts);
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}H${String(minutes).padStart(2, '0')}`;
};
