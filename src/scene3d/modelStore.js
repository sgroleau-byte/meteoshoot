// Modèle 3D importé d'un projet (GLB allégé, informations et placement), copie locale dans le navigateur (IndexedDB):
// affichage immédiat et hors ligne. La copie de référence est en ligne (modelCloud.js); l'enregistrement local garde
// le chemin du fichier en ligne (path) et pending tant que l'envoi n'a pas réussi. at (heure de l'import ou du
// téléchargement) identifie l'enregistrement: les écritures venues du réseau ne s'appliquent que s'il n'a pas changé.
// Le placement a sa propre clé (projet + « :placement »): le déplacer n'écrit que quelques octets, sans relire ni
// réécrire le fichier du modèle. Un ancien enregistrement avec le placement dedans reste lisible.
// Retrait fait sur cet appareil: une marque (projet + « :retrait », { path, at }) reste jusqu'à ce que le serveur ait
// effacé sa copie, sinon le modèle reviendrait au prochain chargement.
const DB = 'meteoshoot-modeles', STORE = 'modeles';
const plKey = (projectId) => `${projectId}:placement`;
const rmKey = (projectId) => `${projectId}:retrait`;

function open() {
  return new Promise((ok, ko) => {
    const rq = indexedDB.open(DB, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
    rq.onsuccess = () => ok(rq.result);
    rq.onerror = () => ko(rq.error);
  });
}

// fn(store) lance les requêtes et renvoie une fonction qui lit le résultat une fois la transaction terminée.
// Une transaction annulée (quota dépassé, stockage refusé) n'émet que abort: elle rejette aussi la promesse.
async function run(mode, fn) {
  const db = await open();
  try {
    return await new Promise((ok, ko) => {
      const tx = db.transaction(STORE, mode), read = fn(tx.objectStore(STORE));
      tx.oncomplete = () => ok(read ? read() : undefined);
      tx.onerror = () => ko(tx.error || new Error('écriture refusée'));
      tx.onabort = () => ko(tx.error || new Error('transaction annulée'));
    });
  } finally { db.close(); }
}

// État local d'un projet en une courte chaîne: modèle (et son at), retrait en attente, ou rien.
const token = (m, r) => m ? `m${m.at || 0}` : r ? `r${r.at || 0}` : '-';
export const localState = (rec, gone) => token(rec, gone);
// fn(enregistrement, placement) dans la même transaction, seulement si l'état local est toujours expect; renvoie
// (une fois la transaction terminée) true si fn a écrit (fn peut renoncer en renvoyant false).
function ifSame(s, projectId, expect, fn) {
  let ok = false;
  const m = s.get(projectId), p = s.get(plKey(projectId)), r = s.get(rmKey(projectId));
  r.onsuccess = () => { if (token(m.result, r.result) === expect) ok = fn(m.result, p.result) !== false; };
  return () => ok;
}
const putModel = (s, projectId, { glb, info, placement, path, pending, at }) => {
  s.put({ glb, info, path: path || null, pending: !!pending, at: at || Date.now() }, projectId);
  if (placement) s.put(placement, plKey(projectId)); else s.delete(plKey(projectId));
  s.delete(rmKey(projectId));
};

// { glb: ArrayBuffer, info, placement, path, pending, at } ou undefined
export const loadModel = (projectId) => projectId ? run('readonly', s => {
  const m = s.get(projectId), p = s.get(plKey(projectId));
  return () => m.result && { glb: m.result.glb, info: m.result.info, placement: p.result || m.result.placement || null, path: m.result.path || null, pending: !!m.result.pending, at: m.result.at || 0 };
}).catch(() => undefined) : Promise.resolve(undefined);
// Placement seul (sans lire le fichier), null s'il n'y a plus de modèle.
export const loadPlacement = (projectId) => run('readonly', s => {
  const c = s.count(projectId), p = s.get(plKey(projectId));
  return () => (c.result > 0 && p.result) || null;
}).catch(() => null);
// Marque de retrait { path, at } ou undefined
export const loadRetired = (projectId) => projectId ? run('readonly', s => {
  const r = s.get(rmKey(projectId));
  return () => r.result || undefined;
}).catch(() => undefined) : Promise.resolve(undefined);

// Nouveau modèle (import): son placement remplace celui du précédent (effacé s'il n'y en a pas encore). pending par
// défaut tant qu'il n'a pas de chemin en ligne.
export const saveModel = (projectId, rec) => run('readwrite', s => { putModel(s, projectId, { ...rec, pending: rec.pending ?? !rec.path }); });
// Modèle téléchargé, seulement si l'état local n'a pas changé depuis la décision (expect: localState).
export const replaceModel = (projectId, expect, rec) => run('readwrite', s => ifSame(s, projectId, expect, () => putModel(s, projectId, rec)));
// Envoi réussi: chemin en ligne gardé, plus en attente (si c'est toujours ce modèle-là).
export const markSent = (projectId, at, path) => run('readwrite', s => ifSame(s, projectId, `m${at || 0}`, (m) => { s.put({ ...m, path, pending: false }, projectId); }));
// Placement venu d'ailleurs, seulement s'il est plus récent que celui d'ici (t: heure du déplacement).
export const takePlacement = (projectId, expect, placement) => run('readwrite', s => ifSame(s, projectId, expect, (m, p) => {
  if (((p || (m && m.placement) || {}).t || 0) >= (placement.t || 0)) return false;
  s.put(placement, plKey(projectId));
}));
// Modèle retiré ailleurs: copie locale effacée (sans marque), si elle n'a pas changé depuis la décision.
export const dropModel = (projectId, expect) => run('readwrite', s => ifSame(s, projectId, expect, () => { s.delete(projectId); s.delete(plKey(projectId)); }));
// Retrait fait ici: modèle et placement effacés, marque posée (avec le chemin en ligne s'il était connu). Renvoie son at.
export const retireModel = (projectId) => run('readwrite', s => {
  const at = Date.now(), m = s.get(projectId);
  m.onsuccess = () => { s.put({ path: (m.result && m.result.path) || null, at }, rmKey(projectId)); };
  s.delete(projectId); s.delete(plKey(projectId));
  return () => at;
});
// Copie en ligne effacée: la marque de ce retrait-là n'a plus d'utilité.
export const clearRetired = (projectId, at) => run('readwrite', s => {
  const r = s.get(rmKey(projectId));
  r.onsuccess = () => { if (r.result && r.result.at === at) s.delete(rmKey(projectId)); };
});
// Tout effacer (projet supprimé).
export const deleteModel = (projectId) => run('readwrite', s => { s.delete(projectId); s.delete(plKey(projectId)); s.delete(rmKey(projectId)); });
// Seulement si le projet a encore un modèle (compte des clés, sans lire le fichier): un déplacement qui arrive
// après le retrait ne laisse pas de placement orphelin.
export const savePlacement = (projectId, placement) => run('readwrite', s => {
  const c = s.count(projectId);
  c.onsuccess = () => { if (c.result > 0) s.put(placement, plKey(projectId)); };
});
