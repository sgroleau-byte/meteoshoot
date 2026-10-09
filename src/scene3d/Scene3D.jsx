// Vue 3D dans la fenêtre de la carte (bascule SAT / 3D / MAP). Le moteur (three.js) n'est chargé
// qu'à l'ouverture. Les environs viennent de loadScene (cache partagé, sinon fonction serveur); les
// bâtiments dessinés s'affichent tout de suite, les voisins et le relief (loadTerrain) s'ajoutent quand ils arrivent.
// La légende dit toujours d'où vient ce qu'on regarde: condition de lumière (prévision) et hauteur de la forme
// en face (réglée dans le projet, mesurée Overture, par défaut).
import React, { useEffect, useRef, useState } from 'react';
import { loadScene } from './data.js';
import { loadTerrain } from './terrain.js';
import { isChunkLoadError, reloadForUpdate } from '../shared/updateReload.js';
import { fetchSmokeHour, smokeHourCached } from '../weather/api.js';
import { loadModel, loadPlacement, loadRetired, localState, saveModel, replaceModel, markSent, takePlacement, dropModel, retireModel, clearRetired, savePlacement } from './modelStore.js';
import { cloudLoad, cloudFetchGlb, cloudSave, cloudPlacement, cloudDelete } from './modelCloud.js';
import { loadSatImage } from './satDrape.js';

// Origine du moteur arrondie comme sceneKey (data.js). Un placement gardé porte o: [lat, lng], l'origine du moment:
// si la position du projet a été corrigée depuis, l'écart est rendu en mètres pour que la maison reste au même endroit
// du terrain (sous sa forme). Trop loin (adresse changée): pose par défaut. o et t (heure du déplacement, pour savoir
// quel appareil a le plus récent) ne vont jamais au moteur.
const r5 = (v) => Number(Number(v).toFixed(5));
function toLocal(pl, org) {
  if (!pl) return null;
  const p = { ...pl }, o = p.o; delete p.o; delete p.t;
  if (!Array.isArray(o) || !org) return p;
  const x = (p.x || 0) + (o[1] - org[1]) * 111320 * Math.cos(org[0] * Math.PI / 180), n = (p.n || 0) + (o[0] - org[0]) * 111320;
  return Math.hypot(x, n) > 1000 ? null : { ...p, x, n };
}

// ===== Copie en ligne du modèle importé (modelCloud.js) =====
// La copie locale (modelStore.js) s'affiche tout de suite; la ligne en ligne est consultée ensuite et la copie locale
// mise d'accord. Non connecté ou hors ligne: tout continue en local, avertissement dans la console seulement.
// Ces files vivent hors du composant: un envoi continue si la vue se ferme ou si l'on passe à un autre projet.
const warnCloud = (what) => (err) => console.warn(`[scene3d] ${what}, copie locale seulement:`, (err && err.message) || err);
const sends = new Map(); // projet -> { at, p }: envoi du modèle en cours (un même import n'est envoyé qu'une fois à la fois)
// Dernier modèle retiré par projet, pour la session: réimporter le même fichier (même nom, même taille, par exemple pour
// profiter d'un meilleur classement des vitrages) le remet à sa place réglée à la main, hauteur comprise.
const removed = new Map(); // projet -> { name, srcBytes, pl (avec o, l'origine du moteur) }
function sendModel(pid, rec) {
  const cur = sends.get(pid);
  if (cur && cur.at === rec.at) return cur.p;
  const p = cloudSave(pid, rec.glb, rec.info, rec.placement || null).then(path => markSent(pid, rec.at, path))
    .finally(() => { if (sends.get(pid) && sends.get(pid).p === p) sends.delete(pid); });
  sends.set(pid, { at: rec.at, p });
  return p;
}
// Placement: copie locale tout de suite (keep), envoi regroupé environ 600 ms après le dernier geste. Un modèle pas encore
// en ligne emporte son placement avec lui (envoi en cours: on l'attend, puis on envoie le placement s'il a changé).
const plTimers = new Map();
function queuePlacement(pid) {
  clearTimeout(plTimers.get(pid));
  plTimers.set(pid, setTimeout(async () => {
    plTimers.delete(pid);
    try {
      const s = sends.get(pid); if (s) await s.p.catch(() => {});
      const rec = await loadModel(pid);
      if (rec && !rec.pending && rec.path && rec.placement) await cloudPlacement(pid, rec.placement, rec.path);
    } catch (err) { warnCloud('placement pas envoyé')(err); }
  }, 600));
}
// Une consultation à la fois par projet. Renvoie ce qui a changé ici: { kind: 'model', rec } (rec: le modèle téléchargé,
// seulement si le stockage local l'a refusé), { kind: 'placement' }, ou null. onFetch(true / false) autour d'un téléchargement.
const syncs = new Map();
// Heure du dépôt d'un modèle en ligne, lue dans le nom de son fichier (…/modele3d/<Date.now()>.glb).
const uploadedAt = (path) => { const m = /\/(\d+)\.glb$/.exec(path || ''); return m ? Number(m[1]) : 0; };
function syncModel(pid, onFetch) {
  if (!syncs.has(pid)) syncs.set(pid, doSync(pid, onFetch).finally(() => syncs.delete(pid)));
  return syncs.get(pid);
}
async function doSync(pid, onFetch) {
  const row = await cloudLoad(pid); // lève si non connecté ou hors ligne
  const [rec, gone] = await Promise.all([loadModel(pid), loadRetired(pid)]);
  const st = localState(rec, gone); // les écritures plus bas ne s'appliquent que si rien n'a changé ici entre-temps
  // Import fait ici pas encore envoyé (ou gardé avant la copie en ligne): il l'emporte, sauf si un modèle a été déposé
  // ailleurs après lui (import corrigé sur un autre appareil): celui-là est pris plus bas, l'ancien import est abandonné.
  if (rec && (rec.pending || !rec.path) && !(row && uploadedAt(row.path) > (rec.at || 0))) { await sendModel(pid, rec); return null; }
  // Retrait fait ici pas encore fait en ligne, sauf si un autre modèle a été déposé ailleurs depuis (il est pris plus bas).
  const newerElsewhere = !!row && !!gone && (gone.path ? row.path !== gone.path : uploadedAt(row.path) > (gone.at || 0));
  if (!rec && gone && !newerElsewhere) {
    if (row) await cloudDelete(pid);
    await clearRetired(pid, gone.at);
    return null;
  }
  // Plus de ligne: modèle retiré ailleurs (ou projet sans modèle).
  if (!row) return rec && await dropModel(pid, st) ? { kind: 'model' } : null;
  // Autre modèle en ligne, ou première ouverture sur cet appareil: téléchargement, puis copie locale.
  if (!rec || rec.path !== row.path) {
    onFetch(true);
    let glb;
    try { glb = await cloudFetchGlb(row.path); } finally { onFetch(false); }
    const nrec = { glb, info: row.info, placement: row.placement, path: row.path, pending: false, at: Date.now() };
    const kept = await replaceModel(pid, st, nrec).catch(err => { console.warn('[scene3d] modèle en ligne non gardé sur cet appareil:', err); return null; });
    return kept === false ? null : { kind: 'model', rec: kept ? null : nrec };
  }
  // Même modèle: le placement le plus récent l'emporte (celui d'ici part en ligne s'il est plus récent).
  const tl = (rec.placement && rec.placement.t) || 0, tc = (row.placement && row.placement.t) || 0;
  if (tc > tl) return await takePlacement(pid, st, row.placement) ? { kind: 'placement' } : null;
  if (tl > tc && rec.placement) await cloudPlacement(pid, rec.placement, row.path);
  return null;
}

export const Scene3D = ({ lat, lng, buildings, orientation, timeMs, weatherRow, visible, zoomRef, projectId, sunny, onToggleSunny }) => { // sunny: météo coupée (journée ensoleillée) // zoomRef.current(f) : les boutons + et - de la fenêtre
  const box = useRef(null);
  const eng = useRef(null);
  const [info, setInfo] = useState(null);
  const [status, setStatus] = useState(null); // { text, busy }: busy = anneau d'attente, sinon message seul (erreur)
  const [engReady, setEngReady] = useState(0); // compte des moteurs créés: relance les effets qui en dépendent
  // Modèle d'architecte importé: { info, pl } une fois posé; prep = progression des préparations en cours (0 à 1) par
  // projet: la préparation continue si la vue se ferme ou si l'on passe à un autre projet. dl = projet dont le modèle
  // en ligne se télécharge.
  const [mdl, setMdl] = useState(null);
  // Maison fixée (cadenas): par défaut chaque fois qu'un modèle déjà placé s'affiche (retour à la 3D ou au projet), pour
  // tourner autour sans la déplacer; libre seulement juste après un import ou d'un clic sur le cadenas (Stéphane, 8
  // octobre 2026: « je n'arrête pas de déplacer le modèle 3D de ma maison quand je veux tourner autour »).
  const [locked, setLocked] = useState(true);
  const [prep, setPrep] = useState({});
  const [dl, setDl] = useState(null);
  const [mdlErr, setMdlErr] = useState(null);
  const fileRef = useRef(null);
  // Calque satellite temporaire (Plans d'Apple) pour poser la maison: éteint à chaque ouverture, image gardée par lieu.
  const [satOn, setSatOn] = useState(false);
  const [satBusy, setSatBusy] = useState(false);
  const satCache = useRef({});
  const pidRef = useRef(projectId); pidRef.current = projectId; // la fiche reste montée d'un projet à l'autre
  const org = useRef(null); // origine du moteur actuel, [lat, lng] arrondis
  const mdlFor = useRef(null); // projet du modèle posé dans le moteur actuel: c'est lui qu'on enregistre ou qu'on retire
  const endDrag = useRef(null); // fin du glisser d'une pastille en cours
  // Opérations sur le modèle du moteur, une à la fois et dans l'ordre (lire un GLB prend un moment): la dernière demandée l'emporte.
  const queue = useRef(Promise.resolve());
  const withModel = (fn) => { const p = queue.current.then(fn); queue.current = p.catch(() => {}); return p; };
  const setPrepOf = (pid, p) => setPrep(v => { const w = { ...v }; if (p == null) delete w[pid]; else w[pid] = p; return w; });
  const keep = (pl) => {
    const pid = mdlFor.current; if (!pid || !pl) return;
    savePlacement(pid, { ...pl, o: org.current, t: Date.now() }).then(() => queuePlacement(pid)).catch(err => console.warn('[scene3d] placement non gardé:', err));
  };
  // Pose dans le moteur e le modèle gardé du projet, ou rien s'il n'y en a plus. fallback: modèle téléchargé que le
  // stockage local a refusé (navigation privée, quota).
  const showLocal = (e, pid, isOff, fallback) => withModel(async () => {
    if (isOff() || eng.current !== e) return;
    const rec = (pid ? await loadModel(pid) : undefined) || fallback;
    if (isOff() || eng.current !== e) return;
    if (!rec) { if (e.getModelPlacement()) await e.setModel(null); if (eng.current === e) { mdlFor.current = null; if (!isOff()) setMdl(null); } return; }
    const p0 = toLocal(rec.placement, org.current);
    const pl = await e.setModel(rec.glb, rec.info, p0);
    if (!pl || eng.current !== e) return;
    // Jamais placé (import fini vue fermée ou sur un autre projet, adresse déplacée de plus d'un kilomètre): pose par défaut
    // gardée et maison libre à cette première apparition; fixée aux suivantes.
    mdlFor.current = pid; if (!p0) keep(pl); if (!isOff()) { setMdl({ info: rec.info, pl }); setLocked(p0 != null); }
  });
  const stopDrag = () => { if (endDrag.current) endDrag.current(); };

  useEffect(() => {
    if (!visible || !box.current || !lat || !lng) return;
    let cancelled = false;
    setStatus({ text: 'Chargement', busy: true });
    import('./engine.js').then(m => {
      if (cancelled || !box.current) return;
      const e = m.createScene3D(box.current, { onInfo: setInfo, onModel: (pl) => { setMdl(v => v && { ...v, pl }); keep(pl); } });
      eng.current = e; org.current = [r5(lat), r5(lng)]; mdlFor.current = null; if (zoomRef) zoomRef.current = (f) => e.zoom(f);
      if (import.meta.env.DEV) window.__scene3d = e; // inspection en développement seulement
      e.setProject({ lat, lng, buildings, orientation });
      e.setTime(timeMs); e.setWeather(weatherRow); setEngReady(n => n + 1); // le modèle du projet suit (effet plus bas)
      setStatus({ text: 'Environs en préparation', busy: true });
      // Environs (Overture) et relief (LiDAR) arrivent chacun de leur côté; l'anneau d'attente reste tant qu'il en manque un.
      let pending = 2, failed = false; const done = () => { pending--; if (pending <= 0 && !failed && !cancelled && eng.current === e) setStatus(null); };
      loadScene(lat, lng).then(d => { if (!cancelled && eng.current === e) { e.setData(d); done(); } })
        .catch(err => { console.warn('[scene3d] environs indisponibles:', err); failed = true; if (!cancelled) setStatus({ text: 'Environs indisponibles, bâtiments du projet seulement', busy: false }); });
      loadTerrain(lat, lng).then(t => { if (!cancelled && eng.current === e) { e.setTerrain(t); done(); } })
        .catch(err => { console.warn('[scene3d] relief indisponible, sol plat:', err); done(); });
    }).catch(err => {
      console.error('[scene3d] moteur:', err); if (cancelled) return;
      // Morceau de code introuvable (nouvelle version déployée depuis l'ouverture de la page): on recharge une fois.
      if (isChunkLoadError(err) && reloadForUpdate()) { setStatus({ text: 'Mise à jour de l’application', busy: true }); return; }
      setStatus({ text: isChunkLoadError(err) ? 'Nouvelle version disponible : recharger la page' : 'La 3D ne peut pas s’afficher ici', busy: false });
    });
    // Fermeture: plus de maison dans la vue, et une erreur d'import affichée s'efface (celle qui arrive vue fermée reste
    // pour la réouverture).
    return () => { cancelled = true; stopDrag(); setMdl(null); setLocked(true); setMdlErr(null); setSatOn(false); if (zoomRef) zoomRef.current = null; if (eng.current) { eng.current.dispose(); eng.current = null; mdlFor.current = null; } };
  }, [visible, lat, lng]);
  // Modèle du projet, à chaque moteur créé et à chaque changement de projet (même adresse comprise): celui de l'autre
  // projet est retiré. Copie locale d'abord, puis la copie en ligne: autre modèle (téléchargé et posé), modèle retiré
  // ailleurs (retiré ici aussi) ou placement plus récent (repris).
  useEffect(() => {
    const e = eng.current, pid = projectId; setMdl(null); setLocked(true);
    if (!e) return;
    let off = false; const isOff = () => off;
    showLocal(e, pid, isOff).catch(err => console.warn('[scene3d] modèle importé illisible:', err));
    if (pid) syncModel(pid, (on) => setDl(v => on ? pid : v === pid ? null : v)).then(r => {
      if (!r || off || eng.current !== e) return;
      if (r.kind === 'model') return showLocal(e, pid, isOff, r.rec);
      return withModel(async () => {
        if (off || eng.current !== e || mdlFor.current !== pid) return;
        const p = toLocal(await loadPlacement(pid), org.current);
        if (!p || off || eng.current !== e || mdlFor.current !== pid) return;
        const pl = e.setModelPlacement(p); if (pl) setMdl(v => v && { ...v, pl });
      });
    }).catch(warnCloud('modèle en ligne inaccessible'));
    return () => { off = true; stopDrag(); };
  }, [projectId, engReady]);
  useEffect(() => { setMdlErr(null); }, [projectId]);
  useEffect(() => { if (eng.current) eng.current.setModelLocked(locked); if (locked) stopDrag(); }, [locked, engReady]);
  useEffect(() => { if (eng.current) eng.current.setProject({ lat, lng, buildings, orientation }); }, [buildings, orientation]);
  useEffect(() => { if (eng.current) eng.current.setTime(timeMs); }, [timeMs]);
  useEffect(() => { if (eng.current) eng.current.setWeather(weatherRow); }, [weatherRow?.time, weatherRow?.cloudLow, weatherRow?.cloudMid, weatherRow?.cloudHigh, weatherRow?.sunFraction, weatherRow?.precip, weatherRow?.wc, weatherRow?.convBase, weatherRow?.convDepth, weatherRow?.direct]);
  // Fumée de feux (FireWork) à l'heure affichée, seulement dans la fenêtre de prévision de la 3D (comme la météo) et un
  // jour où l'app en signale déjà (moyenne du jour, icône du soleil): par prudence, la couche horaire seule mêle le fond
  // urbain. Demandée un court instant après l'arrêt du curseur; une heure déjà lue s'affiche tout de suite, une réponse
  // qui tarde efface la fumée de l'heure précédente.
  const smokeHour = weatherRow && weatherRow.smoke > 0 ? new Date(Math.floor(timeMs / 3600000) * 3600000).toISOString().slice(0, 13) + ':00:00Z' : null;
  useEffect(() => {
    if (!eng.current) return;
    if (!smokeHour || !lat || !lng) { eng.current.setSmoke(null); return; }
    let off = false, clr = null; const e = eng.current;
    const known = smokeHourCached(lat, lng, smokeHour); if (known !== undefined) { e.setSmoke(known); return; }
    const id = setTimeout(() => {
      clr = setTimeout(() => { if (!off && eng.current === e) e.setSmoke(null); }, 1000);
      fetchSmokeHour(lat, lng, smokeHour).then(ug => { clearTimeout(clr); if (!off && eng.current === e) e.setSmoke(ug); });
    }, 350);
    return () => { off = true; clearTimeout(id); clearTimeout(clr); };
  }, [smokeHour, lat, lng, engReady]);

  // Import: préparation dans le navigateur (environ 15 s), puis pose calée sur la forme dessinée. Le résultat est gardé
  // pour le projet du début même si la vue a été fermée ou rouverte entre-temps; il n'est posé que si le moteur
  // actuel montre encore ce projet (sinon à la prochaine ouverture, pose par défaut).
  const onFile = async (file) => {
    if (!file) return;
    const pid = projectId, here = () => pidRef.current === pid;
    setMdlErr(null); setPrepOf(pid, 0);
    try {
      if (!/\.kmz$/i.test(file.name)) throw new Error('Fichier .kmz attendu (export Google Earth de SketchUp)');
      const { importKmz } = await import('./modelImport.js');
      const res = await importKmz(file, (p) => setPrepOf(pid, p));
      await withModel(async () => {
        const e = here() ? eng.current : null;
        const prev = removed.get(pid), same = !!prev && prev.name === res.info.name && prev.srcBytes === res.info.srcBytes;
        if (same) removed.delete(pid);
        const p0 = same && e ? toLocal(prev.pl, org.current) : null;
        const pl = e ? await e.setModel(res.glb, res.info, p0) : null;
        const shown = pl && eng.current === e;
        if (shown) { mdlFor.current = pid; if (here()) { setMdl({ info: res.info, pl }); setLocked(p0 != null); } } // modèle neuf: libre, à placer; même fichier remis en place: fixé
        if (import.meta.env.DEV) console.info('[scene3d] vitrages', res.info.glazing);
        setPrepOf(pid, null);
        if (!pid) return;
        // Copie locale en attente d'envoi, puis envoi en ligne (pas attendu: la file du moteur reste libre).
        // Échec du stockage local (navigation privée, quota): la maison reste affichée, avec un avertissement.
        const at = Date.now(), rec = { glb: res.glb, info: res.info, placement: shown ? { ...pl, o: org.current, t: at } : same ? { ...prev.pl, t: at } : null, pending: true, at };
        await saveModel(pid, rec)
          .catch(err => { console.warn('[scene3d] modèle non gardé:', err); if (here()) setMdlErr('Modèle non gardé sur cet appareil (stockage local refusé ou plein)'); });
        sendModel(pid, rec).catch(warnCloud('modèle pas encore en ligne'));
      });
    } catch (err) { console.error('[scene3d] import:', err); if (here()) setMdlErr(err.message || 'Modèle illisible'); }
    finally { setPrepOf(pid, null); }
  };
  const move = (p) => { const e = eng.current; if (!e) return; const pl = e.setModelPlacement(p); if (pl) setMdl(v => v && { ...v, pl }); return pl; };
  // Glisser une petite pastille blanche: horizontalement pour tourner, verticalement pour enfoncer ou ressortir. Seul le
  // doigt (ou la souris) qui a commencé le geste le pilote; un geste annulé par le système le termine aussi.
  const dragPill = (ev, kind) => {
    ev.preventDefault(); ev.stopPropagation(); stopDrag();
    const id = ev.pointerId, x0 = ev.clientX, y0 = ev.clientY, pl0 = mdl.pl; let last = pl0;
    const mv = (e2) => {
      if (e2.pointerId !== id) return;
      if (kind === 'rot') { let r = pl0.rot + (e2.clientX - x0) * 0.5; if (e2.shiftKey) r = Math.round(r / 15) * 15; last = move({ rot: ((Math.round(r * 2) / 2) % 360 + 360) % 360 }) || last; }
      else { let d = pl0.dy + (y0 - e2.clientY) * 0.02; d = Math.round(d * 20) / 20; last = move({ dy: Math.abs(d) < 0.025 ? 0 : d }) || last; }
    };
    const up = (e2) => {
      if (e2 && e2.pointerId !== id) return;
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      endDrag.current = null; if (last !== pl0) keep(last);
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    endDrag.current = () => up(); // appelé aussi à la fermeture de la vue, au changement de projet et au démontage
  };
  // Retrait: copie locale effacée (une marque reste tant que le serveur n'a pas effacé la sienne), puis copie en ligne.
  const removeModel = () => withModel(async () => {
    const e = eng.current, pid = mdlFor.current, cur = e && e.getModelPlacement();
    if (pid && cur && mdl) removed.set(pid, { name: mdl.info.name, srcBytes: mdl.info.srcBytes, pl: { ...cur, o: org.current } });
    mdlFor.current = null; setMdl(null);
    if (e) await e.setModel(null);
    if (!pid) return;
    const at = await retireModel(pid).catch(err => { console.warn('[scene3d] modèle non effacé:', err); return null; });
    cloudDelete(pid).then(() => at && clearRetired(pid, at)).catch(err => console.warn('[scene3d] modèle pas encore retiré en ligne (repris à la prochaine ouverture):', (err && err.message) || err));
  });

  const toggleSat = async () => {
    const e = eng.current; if (!e || satBusy) return;
    if (satOn) { e.setSatellite(null); setSatOn(false); return; }
    const key = `${r5(lat)},${r5(lng)}`;
    setSatBusy(true); setMdlErr(null);
    try {
      if (!satCache.current[key]) satCache.current[key] = loadSatImage(r5(lat), r5(lng));
      const s = await satCache.current[key];
      if (eng.current === e) { e.setSatellite(s); setSatOn(true); }
    } catch (err) { delete satCache.current[key]; setMdlErr(`Image satellite indisponible (${err.message || err})`); }
    finally { setSatBusy(false); }
  };

  if (!visible) return null;
  const color = info?.light === false ? '#23282b' : '#f4f4f2';
  const fmtDy = (d) => Math.abs(d) < 0.025 ? 'AU SOL' : `${d > 0 ? '+' : '-'}${Math.abs(d).toFixed(1).replace('.', ',')} M`;
  const prepP = prep[projectId]; // préparation en cours pour ce projet
  const whitePill = { background: '#fff', borderRadius: '13px', padding: '4px 8px 1px 8px', userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none' };
  const bebas = { fontSize: '17px', letterSpacing: '0.04em', lineHeight: '1' };
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 6, background: '#202427', overflow: 'hidden' }}>
      <div ref={box} style={{ position: 'absolute', inset: 0 }}/>
      {/* Modèle d'architecte (.kmz de SketchUp): import, puis placement. La maison se glisse dans la vue pour la déplacer
          tant que le cadenas est ouvert (fixée à chaque retour).
          En haut à gauche sous la boussole (left 14, top 104, 34 de haut), loin de la colonne des formes et de SAT / 3D. */}
      <input ref={fileRef} type="file" accept=".kmz" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; onFile(f); }}/>
      <div style={{ position: 'absolute', top: '148px', left: '14px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(232,228,220,0.25)', borderRadius: '16px', padding: '2px 3px 2px 6px', whiteSpace: 'nowrap', boxShadow: '0 2px 12px rgba(0,0,0,0.4)' }}>
          {prepP != null ? <>
            <svg width="18" height="18" viewBox="0 0 30 30" style={{ animation: 'scene3dSpin 1.1s linear infinite', position: 'relative', top: '1px' }}><circle cx="15" cy="15" r="12" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="3"/><circle cx="15" cy="15" r="12" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeDasharray="22 53.4"/></svg>
            <span className="font-bebas-bold" style={{ ...bebas, color: '#fff', padding: '3px 6px 0 0' }}>PRÉPARATION {Math.round(prepP * 100)} %</span>
          </> : !mdl && dl === projectId ? <>
            <svg width="18" height="18" viewBox="0 0 30 30" style={{ animation: 'scene3dSpin 1.1s linear infinite', position: 'relative', top: '1px' }}><circle cx="15" cy="15" r="12" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="3"/><circle cx="15" cy="15" r="12" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeDasharray="22 53.4"/></svg>
            <span className="font-bebas-bold" style={{ ...bebas, color: '#fff', padding: '3px 6px 0 0' }}>CHARGEMENT</span>
          </> : !mdl ? (
            <div onClick={() => fileRef.current && fileRef.current.click()} title="Importer le modèle de l’architecte (.kmz exporté de SketchUp)" style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer', padding: '2px 6px 2px 0' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'relative', top: '1px' }}><path d="M5 12h14"/><path d="M12 5v14"/></svg>
              <span className="font-bebas-bold" style={{ ...bebas, color: '#fff', padding: '3px 0 0 0' }}>MODÈLE 3D</span>
            </div>
          ) : <>
            <span className="font-bebas-bold" title={`${mdl.info.name}: ${Math.round(mdl.info.tris).toLocaleString('fr-CA')} triangles, ${Math.round(mdl.info.bytes / 1024)} Ko`} style={{ ...bebas, color: '#fff', padding: '3px 2px 0 2px' }}>MAISON</span>
            {/* Cadenas (tracés Lucide lock et lock-open): fermé, la maison est fixée et seuls MAISON et le cadenas restent. */}
            <button onClick={() => setLocked(v => !v)} title={locked ? 'Maison fixée : cliquer pour la déplacer ou la tourner' : 'Fixer la maison en place'} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: locked ? '2px 6px 2px 2px' : '2px', display: 'flex', alignItems: 'center' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'relative', top: '1px' }}><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d={locked ? 'M7 11V7a5 5 0 0 1 10 0v4' : 'M7 11V7a5 5 0 0 1 9.9-1'}/></svg>
            </button>
            {!locked && <>
              <div onPointerDown={(e) => dragPill(e, 'rot')} title="Glisser à gauche ou à droite pour tourner (Maj: par 15°)" style={{ ...whitePill, cursor: 'ew-resize' }}>
                <span className="font-bebas-bold" style={{ ...bebas, color: '#000' }}>{Math.round(mdl.pl.rot)}°</span>
              </div>
              <div onPointerDown={(e) => dragPill(e, 'dy')} title="Glisser vers le haut pour ressortir, vers le bas pour enfoncer" style={{ ...whitePill, cursor: 'ns-resize' }}>
                <span className="font-bebas-bold" style={{ ...bebas, color: '#000' }}>{fmtDy(mdl.pl.dy)}</span>
              </div>
              {Math.abs(mdl.pl.dy) >= 0.025 && <button onClick={() => { const pl = move({ dy: 0 }); keep(pl); }} title="Recoller au sol" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'relative', top: '1px' }}><path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/></svg>
              </button>}
              <button onClick={removeModel} title="Retirer le modèle" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px 2px 0', display: 'flex', alignItems: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.5" strokeLinecap="round" style={{ position: 'relative', top: '1px' }}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </>}
          </>}
        </div>
        <div onClick={toggleSat} title={satOn ? 'Retirer l’image satellite du sol' : 'Poser l’image satellite de Plans sur le sol (repère pour placer la maison)'} style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: satBusy ? 'wait' : 'pointer', borderRadius: '16px', padding: '4px 10px 3px 8px', whiteSpace: 'nowrap', boxShadow: '0 2px 12px rgba(0,0,0,0.4)', background: satOn ? '#fff' : 'rgba(232,228,220,0.25)', userSelect: 'none', WebkitUserSelect: 'none' }}>
          {satBusy ? <svg width="14" height="14" viewBox="0 0 30 30" style={{ animation: 'scene3dSpin 1.1s linear infinite', position: 'relative', top: '1px' }}><circle cx="15" cy="15" r="12" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="3"/><circle cx="15" cy="15" r="12" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeDasharray="22 53.4"/></svg>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={satOn ? '#000' : '#fff'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'relative', top: '1px' }}><path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/></svg>}
          <span className="font-bebas-bold" style={{ fontSize: '15px', letterSpacing: '0.04em', lineHeight: '1', color: satOn ? '#000' : '#fff', paddingTop: '2px' }}>SOL SAT</span>
        </div>
        {/* Météo de la 3D: MÉTÉO (prévision de l'heure) ou SOLEIL (journée ensoleillée, pour lire les ombres); tracé Lucide sun. */}
        {onToggleSunny && <div onClick={onToggleSunny} title={sunny ? 'Journée ensoleillée : cliquer pour remettre la météo prévue' : 'Couper la météo : journée ensoleillée pour voir les ombres'} style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer', borderRadius: '16px', padding: '4px 10px 3px 8px', whiteSpace: 'nowrap', boxShadow: '0 2px 12px rgba(0,0,0,0.4)', background: sunny ? '#fff' : 'rgba(232,228,220,0.25)', userSelect: 'none', WebkitUserSelect: 'none' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={sunny ? '#000' : '#fff'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'relative', top: '1px' }}><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
          <span className="font-bebas-bold" style={{ fontSize: '15px', letterSpacing: '0.04em', lineHeight: '1', color: sunny ? '#000' : '#fff', paddingTop: '2px' }}>{sunny ? 'SOLEIL' : 'MÉTÉO'}</span>
        </div>}
        {mdl && prepP == null && !locked && <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.75)', textShadow: '0 1px 2px rgba(0,0,0,0.5)', paddingLeft: '6px', pointerEvents: 'none' }}>Glisser la maison pour la déplacer, cadenas pour la fixer</div>}
        {mdlErr && <div style={{ fontSize: '11px', color: '#ffb4a8', textShadow: '0 1px 2px rgba(0,0,0,0.5)', paddingLeft: '6px', maxWidth: '240px' }}>{mdlErr}</div>}
      </div>
      {info && <div style={{ position: 'absolute', left: '14px', bottom: '12px', fontSize: '12px', lineHeight: '1.45', color, pointerEvents: 'none', textShadow: info.light ? '0 1px 2px rgba(0,0,0,0.35)' : 'none' }}>
        <div>{info.cond}</div>
        {info.parts && <div style={{ opacity: 0.8 }}>{info.parts}</div>}
        <div style={{ opacity: 0.75 }}>{info.where}</div>
        {info.height && <div style={{ opacity: 0.75 }}>{info.height}</div>}
        {info.srcLine && <div style={{ opacity: 0.6, fontSize: '11px' }}>{info.srcLine}</div>}
      </div>}
      {info && <svg style={{ position: 'absolute', left: '14px', top: '104px', width: '34px', height: '34px', pointerEvents: 'none' }} viewBox="0 0 34 34">{/* boussole: en haut à gauche, sous la bande horaire, loin des boutons + et - et de la légende */}
        <circle cx="17" cy="17" r="15" fill="rgba(20,24,26,.35)" stroke="rgba(255,255,255,.55)" strokeWidth="1"/>
        <g transform={`rotate(${(-info.northDeg).toFixed(1)} 17 17)`}>
          <path d="M17 7 L19.6 17 L17 15.8 L14.4 17 Z" fill="#fff"/><path d="M17 27 L19.6 17 L17 18.2 L14.4 17 Z" fill="rgba(255,255,255,.3)"/>
          <text x="17" y="4.2" textAnchor="middle" fontSize="7" fontFamily="Avenir Next, Avenir, sans-serif" fontWeight="600" fill="#fff" transform={`rotate(${info.northDeg.toFixed(1)} 17 2)`}>N</text>
        </g>
      </svg>}
      {status && <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', pointerEvents: 'none', animation: 'msFade 0.4s ease both' }}>
        {status.busy && <svg width="34" height="34" viewBox="0 0 30 30" style={{ animation: 'scene3dSpin 1.1s linear infinite', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))' }}>
          <circle cx="15" cy="15" r="12" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5"/>
          <circle cx="15" cy="15" r="12" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="22 53.4"/>
        </svg>}
        <div className="font-bebas-book" style={{ fontSize: '13px', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.8)', textShadow: '0 1px 2px rgba(0,0,0,0.35)' }}>{status.text.toUpperCase()}</div>
      </div>}
    </div>
  );
};
