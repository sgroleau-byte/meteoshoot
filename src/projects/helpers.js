
// ===== UTILS =====
export const generateId = () => `p_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
export const toggleMandate = (current, m) => {
  if (current?.includes(m)) return current.filter(x => x !== m);
  let next = [...(current || []), m];
  // DRONE et DRONE+C sont mutuellement exclusifs
  if (m === 'DRONE') next = next.filter(x => x !== 'DRONE+C');
  if (m === 'DRONE+C') next = next.filter(x => x !== 'DRONE');
  return next;
};
// Liste Édition (option 2a) : réglages d'affichage conservés localement (sp-prefs), avec défauts.
export const EDIT_LIST_DEFAULTS = { editAlertDays: 30, editWarnDays: 15, editShowGauge: true, editShowThreshold: true, editSortUrgency: true };
export const EDIT_GAUGE_MAX_DAYS = 60; // échelle de la jauge, en jours
export const getEditListPrefs = (prefs) => { const out = { ...EDIT_LIST_DEFAULTS }; Object.keys(EDIT_LIST_DEFAULTS).forEach(k => { if (prefs && prefs[k] !== undefined && prefs[k] !== null) out[k] = prefs[k]; }); return out; };
// Statut d'un projet en retouche selon ses jours : alerte (rouge), attention (ambre), normal.
export const editStatusFor = (days, ep) => days === null ? 'normal' : days >= ep.editAlertDays ? 'alert' : days >= ep.editWarnDays ? 'warn' : 'normal';
// Archives : durée réelle de la retouche, figée à l'archivage (de la date d'édition à la date d'archivage).
export const editDaysFrozen = (p) => { if (!p.shotAt) return null; const end = p.completedAt ? new Date(p.completedAt) : new Date(); const d = Math.floor((end - new Date(p.shotAt)) / (1000 * 60 * 60 * 24)); return Number.isFinite(d) ? Math.max(0, d) : null; };
