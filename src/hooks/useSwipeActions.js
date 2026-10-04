import { useEffect } from 'react';

// Swipe-to-reveal des actions sur mobile (cartes To-do et Retouche).
// actionW: largeur du tiroir. scrollRef (optionnel): n'ouvre que si la bande horaire est scrollée au bout.
// syncHalo: inclure le halo blanc dans la transition de fermeture inter-cartes (RetouchingCard oui, ProjectCard non).
// isMobile active le geste; variant (facultatif) le réinstalle quand la carte change de structure (téléphone ou iPad).
// keepLayers: garder les calques préparés pour la puce graphique après le geste (carte large de l'iPad, lourde à
// redessiner: la repréparer au début de chaque glissement le faisait saccader).
export const useSwipeActions = ({ cardRef, contentRef, actionsRef, haloWhiteRef, scrollRef, actionW, isMobile, setActionsOpen, syncHalo, variant = '', keepLayers = false }) => {
  useEffect(() => {
    const card = cardRef.current;
    if (!card || !isMobile) return;
    let startX = 0, startY = 0, locked = false, mode = null, open = false, px = 0, lastMoveX = 0, lastMoveT = 0, velocity = 0;
    const ease = 'transform 0.6s cubic-bezier(0.2, 1.5, 0.4, 1)';

    const setTx = (v) => {
      px = v;
      if (contentRef.current) contentRef.current.style.transform = `translateX(${-v}px)`;
      if (haloWhiteRef.current) haloWhiteRef.current.style.transform = `translateX(${-v}px)`;
      if (actionsRef.current) actionsRef.current.style.transform = `translateX(${actionW - v}px)`;
    };

    let rafId = null;
    let pendingTx = null;
    const rafSetTx = (v) => {
      pendingTx = v;
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          if (pendingTx !== null) setTx(pendingTx);
        });
      }
    };

    let touchInScroll = false;
    const onStart = (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      locked = false;
      mode = null;
      lastMoveX = startX;
      lastMoveT = Date.now();
      velocity = 0;
      touchInScroll = !!(scrollRef && scrollRef.current && scrollRef.current.contains(e.target));
      if (contentRef.current) { contentRef.current.style.transition = 'none'; contentRef.current.style.willChange = 'transform'; }
      if (haloWhiteRef.current) { haloWhiteRef.current.style.transition = 'none'; haloWhiteRef.current.style.willChange = 'transform'; }
      if (actionsRef.current) { actionsRef.current.style.transition = 'none'; actionsRef.current.style.willChange = 'transform'; }
    };

    const onMove = (e) => {
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      const now = Date.now();
      const dt = now - (lastMoveT || now);
      if (dt > 0) velocity = (e.touches[0].clientX - (lastMoveX || e.touches[0].clientX)) / dt;
      lastMoveX = e.touches[0].clientX;
      lastMoveT = now;

      if (!locked) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dy) > Math.abs(dx)) {
          mode = null; locked = true;
          if (open) {
            open = false;
            if (contentRef.current) contentRef.current.style.transition = ease;
            if (haloWhiteRef.current) haloWhiteRef.current.style.transition = ease;
            if (actionsRef.current) actionsRef.current.style.transition = ease;
            setTx(0);
            setTimeout(() => { setActionsOpen(false); }, 600);
          }
          return;
        }
        locked = true;
        if (open) {
          mode = 'close';
        } else if (dx < 0) {
          if (touchInScroll) {
            const sc = scrollRef.current;
            if (sc && sc.scrollLeft + sc.clientWidth >= sc.scrollWidth - 2) {
              mode = 'open';
            }
          } else {
            mode = 'open';
          }
        }
      }

      if (mode === 'close') {
        e.preventDefault();
        e.stopPropagation();
        rafSetTx(Math.max(0, Math.min(actionW, actionW - dx)));
      } else if (mode === 'open') {
        e.preventDefault();
        e.stopPropagation();
        rafSetTx(Math.min(actionW, Math.max(0, Math.abs(dx) - 8)));
      }
    };

    const onEnd = () => {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      if (pendingTx !== null) { setTx(pendingTx); pendingTx = null; }
      if (mode === 'close' || mode === 'open') {
        const v = velocity || 0;
        const snap = mode === 'open'
          ? (px > actionW * 0.3 || v < -0.3)
          : (px > actionW * 0.7 && v > -0.3);
        open = snap;
        if (contentRef.current) contentRef.current.style.transition = ease;
        if (haloWhiteRef.current) haloWhiteRef.current.style.transition = ease;
        if (actionsRef.current) actionsRef.current.style.transition = ease;
        setTx(snap ? actionW : 0);
        setTimeout(() => {
          setActionsOpen(snap);
          if (keepLayers) return;
          if (contentRef.current) contentRef.current.style.willChange = '';
          if (haloWhiteRef.current) haloWhiteRef.current.style.willChange = '';
          if (actionsRef.current) actionsRef.current.style.willChange = '';
        }, 600);
      } else {
        if (contentRef.current) { contentRef.current.style.transition = ease; if (!keepLayers) contentRef.current.style.willChange = ''; }
        if (haloWhiteRef.current) { haloWhiteRef.current.style.transition = ease; if (!keepLayers) haloWhiteRef.current.style.willChange = ''; }
        if (actionsRef.current) { actionsRef.current.style.transition = ease; if (!keepLayers) actionsRef.current.style.willChange = ''; }
      }
      mode = null;
    };

    const syncOpen = () => {
      const newOpen = card.dataset.open === 'true';
      if (open && !newOpen) {
        if (contentRef.current) contentRef.current.style.transition = ease;
        if (syncHalo && haloWhiteRef.current) haloWhiteRef.current.style.transition = ease;
        if (actionsRef.current) actionsRef.current.style.transition = ease;
        setTx(0);
      }
      open = newOpen;
    };
    const attrObs = new MutationObserver(syncOpen);
    attrObs.observe(card, { attributes: true, attributeFilter: ['data-open'] });

    card.addEventListener('touchstart', onStart, { passive: true });
    card.addEventListener('touchmove', onMove, { passive: false });
    card.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      card.removeEventListener('touchstart', onStart);
      card.removeEventListener('touchmove', onMove);
      card.removeEventListener('touchend', onEnd);
      attrObs.disconnect();
    };
  }, [isMobile, variant]);
};
