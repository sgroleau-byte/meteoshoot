
// Défilement fluide (amorti) à la molette. Mécanisme unique réutilisé tel quel par le détail
// projet ET les vues principales (listing, édition, préférences): mêmes réglages (ease 0.18),
// même gestion de la molette. Desktop uniquement (sur mobile on garde l'inertie native).
//   listenEl : élément sur lequel on écoute la molette (un conteneur, ou window).
//   scrollEl : élément dont on anime scrollTop (le conteneur, ou document.scrollingElement).
export const attachSmoothWheel = (listenEl, scrollEl) => {
  if (!listenEl || !scrollEl) return () => {};
  let target = scrollEl.scrollTop;
  let raf = null;
  const ease = 0.18;
  const tick = () => {
    const diff = target - scrollEl.scrollTop;
    if (Math.abs(diff) < 0.5) { scrollEl.scrollTop = target; raf = null; return; }
    scrollEl.scrollTop += diff * ease;
    raf = requestAnimationFrame(tick);
  };
  const onWheel = (e) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // laisse les bandes horizontales
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;                 // lignes -> pixels approx
    else if (e.deltaMode === 2) dy *= scrollEl.clientHeight; // pages
    e.preventDefault();
    const max = scrollEl.scrollHeight - scrollEl.clientHeight;
    if (raf === null) target = scrollEl.scrollTop;   // resync au début d'un nouveau geste
    target = Math.max(0, Math.min(max, target + dy));
    if (raf === null) raf = requestAnimationFrame(tick);
  };
  listenEl.addEventListener('wheel', onWheel, { passive: false });
  return () => { listenEl.removeEventListener('wheel', onWheel); if (raf) cancelAnimationFrame(raf); };
};
