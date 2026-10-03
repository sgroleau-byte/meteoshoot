import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { LoginScreen } from '../auth/LoginScreen.jsx';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useLang } from '../i18n/LangProvider.jsx';
import { geocodeAddress, getTravelTime } from '../maps/google.js';
import { StoreProvider, useStore } from '../projects/StoreProvider.jsx';
import { SubscriptionProvider } from '../subscription/SubscriptionProvider.jsx';
import { attachSmoothWheel } from '../utils/smoothWheel.js';
import { WeatherStatusProvider } from '../weather/WeatherStatusProvider.jsx';
import { Header } from './Header.jsx';
import { MobileNewProjectScreen } from './MobileNewProjectScreen.jsx';
import { NewProjectModal } from './NewProjectModal.jsx';
import { PreferencesView } from './PreferencesView.jsx';
import { ProjectDetail } from './ProjectDetail.jsx';
import { RetouchingView } from './RetouchingView.jsx';
import { RouteView } from './route/RouteView.jsx';
import { TodoView } from './TodoView.jsx';
import { UndoToast } from './UndoToast.jsx';

export const App = () => {
  const { view, setView, selectedId, setSelectedId, prefs, lastDeleted, undoDelete, addProject, synced } = useStore();
  const { t } = useLang();
  const [showNew, setShowNew] = useState(false);
  const plusRef = React.useRef(null);
  const [plusRect, setPlusRect] = useState(null);
  const isMobile = useIsMobile();
  const [glowReady, setGlowReady] = useState(false);
  // Retire le splash de index.html dès que l'interface est peinte (plus d'attente fixe).
  useEffect(() => { if (typeof window.__meteoshootReady === 'function') requestAnimationFrame(() => window.__meteoshootReady()); }, []);
  useEffect(() => { const t = setTimeout(() => setGlowReady(true), 800); return () => clearTimeout(t); }, []);
  const [displayedProjectId, setDisplayedProjectId] = useState(null);
  const detailScrollRef = React.useRef(null);
  // Fermeture animée de la fiche: la fiche reste montée le temps du fondu de sortie.
  const [detailClosing, setDetailClosing] = useState(false);
  const closeTimer = React.useRef(null);

  // Ajout direct depuis un lien externe (ex: BudgetShoot) : ?prefill=<JSON>
  // Attend que la liste soit chargée (synced) pour ne pas se faire écraser.
  const externalAddDone = React.useRef(false);
  useEffect(() => {
    if (!synced || externalAddDone.current) return;
    externalAddDone.current = true;
    let parsed;
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get('prefill');
      if (!raw) return;
      params.delete('prefill');
      const qs = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
      parsed = JSON.parse(raw);
    } catch (err) { console.warn('Ajout externe: lecture impossible', err); return; }
    if (!parsed || !(parsed.name || parsed.address)) return;
    setView('todo');
    (async () => {
      const data = {
        name: parsed.name || '',
        address: parsed.address || '',
        mandates: Array.isArray(parsed.mandates) ? parsed.mandates : [],
        orientation: [], isContest: false, lat: null, lng: null
      };
      if (data.address) {
        try { const r = await geocodeAddress(data.address); data.lat = r.lat; data.lng = r.lng; data.address = r.formattedAddress; } catch (e) { console.warn('Géocodage:', e); }
      }
      if (data.lat && data.lng && prefs.homeLat && prefs.homeLng) {
        try { const travel = await getTravelTime(prefs.homeLat, prefs.homeLng, data.lat, data.lng); data.travelTime = travel; data.departureAddress = prefs.homeAddress; data.departureLat = prefs.homeLat; data.departureLng = prefs.homeLng; } catch (e) { console.warn('Trajet:', e); }
      }
      const result = addProject(data);
      if (result && result.error === 'limit_reached') {
        window.alert('Limite de projets atteinte sur ton forfait MétéoShoot.');
      }
    })();
  }, [synced]);

  // Cmd+Z undo delete (desktop) + shake-to-undo (mobile)
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && lastDeleted) {
        e.preventDefault();
        undoDelete();
      }
    };
    window.addEventListener('keydown', handler);

    // Shake detection for mobile
    let lastShake = 0;
    let lastX = null, lastY = null, lastZ = null;
    const shakeThreshold = 25;
    const onMotion = (e) => {
      if (!lastDeleted) return;
      const { x, y, z } = e.accelerationIncludingGravity || {};
      if (x == null) return;
      if (lastX !== null) {
        const delta = Math.abs(x - lastX) + Math.abs(y - lastY) + Math.abs(z - lastZ);
        if (delta > shakeThreshold && Date.now() - lastShake > 1000) {
          lastShake = Date.now();
          undoDelete();
        }
      }
      lastX = x; lastY = y; lastZ = z;
    };
    window.addEventListener('devicemotion', onMotion);

    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('devicemotion', onMotion);
    };
  }, [lastDeleted, undoDelete]);

  // Pull-to-refresh (Safari-style)
  useEffect(() => {
    if (!isMobile) return;
    let startY = 0, pulling = false, ready = false, indicator = null;
    const threshold = 220;
    const createIndicator = () => {
      if (indicator) return;
      indicator = document.createElement('div');
      indicator.style.cssText = 'position:fixed;top:80px;left:50%;width:40px;height:40px;border-radius:50%;background:rgba(0,0,0,0.3);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;z-index:9999;opacity:0;transition:opacity 0.2s;pointer-events:none;transform:translateX(-50%)';
      indicator.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(125,211,198,0.8)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transition:transform 0.5s"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>';
      document.body.appendChild(indicator);
    };
    const removeIndicator = () => {
      if (indicator) { indicator.remove(); indicator = null; }
    };
    const onStart = (e) => {
      if (window.scrollY <= 0) {
        startY = e.touches[0].clientY;
        pulling = true;
        ready = false;
      }
    };
    const onMove = (e) => {
      if (!pulling) return;
      const dy = e.touches[0].clientY - startY;
      if (dy < 0) { pulling = false; removeIndicator(); return; }
      if (dy > 20) {
        createIndicator();
        const progress = Math.min(dy / threshold, 1);
        indicator.style.opacity = progress;
        const svg = indicator.querySelector('svg');
        if (svg) svg.style.transform = `rotate(${progress * 540}deg)`;
        ready = progress >= 1;
        if (ready) {
          indicator.style.background = 'rgba(125,211,198,0.15)';
          indicator.style.boxShadow = '0 0 12px rgba(125,211,198,0.3)';
        } else {
          indicator.style.background = 'rgba(0,0,0,0.3)';
          indicator.style.boxShadow = 'none';
        }
      }
    };
    const onEnd = () => {
      if (ready) {
        if (indicator) {
          indicator.style.transition = 'opacity 0.4s';
          indicator.style.opacity = '0';
        }
        setTimeout(() => window.location.reload(), 500);
      } else {
        if (indicator) {
          indicator.style.transition = 'opacity 0.2s';
          indicator.style.opacity = '0';
          setTimeout(() => removeIndicator(), 250);
        }
      }
      pulling = false;
      ready = false;
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      removeIndicator();
    };
  }, [isMobile]);
  
  useEffect(() => {
    if (selectedId) {
      if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
      setDetailClosing(false);
      setDisplayedProjectId(selectedId);
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    } else if (displayedProjectId) {
      // Fondu de sortie (220 ms) avant de retirer la fiche, sauf si l'utilisateur réduit les animations.
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const finish = () => { closeTimer.current = null; setDisplayedProjectId(null); setDetailClosing(false); document.documentElement.style.overflow = ''; document.body.style.overflow = ''; };
      if (reduce) finish(); else { setDetailClosing(true); closeTimer.current = setTimeout(finish, 220); }
    } else {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
    return () => { document.documentElement.style.overflow = ''; document.body.style.overflow = ''; };
  }, [selectedId]);

  // Scroll fluide (amorti) du détail, au survol de la zone autour de la carte (desktop, molette).
  // La carte garde son zoom molette: son propre handler fait stopPropagation, donc ce
  // gestionnaire ne se déclenche jamais au-dessus d'elle.
  useEffect(() => {
    if (isMobile || !displayedProjectId) return;
    const el = detailScrollRef.current;
    if (!el) return;
    return attachSmoothWheel(el, el);
  }, [displayedProjectId, isMobile]);

  // Même défilement fluide pour les vues principales (listing projets, édition, préférences),
  // qui défilent la fenêtre (html overflow-y:scroll). Desktop uniquement; inactif quand un
  // détail est ouvert (la fenêtre est alors figée par overflow:hidden). Exactement le même
  // mécanisme et les mêmes réglages que le détail.
  useEffect(() => {
    if (isMobile || displayedProjectId) return;
    return attachSmoothWheel(window, document.scrollingElement || document.documentElement);
  }, [displayedProjectId, isMobile]);

  // Track plus button position
  useEffect(() => {
    const update = () => {
      if (plusRef.current) {
        const r = plusRef.current.getBoundingClientRect();
        setPlusRect({ x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width/2, cy: r.top + r.height/2 });
      }
    };
    update();
    // Recalculate after fonts/content load
    const t1 = setTimeout(update, 100);
    const t2 = setTimeout(update, 500);
    const t3 = setTimeout(update, 1500);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update);
    document.fonts?.ready?.then(update);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); window.removeEventListener('resize', update); window.removeEventListener('scroll', update); };
  }, [view]);

  // Browser history management
  const openProject = (p) => {
    const f = document.getElementById('persistentFlare');
    if (f) { f.style.display = 'none'; f.style.animation = 'none'; f.style.opacity = '0'; }
    setShowNew(false);
    setSelectedId(p.id);
    window.scrollTo(0, 0);
    history.pushState({ projectId: p.id, view }, '', `#project/${p.id}`);
  };
  
  const closeProject = () => {
    setSelectedId(null);
    window.scrollTo(0, 0);
    history.pushState({ view }, '', `#${view}`);
  };

  const changeView = (v) => {
    const f = document.getElementById('persistentFlare');
    if (f) { f.style.display = 'none'; f.style.animation = 'none'; f.style.opacity = '0'; }
    setView(v);
    setSelectedId(null);
    window.scrollTo(0, 0);
    history.pushState({ view: v }, '', `#${v}`);
  };

  useEffect(() => {
    // Set initial state
    history.replaceState({ view }, '', `#${view}`);
    
    const onPopState = (e) => {
      const state = e.state;
      window.scrollTo(0, 0);
      if (state?.projectId) {
        setSelectedId(state.projectId);
        if (state.view) setView(state.view);
      } else {
        setSelectedId(null);
        if (state?.view) setView(state.view);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Logo fade when overlapping content
  useEffect(() => {
    // Track mouse direction for day-popup slide
    let lastMouseX = 0;
    let hideTimeout = null;
    const handleMouseMove = (e) => { lastMouseX = e.clientX; };
    const handleMouseEnter = (e) => {
      if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
      const cell = e.currentTarget;
      const rect = cell.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const dir = lastMouseX < centerX ? -8 : 8;
      // Hide all other popups instantly
      document.querySelectorAll('.day-popup.popup-active').forEach(p => {
        p.style.transition = 'none';
        p.classList.remove('popup-active');
      });
      const popup = cell.querySelector('.day-popup');
      if (popup) {
        popup.style.setProperty('--slide-from', dir + 'px');
        // Force reflow then animate in
        void popup.offsetWidth;
        popup.style.transition = '';
        popup.classList.add('popup-active');
      }
    };
    const handleMouseLeave = (e) => {
      hideTimeout = setTimeout(() => {
        document.querySelectorAll('.day-popup.popup-active').forEach(p => {
          p.style.transition = '';
          p.classList.remove('popup-active');
        });
      }, 80);
    };
    document.addEventListener('mousemove', handleMouseMove);
    // Touch support for day popups (desktop touch only, disabled on mobile <768px)
    const handleTouch = (e) => {
      if (window.innerWidth <= 768) return; // Skip on mobile
      const cell = e.target.closest('.day-cell');
      if (!cell) {
        // Tap outside: close all popups
        document.querySelectorAll('.day-popup.popup-active').forEach(p => {
          p.style.transition = '';
          p.classList.remove('popup-active');
        });
        return;
      }
      // preventDefault seulement s'il y a une bulle à basculer: les cases n'en ont plus, et l'appel bloquait,
      // sur iPad, le défilement de la page parti d'une case météo et le toucher qui ouvre la fiche.
      const popup = cell.querySelector('.day-popup');
      if (!popup) return;
      e.preventDefault();
      const wasActive = popup.classList.contains('popup-active');
      // Close all
      document.querySelectorAll('.day-popup.popup-active').forEach(p => {
        p.style.transition = 'none';
        p.classList.remove('popup-active');
      });
      // Toggle the tapped one
      if (!wasActive) {
        popup.style.setProperty('--slide-from', '0px');
        void popup.offsetWidth;
        popup.style.transition = '';
        popup.classList.add('popup-active');
      }
    };
    document.addEventListener('touchstart', handleTouch, { passive: false });
    // Disable CSS hover during scroll
    let scrollTimer;
    const onWheel = () => {
      document.body.classList.add('is-scrolling');
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => document.body.classList.remove('is-scrolling'), 150);
    };
    window.addEventListener('wheel', onWheel, { passive: true });
    const attach = () => {
      document.querySelectorAll('.day-cell').forEach(c => {
        c.removeEventListener('mouseenter', handleMouseEnter);
        c.addEventListener('mouseenter', handleMouseEnter);
        c.removeEventListener('mouseleave', handleMouseLeave);
        c.addEventListener('mouseleave', handleMouseLeave);
      });
    };
    attach();
    const obs = new MutationObserver(attach);
    obs.observe(document.body, { childList: true, subtree: true });
    return () => { document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('touchstart', handleTouch); obs.disconnect(); };
  });

  return (
    <div className="min-h-screen bg-cream" style={{ position: 'relative', ...(isMobile ? { background: 'transparent' } : {}) }}>
      {/* Soft radial gradient background */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', opacity: isMobile && !glowReady ? 0 : 1, transition: 'opacity 0.8s ease', background: `radial-gradient(ellipse 60% 40% at ${plusRect ? plusRect.cx : window.innerWidth * 0.5}px ${plusRect && !selectedId ? plusRect.cy : 120}px, rgba(45,80,70,0.35) 0%, rgba(44,44,44,0) 70%)` }}/>
      {/* Top blur overlay: desktop only, full width. Sur iPad (app web installée ou app native), la page passe
          sous la barre de statut: le flou, le fondu, les titres et le menu descendent de la hauteur de la zone sûre
          (env(safe-area-inset-top), nulle dans un navigateur ordinaire) et le fondu reste plein sous la barre. */}
      {!isMobile && <div style={{
        position: 'fixed', top: 0, left: 0, right: 0,
        height: 'calc(72px + env(safe-area-inset-top))',
        backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
        WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 35%, transparent 100%)',
        maskImage: 'linear-gradient(to bottom, black 0%, black 35%, transparent 100%)',
        zIndex: 39, pointerEvents: 'none'
      }}/>}
      {/* Top content fade: bg color to transparent */}
      {!isMobile && <div style={{
        position: 'fixed', top: 0, left: 0, right: 0,
        height: 'calc(50px + env(safe-area-inset-top))',
        background: 'linear-gradient(to bottom, #181b1e env(safe-area-inset-top), transparent 100%)',
        zIndex: 38, pointerEvents: 'none'
      }}/>}
      {/* Page titles: rendered at App level ABOVE blur */}
      {!isMobile && displayedProjectId && <h1 className="font-bebas-bold" style={{ position: 'fixed', top: 'calc(7px + env(safe-area-inset-top))', left: '10px', fontSize: '24px', color: '#5a6b69', letterSpacing: '0.03em', zIndex: 41, pointerEvents: 'none' }}>{t('projectDetailsTitle')}</h1>}
      {!isMobile && !displayedProjectId && view !== 'routes' && <h1 className="font-bebas-bold" style={{ position: 'fixed', top: 'calc(7px + env(safe-area-inset-top))', left: '10px', fontSize: '24px', color: '#5a6b69', letterSpacing: '0.03em', zIndex: 41, pointerEvents: 'none' }}>{view === 'todo' ? t('projects') : view === 'retouching' ? t('editing') : t('preferences')}</h1>}
      {!(isMobile && showNew) && <Header onChangeView={changeView} onAddProject={() => { const f = document.getElementById('persistentFlare'); if (f) { f.style.display = 'none'; f.style.animation = 'none'; } setShowNew(true); }}/>}
      <div style={{ 
        display: isMobile && showNew ? 'none' : 'block'
      }}>
      <main className="animate-fade-in" style={{ position: 'relative', zIndex: 1 }}>
        <div style={{
          pointerEvents: selectedId ? 'none' : 'auto',
          position: 'relative',
          width: '100%'
        }}>
          {view === 'todo' && <TodoView onSelect={openProject} onAddProject={() => { const f = document.getElementById('persistentFlare'); if (f) { f.style.display = 'none'; f.style.animation = 'none'; } setShowNew(true); }} addingProject={showNew} plusRef={plusRef}/>}
          {view === 'retouching' && <RetouchingView onSelect={openProject}/>}
          {view === 'routes' && <RouteView/>}
          {view === 'preferences' && <PreferencesView/>}
        </div>
        {displayedProjectId && <div ref={detailScrollRef} className={"detail-scroll " + (detailClosing ? "ms-detail-leave" : "ms-detail-enter")} style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          overflowX: 'hidden',
          overflowY: 'auto',
          zIndex: 10,
          background: '#181b1e'
        }}>
          <ProjectDetail projectId={displayedProjectId} onClose={closeProject}/>
        </div>}
      </main>
      </div>
      {/* Mobile slide-in new project screen */}
      {isMobile && <MobileNewProjectScreen isOpen={showNew} onClose={() => setShowNew(false)} onCreated={() => setShowNew(false)} />}
      {/* Desktop modal */}
      {!isMobile && view === 'todo' && !selectedId && plusRect && <NewProjectModal isOpen={showNew} origin={plusRect} onClose={() => { setShowNew(false); }} onCreated={() => { setShowNew(false); }} onOpen={() => setShowNew(true)}/>}
      {/* Undo delete toast */}
      {lastDeleted && <UndoToast key={lastDeleted.id} onUndo={undoDelete} projectName={lastDeleted.name} />}
    </div>
  );
};

export const AppWithAuth = () => {
  const { user, loading } = useAuth();
  
  if (loading) return <div style={{ position: 'fixed', inset: 0, background: '#181b1e' }}/>;
  
  if (!user) return <LoginScreen/>;

  return <SubscriptionProvider><StoreProvider><WeatherStatusProvider><App/></WeatherStatusProvider></StoreProvider></SubscriptionProvider>;
};

