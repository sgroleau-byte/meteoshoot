import React, { useEffect, useRef, useState } from 'react';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { isNative } from '../native/platform.js';
import { toggleShootOfDay } from '../native/shootOfDay.js';
import { endShootActivity } from '../native/liveActivity.js';
import ReactDOM from 'react-dom';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useLang } from '../i18n/LangProvider.jsx';
import { ProjectStatus } from '../projects/constants.js';
import { useStore } from '../projects/StoreProvider.jsx';
import { useSubscription } from '../subscription/SubscriptionProvider.jsx';
import { UpgradeModal } from '../subscription/UpgradeModal.jsx';
import { formatTimeSince } from '../utils/dates.js';
import { useWeatherStatus } from '../weather/WeatherStatusProvider.jsx';
import { GeoWeatherCard } from './GeoWeatherCard.jsx';
import { ProjectCard } from './ProjectCard.jsx';
import { weatherRowDismiss } from './WeatherRow.jsx';

// En-tête de dossier (accordéon). Contrôlé: l'état ouvert/fermé vient du parent (folderStates).
// Gauche: "{count} / {NOM}" (nombre + séparateur gris, nom blanc condensé majuscule).
// Droite: contrôle replier/déplier (+ fermé, − ouvert).
export const FolderAccordion = ({ name, count, isOpen, onToggle, children }) => {
  const isMobile = useIsMobile();
  return (
    <div data-folder={name} style={{ marginBottom: '4px', background: 'linear-gradient(to right, rgba(139, 155, 153, 0.2) 0, rgba(139, 155, 153, 0) 200px)' }}>
      <div className="folder-acc-header" onClick={onToggle}
        style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', padding: isMobile ? '10px 24px 5px' : '9px 16px 4px', borderBottom: '1px solid rgba(255,255,255,0.07)', WebkitUserSelect: 'none', userSelect: 'none' }}>
        <span className="font-bebas-light" style={{ fontSize: '15px', color: 'rgba(255,255,255,0.32)', letterSpacing: '0.08em', position: 'relative', top: '1px' }}>{count}</span>
        <span className="font-bebas-light" style={{ fontSize: '15px', color: 'rgba(255,255,255,0.16)', letterSpacing: '0.08em', margin: '0 11px', position: 'relative', top: '1px' }}>/</span>
        <span className="font-bebas-book" style={{ fontSize: '22px', color: '#ffffff', letterSpacing: '0.06em' }}>{name}</span>
        <span style={{ flex: 1 }}/>
        <span aria-hidden="true" style={{ width: '22px', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: '22px', fontWeight: 200, lineHeight: 1, position: 'relative', top: '-1px' }}>{isOpen ? '−' : '+'}</span>
      </div>
      {isOpen && <div style={{ paddingTop: '16px' }}>{children}</div>}
    </div>
  );
};

// ===== Glisser-déposer structuré de la liste TODO =====
// Un seul système (souris + tactile, via Pointer Events) pour:
//  - réordonner une carte à l'intérieur de son dossier (entre les cartes du dossier),
//  - réordonner un dossier entier parmi les blocs de premier niveau (en saisissant son en-tête),
//  - réordonner une carte sans dossier parmi les blocs de premier niveau,
//  - classer une carte sans dossier DANS un dossier (la déposer sur le bloc du dossier),
//  - SORTIR une carte de son dossier (la tirer au-dessus de l'en-tête ou sous la dernière
//    carte): elle redevient une carte sans dossier, posée au premier niveau à l'endroit visé.
// Tactile: appui long (380 ms) pour armer; tout mouvement avant l'armement laisse le scroll/swipe.
// Relâcher sans bouger après l'armement (sur une carte) appelle onCardHold: le shooting du jour.
// Souris: on arme dès 5 px. Visuel sobre: le bloc tiré est atténué + une fine ligne rouge marque la cible.
export const useFolderDnD = ({ listRef, groupedItems, applyTodoOrder, moveToFolder, setFolderState, onCardHold }) => {
  const [dropLine, setDropLine] = useState(null);
  const st = useRef(null);

  // iOS ne laisse bloquer le défilement que si un écouteur touchmove non passif existait dès le début du toucher:
  // une fois la carte saisie (appui long), il annule le défilement. Sur téléphone, l'écouteur du tiroir de chaque
  // carte jouait ce rôle par hasard; sur iPad (interface large, sans tiroir avant v633.130), la page défilait.
  const hasList = groupedItems.length > 0;
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const block = (e) => { if (st.current) e.preventDefault(); };
    list.addEventListener('touchmove', block, { passive: false });
    return () => list.removeEventListener('touchmove', block);
  }, [hasList]);

  const flattenIds = (items) => {
    const ids = [];
    items.forEach(it => { if (it.type === 'project') ids.push(it.project.id); else it.projects.forEach(p => ids.push(p.id)); });
    return ids;
  };
  const cloneItems = (items) => items.map(it => it.type === 'folder' ? { ...it, projects: [...it.projects] } : it);

  const onListPointerDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest('button, a, input, textarea, select, .hour-scroll, #folder-menu-portal')) return;
    const list = listRef.current; if (!list) return;
    const cardEl = e.target.closest('[data-drag-card]');
    const headerEl = e.target.closest('.folder-acc-header');
    let folderName = '', scope, blockEl, dragType;
    if (headerEl && !cardEl) {
      const wrap = headerEl.closest('[data-folder]'); if (!wrap) return;
      folderName = wrap.dataset.folder; scope = 'top'; blockEl = wrap; dragType = 'folder';
    } else if (cardEl) {
      folderName = cardEl.dataset.cardFolder || '';
      scope = folderName ? 'folder' : 'top'; blockEl = cardEl;
      dragType = folderName ? 'folder-card' : 'standalone-card';
    } else return;
    if (!blockEl) return;

    // Doigt ou Apple Pencil: appui long avant de saisir (le stylet suivait la branche souris et saisissait la carte au
    // lieu de faire défiler). Souris et stylet d'ordinateur (Wacom, écran avec survol) saisissent dès 5 px.
    const isTouch = e.pointerType === 'touch' || (e.pointerType === 'pen' && window.matchMedia('(hover: none)').matches);
    const startX = e.clientX, startY = e.clientY;
    let armed = false, moved = false, timer = null;
    // Empêche la sélection de texte native (surlignage bleu) pendant tout le geste de glisser.
    const preventSelect = (ev) => ev.preventDefault();

    const blocksForScope = () => {
      if (scope === 'folder') {
        const wrap = blockEl.closest('[data-folder]');
        return wrap ? Array.from(wrap.querySelectorAll('[data-drag-card]')) : [];
      }
      return Array.from(list.children).filter(ch => ch.matches('[data-folder]') || (ch.matches('[data-drag-card]') && !ch.dataset.cardFolder));
    };
    const computeTarget = (y, blocks) => {
      let idx = blocks.length;
      for (let i = 0; i < blocks.length; i++) { const r = blocks[i].getBoundingClientRect(); if (y < r.top + r.height / 2) { idx = i; break; } }
      return idx;
    };
    const lineY = (blocks, idx) => {
      if (!blocks.length) return null;
      if (idx <= 0) return blocks[0].getBoundingClientRect().top - 5;
      if (idx >= blocks.length) return blocks[blocks.length - 1].getBoundingClientRect().bottom + 5;
      return (blocks[idx - 1].getBoundingClientRect().bottom + blocks[idx].getBoundingClientRect().top) / 2;
    };
    const clearHighlight = () => {
      if (st.current && st.current.highlightEl) {
        st.current.highlightEl.style.boxShadow = '';
        st.current.highlightEl.style.borderRadius = '';
        st.current.highlightEl = null;
      }
    };
    const update = (y) => {
      if (!st.current) return;
      // Carte sans dossier survolant un dossier => mode "déposer dans le dossier" (assignation).
      if (st.current.dragType === 'standalone-card') {
        const over = Array.from(list.querySelectorAll('[data-folder]')).find(w => {
          const r = w.getBoundingClientRect(); return y >= r.top && y <= r.bottom;
        });
        if (over) {
          if (st.current.highlightEl && st.current.highlightEl !== over) clearHighlight();
          st.current.highlightEl = over;
          over.style.boxShadow = 'inset 0 0 0 2px rgba(255,255,255,0.6)';
          over.style.borderRadius = '2px';
          const cards = Array.from(over.querySelectorAll('[data-drag-card]'));
          let ins = cards.length;
          for (let i = 0; i < cards.length; i++) { const r = cards[i].getBoundingClientRect(); if (y < r.top + r.height / 2) { ins = i; break; } }
          st.current.drop = { mode: 'folder', folderName: over.dataset.folder, insertIndex: ins, closed: cards.length === 0 };
          setDropLine(null);
          return;
        }
        clearHighlight();
      }
      // Carte de dossier tirée HORS de son dossier (au-dessus de l'en-tête ou sous la dernière
      // carte) => mode extraction: cible parmi les blocs de premier niveau, ligne rouge au top.
      // Tant que le pointeur reste dans le dossier, on retombe sur le réordonnancement interne.
      if (st.current.dragType === 'folder-card' && st.current.folderWrap) {
        const wr = st.current.folderWrap.getBoundingClientRect();
        if (y < wr.top || y > wr.bottom) {
          clearHighlight();
          const tb = st.current.topBlocks || [];
          const idx = computeTarget(y, tb);
          st.current.drop = { mode: 'extract', topIndex: idx };
          const ly = lineY(tb, idx);
          const lr = list.getBoundingClientRect();
          if (ly != null) setDropLine({ top: ly, left: lr.left, width: lr.width });
          return;
        }
      }
      const blocks = st.current.blocks;
      st.current.targetIndex = computeTarget(y, blocks);
      st.current.drop = { mode: st.current.scope === 'folder' ? 'within' : 'top', targetIndex: st.current.targetIndex };
      const ly = lineY(blocks, st.current.targetIndex);
      const lr = list.getBoundingClientRect();
      if (ly != null) setDropLine({ top: ly, left: lr.left, width: lr.width });
    };
    const cleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      document.removeEventListener('selectstart', preventSelect);
      if (timer) { clearTimeout(timer); timer = null; }
    };
    const teardown = () => {
      clearHighlight();
      if (st.current && st.current.blockEl) st.current.blockEl.style.opacity = '';
      if (listRef.current) listRef.current.style.touchAction = '';
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.__isDragging = false;
      setDropLine(null);
      st.current = null;
    };
    const arm = () => {
      const blocks = blocksForScope();
      const draggedIndex = blocks.indexOf(blockEl);
      if (draggedIndex === -1) return;
      armed = true;
      // Pour une carte de dossier: on mémorise son dossier d'origine et la liste des blocs de
      // premier niveau, nécessaires si l'utilisateur la tire hors du dossier (mode extraction).
      const folderWrap = dragType === 'folder-card' ? blockEl.closest('[data-folder]') : null;
      const topBlocks = dragType === 'folder-card'
        ? Array.from(list.children).filter(ch => ch.matches('[data-folder]') || (ch.matches('[data-drag-card]') && !ch.dataset.cardFolder))
        : null;
      st.current = { scope, dragType, folderName, blockEl, blocks, draggedIndex, targetIndex: draggedIndex, drop: null, highlightEl: null, folderWrap, topBlocks };
      window.__isDragging = true;
      if (typeof weatherRowDismiss.current !== 'undefined' && weatherRowDismiss.current) { weatherRowDismiss.current(); weatherRowDismiss.current = null; }
      document.body.style.userSelect = 'none';
      const sel = window.getSelection && window.getSelection(); if (sel) sel.removeAllRanges();
      document.body.style.cursor = 'grabbing';
      if (isTouch) list.style.touchAction = 'none';
      blockEl.style.opacity = '0.35';
      if (isTouch) { if (isNative) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {}); else if (navigator.vibrate) navigator.vibrate(20); }
      update(startY);
    };
    const onMove = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!armed) {
        if (isTouch) { if (Math.abs(dx) > 8 || Math.abs(dy) > 8) cleanup(); return; }
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        arm();
        if (!armed) { cleanup(); return; }
      } else {
        ev.preventDefault();
        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
        update(ev.clientY);
      }
    };
    const commit = () => {
      const s = st.current;
      const drop = s.drop;
      if (!drop) return;
      const items = cloneItems(groupedItems);
      // Déposer une carte sans dossier sur un dossier => l'y classer (clientFolder) + l'y placer.
      if (drop.mode === 'folder') {
        const [movedItem] = items.splice(s.draggedIndex, 1);
        if (!movedItem || movedItem.type !== 'project') return;
        const fit = items.find(it => it.type === 'folder' && it.name === drop.folderName);
        if (!fit) return;
        const at = drop.closed ? fit.projects.length : Math.max(0, Math.min(drop.insertIndex, fit.projects.length));
        fit.projects.splice(at, 0, movedItem.project);
        moveToFolder(movedItem.project.id, drop.folderName, flattenIds(items));
        if (setFolderState) setFolderState(drop.folderName, true); // ouvrir pour montrer le résultat
        return;
      }
      // Sortir une carte de son dossier => clientFolder = null, posée au premier niveau à
      // l'index visé. Si le dossier se vide, son bloc disparaît au prochain rendu (plus aucun
      // projet ne le référence) et flattenIds ignore de toute façon les dossiers vides.
      if (drop.mode === 'extract') {
        const draggedId = s.blockEl.dataset.dragCard;
        const fit = items.find(it => it.type === 'folder' && it.name === s.folderName);
        if (!fit) return;
        const pIdx = fit.projects.findIndex(p => p.id === draggedId);
        if (pIdx === -1) return;
        const [movedProj] = fit.projects.splice(pIdx, 1);
        const at = Math.max(0, Math.min(drop.topIndex, items.length));
        items.splice(at, 0, { type: 'project', project: movedProj });
        moveToFolder(draggedId, null, flattenIds(items));
        return;
      }
      // Réordonnancement (premier niveau ou dans un dossier).
      let from = s.draggedIndex, to = drop.targetIndex;
      if (to === from || to === from + 1) return; // même emplacement
      if (drop.mode === 'top') {
        const [moved] = items.splice(from, 1);
        if (to > from) to -= 1;
        items.splice(to, 0, moved);
        applyTodoOrder(flattenIds(items));
      } else {
        const fit = items.find(it => it.type === 'folder' && it.name === s.folderName);
        if (!fit) return;
        const [moved] = fit.projects.splice(from, 1);
        if (to > from) to -= 1;
        fit.projects.splice(to, 0, moved);
        applyTodoOrder(flattenIds(items));
      }
    };
    const onUp = () => {
      cleanup();
      if (armed && st.current) {
        if (isTouch && !moved && dragType !== 'folder' && onCardHold) onCardHold(blockEl.dataset.dragCard);
        else commit();
        const blocker = (ce) => { ce.stopPropagation(); ce.preventDefault(); };
        list.addEventListener('click', blocker, { capture: true, once: true });
        setTimeout(() => { try { list.removeEventListener('click', blocker, { capture: true }); } catch (e) {} }, 80);
      }
      teardown();
    };

    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    document.addEventListener('selectstart', preventSelect);
    if (isTouch) timer = setTimeout(arm, 380);
  };

  return { onListPointerDown, dropLine };
};

export const TodoView = ({ onSelect, onAddProject, addingProject, plusRef }) => {
  const { projects, reorderProjects, applyTodoOrder, moveToFolder, folderStates, setFolderState } = useStore();
  const isMobile = useIsMobile();
  // iPad: comme au téléphone, la liste annonce au navigateur que seul le défilement vertical est à lui (les glissements
  // horizontaux ouvrent le tiroir).
  const [touchOnly] = useState(() => window.matchMedia('(hover: none)').matches);
  const { tier, getProjectLimit, canCreateProject } = useSubscription();
  const { t } = useLang();
  const { bannerError, lastCachedAt } = useWeatherStatus();
  const todoProjects = projects.filter(p => p.status === ProjectStatus.TODO);
  // Regroupement par dossier client. Parcours dans l'ordre (sort_order): projet sans dossier
  // => carte seule; projet avec dossier => accordéon à la position de sa 1ère apparition
  // (ordre des dossiers = ordre d'apparition ≈ ordre d'ajout), les suivants y sont absorbés.
  const groupedItems = (() => {
    const items = [], byName = {};
    let order = 0;
    for (const p of todoProjects) {
      const f = (p.clientFolder || '').trim();
      if (!f) { items.push({ type: 'project', project: p }); continue; }
      if (byName[f]) { byName[f].projects.push(p); continue; }
      const it = { type: 'folder', name: f, projects: [p], order: order++ };
      byName[f] = it; items.push(it);
    }
    return items;
  })();
  // Ouvert/fermé d'un dossier: état explicite si présent, sinon défaut = 2 premiers ouverts.
  const isFolderOpen = (it) => (it.name in folderStates) ? !!folderStates[it.name] : (it.order < 2);
  const [openActionsId, setOpenActionsId] = useState(null);
  const [showUpgradeFromTodo, setShowUpgradeFromTodo] = useState(false);
  const listRef = useRef(null);
  // Appui long relâché sans bouger sur une carte (téléphone): le projet devient, ou cesse d'être, le shooting
  // du jour, avec un retour haptique distinct de celui du glisser-déposer.
  const onCardHold = (projectId) => {
    const marked = toggleShootOfDay(projectId);
    if (!marked) endShootActivity();
    if (isNative) Haptics.notification({ type: marked ? NotificationType.Success : NotificationType.Warning }).catch(() => {});
    else if (navigator.vibrate) navigator.vibrate(marked ? [30, 40, 30] : 40);
  };
  // Le shooting du jour (appui long relâché sans bouger) reste un geste du téléphone; sur iPad, l'appui long sert
  // seulement à déplacer la carte.
  const { onListPointerDown, dropLine } = useFolderDnD({ listRef, groupedItems, applyTodoOrder, moveToFolder, setFolderState, onCardHold: isMobile ? onCardHold : null });
  // Tick chaque minute pour faire avancer le compteur "il y a 3H45" de la banniere.
  // 60s suffit: la precision affichee est la minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!bannerError || !lastCachedAt) return;
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, [bannerError, lastCachedAt]);
  
  // Close actions on vertical scroll (téléphone et iPad: à la souris, aucun tiroir ne s'ouvre)
  useEffect(() => {
    const onScroll = () => { if (openActionsId) setOpenActionsId(null); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [isMobile, openActionsId]);
  
  
  return (
    <div className="pb-8" style={{ paddingLeft: isMobile ? '0' : 'max(0px, calc((100vw - 1200px) / 2))', paddingTop: isMobile ? 'calc(16px + env(safe-area-inset-top))' : 'calc(100px + env(safe-area-inset-top))', ...(isMobile ? { minHeight: '100vh', touchAction: 'pan-y', overflowX: 'clip' } : touchOnly ? { touchAction: 'pan-y' } : {}) }}>
      {!isMobile && <h1 className="font-bebas-bold" style={{ position: 'fixed', top: 'calc(7px + env(safe-area-inset-top))', left: '10px', fontSize: '24px', color: '#5a6b69', letterSpacing: '0.03em', zIndex: 5 }}>PROJETS</h1>}
      {(() => {
        const limit = getProjectLimit();
        const isLimited = limit !== Infinity;
        const activeCount = projects.filter(p => p.status !== ProjectStatus.DONE).length;
        if (!isLimited) return null;
        return (
          <div style={{ padding: isMobile ? '0 24px 8px' : '0 16px 8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span className="font-bebas-light" style={{ fontSize: '15px', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.06em' }}>
              {activeCount}/{limit} {t('projectsCount')}
            </span>
            {activeCount >= limit && (
              <span onClick={() => setShowUpgradeFromTodo(true)} className="font-bebas-regular" style={{ fontSize: '14px', color: '#E07A2B', cursor: 'pointer', letterSpacing: '0.04em' }}>
                {t('upgradeToShooter')}
              </span>
            )}
          </div>
        );
      })()}
      <UpgradeModal isOpen={showUpgradeFromTodo} onClose={() => setShowUpgradeFromTodo(false)} />
      {(() => {
        // Banniere d'alerte API meteo: alignee verticalement avec le bouton + et
        // commencant horizontalement sur la 1ere stroke verticale des cartes (apres la
        // WeatherRow). Sur les cartes desktop: padding 16 + WeatherRow.minWidth 432 +
        // ml-4 16 = 464 depuis le bord. Le wrapper du + a px-6 (24) sur md, et le
        // placeholder + occupe les 68px suivants. La banniere demarre donc a:
        //   marginLeft du wrapper-+ = 464 - 24 (px-6) = 440px depuis le bord du wrapper.
        // On laisse le placeholder + a sa place et on positionne la banniere en absolute
        // par rapport au wrapper flex pour ne PAS pousser le + a droite.
        const sinceLabel = lastCachedAt ? formatTimeSince(lastCachedAt, now) : null;
        const showBanner = !!bannerError;
        if (!isMobile) {
          return (
            <div className="px-4 md:px-6" style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
              <div ref={plusRef} style={{ width: '68px', height: '88px', marginLeft: '-6px' }}/>
              {showBanner && (
                <div role="status" aria-live="polite"
                  {...(bannerError !== 'network' ? {
                    onClick: () => { const tmp = document.createElement('a'); tmp.href = 'https://status.open-meteo.com/'; tmp.target = '_blank'; tmp.rel = 'noopener noreferrer'; document.body.appendChild(tmp); tmp.click(); tmp.remove(); },
                  } : {})}
                  style={{
                    marginLeft: '378px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '18px',
                }}>
                  <svg width="38" height="34" viewBox="0 0 32 28" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
                    {/* Triangle avec coins arrondis: chaque sommet est remplace par une
                        courbe de Bezier quadratique. Radius ~2 sur les 3 sommets. */}
                    <path d="M 4 24.26 L 15 4.74 Q 16 3 17 4.74 L 28 24.26 Q 29 26 27 26 L 5 26 Q 3 26 4 24.26 Z"/>
                    <line x1="16" y1="11" x2="16" y2="17"/>
                    <circle cx="16" cy="21.5" r="1.1" fill="#ffffff" stroke="none"/>
                  </svg>
                  <div className="font-bebas-regular" style={{
                    fontSize: '12.6pt',
                    letterSpacing: '0.17em',
                    color: '#404a48',
                    textTransform: 'uppercase',
                    lineHeight: 1.25,
                  }}>
                    <div>
                      {bannerError === 'network'
                        ? 'Connexion internet inaccessible'
                        : 'API météo temporairement inaccessible'}
                    </div>
                    {sinceLabel && (
                      <div>
                        Dernière mise à jour il y a <span style={{ color: '#ffffff' }}>{sinceLabel}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        }
        // Mobile: l'IIFE rend seulement le placeholder du + et GeoWeatherCard.
        // La banniere mobile est rendue plus bas, juste avant le premier projet,
        // pour qu'elle se sente "attachee" a la liste et non a la carte GPS.
        return (
          <React.Fragment>
            <div ref={plusRef} style={{ width: 0, height: 0 }}/>
            <GeoWeatherCard/>
          </React.Fragment>
        );
      })()}
      {todoProjects.length === 0 ? (isMobile ? (
        <div ref={el => {
          if (!el) return;
          const flare = document.getElementById('persistentFlare');
          if (!flare) return;
          // Position while hidden, then fade in
          flare.style.transition = 'none';
          flare.style.opacity = '0';
          flare.style.animation = 'none';
          setTimeout(() => {
            const r = el.getBoundingClientRect();
            const w = parseFloat(flare.dataset.splashWidth) || 200;
            flare.style.top = (r.top + r.height / 2 - w / 2 + 30) + 'px';
            flare.style.left = (r.left + r.width / 2 - w / 2 + 5) + 'px';
            flare.style.width = w + 'px';
            flare.style.display = 'block';
            requestAnimationFrame(() => {
              flare.style.transition = 'opacity 1s ease';
              flare.style.opacity = '0.7';
              flare.style.animation = 'flareOrgFloat 12s ease-in-out infinite';
            });
          }, 400);
        }} onClick={onAddProject} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 450px)', cursor: 'pointer', position: 'relative' }}>
          {/* Large soft blue halo */}
          <div style={{ position: 'absolute', width: '250px', height: '312px', borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(36,89,117,0.45) 0%, rgba(36,89,117,0.15) 40%, rgba(36,89,117,0) 70%)', pointerEvents: 'none', marginTop: '-50px', marginLeft: '-20px' }}/>
          {/* White halo around + */}
          <div style={{ position: 'absolute', width: '60px', height: '60px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 50%, rgba(255,255,255,0) 70%)', pointerEvents: 'none' }}/>
          <span className="font-bebas-book" style={{ fontSize: '234px', color: '#FFFFFF', lineHeight: 1, textShadow: '0 0 30px rgba(255,255,255,0.15)' }}>+</span>
        </div>
      ) : (
        <div onClick={onAddProject} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 300px)', cursor: 'pointer', position: 'relative' }}>
          <div style={{ position: 'absolute', width: '250px', height: '312px', borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(36,89,117,0.45) 0%, rgba(36,89,117,0.15) 40%, rgba(36,89,117,0) 70%)', pointerEvents: 'none', marginTop: '-30px' }}/>
          <div style={{ position: 'absolute', width: '60px', height: '60px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 50%, rgba(255,255,255,0) 70%)', pointerEvents: 'none' }}/>
          <span className="font-bebas-book" style={{ fontSize: '180px', color: '#FFFFFF', lineHeight: 1, textShadow: '0 0 30px rgba(255,255,255,0.15)' }}>+</span>
        </div>
      ))
      : <div ref={el => { const f = document.getElementById('persistentFlare'); if (f) { f.style.opacity = '0'; f.style.animation = 'none'; } return listRef.current = el; }} onPointerDown={onListPointerDown} style={{ paddingTop: '16px', paddingBottom: '80px', userSelect: 'none', WebkitUserSelect: 'none' }}>
          {isMobile && bannerError && (
            <div role="status" aria-live="polite"
              {...(bannerError !== 'network' ? {
                onClick: () => { const tmp = document.createElement('a'); tmp.href = 'https://status.open-meteo.com/'; tmp.target = '_blank'; tmp.rel = 'noopener noreferrer'; document.body.appendChild(tmp); tmp.click(); tmp.remove(); },
              } : {})}
              style={{
                margin: '0 24px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
            }}>
              <svg width="31" height="28" viewBox="0 0 32 28" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                <path d="M 4 24.26 L 15 4.74 Q 16 3 17 4.74 L 28 24.26 Q 29 26 27 26 L 5 26 Q 3 26 4 24.26 Z"/>
                <line x1="16" y1="11" x2="16" y2="17"/>
                <circle cx="16" cy="21.5" r="1.1" fill="#ffffff" stroke="none"/>
              </svg>
              <div className="font-bebas-regular" style={{
                fontSize: '9.1pt',
                letterSpacing: '0.14em',
                color: '#404a48',
                textTransform: 'uppercase',
                lineHeight: 1.25,
              }}>
                <div>
                  {bannerError === 'network'
                    ? 'Connexion internet inaccessible'
                    : 'API météo temporairement inaccessible'}
                </div>
                {lastCachedAt && (
                  <div>
                    Dernière mise à jour il y a <span style={{ color: '#ffffff' }}>{formatTimeSince(lastCachedAt, now)}</span>
                  </div>
                )}
              </div>
            </div>
          )}
          {(() => {
            let ci = 0; // index courant des cartes visibles (stagger d'animation)
            return groupedItems.map((it) => {
              if (it.type === 'project') {
                const i = ci++;
                return <div key={it.project.id} data-drag-card={it.project.id} data-card-folder=""><ProjectCard project={it.project} index={i} onSelect={onSelect} actionsOpen={openActionsId === it.project.id} setOpenActionsId={setOpenActionsId}/></div>;
              }
              const open = isFolderOpen(it);
              return (
                <FolderAccordion key={'folder:' + it.name} name={it.name} count={it.projects.length} isOpen={open} onToggle={() => setFolderState(it.name, !open)}>
                  {open && it.projects.map((p) => {
                    const i = ci++;
                    return <div key={p.id} data-drag-card={p.id} data-card-folder={it.name}><ProjectCard project={p} index={i} onSelect={onSelect} actionsOpen={openActionsId === p.id} setOpenActionsId={setOpenActionsId}/></div>;
                  })}
                </FolderAccordion>
              );
            });
          })()}
        </div>}
      {dropLine && ReactDOM.createPortal(
        <div style={{ position: 'fixed', left: dropLine.left, top: dropLine.top - 1, width: dropLine.width, height: 0, borderTop: '2px solid #ffffff', zIndex: 9998, pointerEvents: 'none' }}/>,
        document.body)}
    </div>
  );
};
