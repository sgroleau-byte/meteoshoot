// Après un déploiement, une page restée ouverte peut demander un morceau de code (nom haché) qui n'existe plus sur
// le serveur: le chargement différé échoue (« Failed to fetch dynamically imported module »). On recharge la page une
// seule fois par minute pour prendre la nouvelle version, sans boucler si le problème persiste.
const KEY = 'ms-reload-update';

export function isChunkLoadError(err) {
  const m = String((err && err.message) || err || '');
  return /dynamically imported module|Importing a module script failed|Failed to fetch|Load failed|error loading dynamically imported module/i.test(m);
}

export function reloadForUpdate() {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 60000) return false; // déjà rechargé il y a moins d'une minute: on laisse le message d'erreur
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch (e) { /* stockage indisponible: on recharge quand même */ }
  window.location.reload();
  return true;
}
