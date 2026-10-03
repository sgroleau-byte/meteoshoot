import { useEffect, useRef, useState } from 'react';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useLang } from '../i18n/LangProvider.jsx';
import { useStore } from '../projects/StoreProvider.jsx';

export const Header = ({ onChangeView, onAddProject }) => {
  const { view, prefs, setPrefs } = useStore();
  const { t } = useLang();
  const isMobile = useIsMobile();
  const [hoveredItem, setHoveredItem] = useState(null);

  // iPhone : quand le clavier s'ouvre, WebKit garde le viewport de mise en page tel quel et ne
  // réduit que le viewport visuel ; le nav (position: fixed; bottom: 0) se retrouve alors au
  // milieu de l'écran, et reste parfois coincé là après la fermeture du clavier tant qu'on n'a
  // pas scrollé. On le masque tant que le clavier est ouvert et, à la fermeture, on force WebKit
  // à recaler les éléments fixes avec un scroll d'un pixel aller-retour.
  const [kbOpen, setKbOpen] = useState(false);
  useEffect(() => {
    if (!isMobile) return;
    const vv = window.visualViewport;
    let wasOpen = false, timer = null;
    const nudge = () => {
      const els = [document.scrollingElement || document.documentElement, ...document.querySelectorAll('.detail-scroll')].filter(Boolean);
      const ys = els.map(el => el.scrollTop);
      els.forEach((el, i) => { el.scrollTop = ys[i] > 0 ? ys[i] - 1 : ys[i] + 1; });
      requestAnimationFrame(() => els.forEach((el, i) => { el.scrollTop = ys[i]; }));
    };
    const check = () => {
      const visible = vv ? vv.height * (vv.scale || 1) : window.innerHeight;
      const open = visible < window.innerHeight * 0.75;
      if (open === wasOpen) return;
      wasOpen = open;
      setKbOpen(open);
      if (!open) { requestAnimationFrame(nudge); setTimeout(nudge, 300); }
    };
    // Filet de sécurité si visualViewport ne signale pas le clavier : re-vérifie après un focus / blur.
    const later = () => { clearTimeout(timer); timer = setTimeout(check, 350); };
    if (vv) { vv.addEventListener('resize', check); vv.addEventListener('scroll', check); }
    window.addEventListener('focusin', later);
    window.addEventListener('focusout', later);
    return () => {
      clearTimeout(timer);
      if (vv) { vv.removeEventListener('resize', check); vv.removeEventListener('scroll', check); }
      window.removeEventListener('focusin', later);
      window.removeEventListener('focusout', later);
    };
  }, [isMobile]);
  const navItems = [
    { id: 'todo', label: t('projects'), icon: '☀︎' },
    { id: 'retouching', label: t('editing'), icon: '✎' },
    { id: 'routes', label: t('routes'), icon: '⤳' },
    { id: 'preferences', label: t('preferences'), icon: '⚙' }
  ];

  // Scroll-driven glow position along pill border
  const glowRef = useRef(null);
  useEffect(() => {
    if (!isMobile) return;
    const onScroll = () => {
      if (!glowRef.current) return;
      const scrollY = window.scrollY || window.pageYOffset;
      // Map scroll to a 0-1 progress along the pill perimeter
      const t = ((scrollY * 0.3) % 360) / 360;
      // Trace the pill border: top edge left→right, then right cap, bottom right→left, left cap
      let gx, gy;
      if (t < 0.35) {
        // Top edge: left to right
        gx = (t / 0.35) * 100;
        gy = 0;
      } else if (t < 0.5) {
        // Right side: top to bottom
        const p = (t - 0.35) / 0.15;
        gx = 100;
        gy = p * 100;
      } else if (t < 0.85) {
        // Bottom edge: right to left
        gx = (1 - (t - 0.5) / 0.35) * 100;
        gy = 100;
      } else {
        // Left side: bottom to top
        const p = (t - 0.85) / 0.15;
        gx = 0;
        gy = (1 - p) * 100;
      }
      glowRef.current.style.setProperty('--gx', gx + '%');
      glowRef.current.style.setProperty('--gy', gy + '%');
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [isMobile]);

  // Desktop nav bar: hooks must be before any conditional return
  const navContainerRef = useRef(null);
  const navSpanRefs = useRef({});
  const [barStyle, setBarStyle] = useState({ left: 0, width: 0 });
  const [barReady, setBarReady] = useState(false);
  const barInitialized = useRef(false);
  const barRevealed = useRef(false);

  useEffect(() => {
    if (isMobile) return;
    const measure = () => {
      const span = navSpanRefs.current[view];
      const container = navContainerRef.current;
      if (!span || !container) return;
      const cRect = container.getBoundingClientRect();
      const sRect = span.getBoundingClientRect();
      setBarStyle({
        left: sRect.left - cRect.left,
        width: sRect.width,
      });
    };

    // ResizeObserver keeps the bar exactly the width of the active label on
    // any later change (zoom, language switch). Gated on barRevealed so the
    // wider *fallback* font measured during the reload reflow never moves the
    // bar before the real font is ready.
    const ro = new ResizeObserver(() => { if (barRevealed.current) measure(); });
    Object.values(navSpanRefs.current).forEach(s => { if (s) ro.observe(s); });

    // FOUT: au reload, la largeur du souligné était mesurée avec la police de
    // secours (plus large) avant que Bebas soit appliquée, d'où un souligné
    // trop large jusqu'au premier clic. On ne mesure qu'une fois les polices
    // prêtes ET la police du nav (Bebas Neue) réellement chargée: plus fiable
    // que document.fonts.ready seul sur WebKit quand la police est en cache.
    // Même fonction measure() que le repositionnement au clic.
    const initial = () => {
      barInitialized.current = true;
      barRevealed.current = true;
      setBarReady(true);
      requestAnimationFrame(() => measure());
    };
    const fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    const bebasReady = (document.fonts && document.fonts.load) ? document.fonts.load("400 20px 'Bebas Neue'").catch(() => {}) : Promise.resolve();
    Promise.all([fontsReady, bebasReady]).then(() => requestAnimationFrame(initial));

    // Recalcul au redimensionnement de la fenêtre (même fonction de mesure).
    window.addEventListener('resize', measure);

    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [view, isMobile]);

  if (isMobile) {
    return (
      <nav className="mobile-bottom-nav ms-enter-nav fixed bottom-0 left-0 right-0 z-40" 
        style={{ 
          height: 'calc(120px + env(safe-area-inset-bottom))',
          visibility: kbOpen ? 'hidden' : 'visible',
          pointerEvents: kbOpen ? 'none' : 'auto',
          background: 'transparent',
          backdropFilter: 'blur(20px) saturate(1.3)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.3)',
          WebkitMaskImage: 'linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 50%, rgba(0,0,0,0) 100%)',
          maskImage: 'linear-gradient(to top, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 50%, rgba(0,0,0,0) 100%)',
          overflow: 'hidden'
        }}>
        {/* Yellow glow - bottom left, subtle */}
        <div style={{ position: 'absolute', left: '-250px', bottom: 0, width: '500px', height: '86px', overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
          <div style={{ position: 'absolute', left: 0, bottom: '-300px', width: '500px', height: '500px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(210,188,110,0.30) 0%, rgba(210,188,110,0.04) 40%, rgba(210,188,110,0) 70%)' }}/>
        </div>
        {/* Teal glow - center, contours only */}
        <div style={{ position: 'absolute', left: 'calc(50% + 50px)', bottom: 0, width: '500px', height: '86px', overflow: 'hidden', pointerEvents: 'none', zIndex: 0, transform: 'translateX(-50%)' }}>
          <div style={{ position: 'absolute', left: 0, bottom: '-370px', width: '500px', height: '500px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(61,130,170,0.35) 0%, rgba(61,130,170,0.1) 40%, rgba(61,130,170,0) 70%)' }}/>
        </div>
        {/* Black flare - bottom right, in 86px mask (257px @3x) */}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '86px', overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
          <div style={{ position: 'absolute', right: '-400px', bottom: '-400px', width: '760px', height: '760px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.2) 40%, rgba(0,0,0,0) 70%)' }}/>
        </div>
        {/* Content row - positioned from bottom */}
        <div style={{ position: 'absolute', bottom: '20px', left: 0, right: 0, display: 'flex', alignItems: 'center', height: '50px', zIndex: 1 }}>
          {/* + button with halo */}
          <button
            onClick={view === 'todo' ? onAddProject : undefined}
            style={{
              background: 'none',
              border: 'none',
              cursor: view === 'todo' ? 'pointer' : 'default',
              position: 'relative',
              marginLeft: '23px',
              flexShrink: 0,
              opacity: view === 'todo' ? 1 : 0.3,
              pointerEvents: view === 'todo' ? 'auto' : 'none',
              WebkitTapHighlightColor: 'transparent',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <span className="font-bebas-book" style={{ letterSpacing: '0.04em', color: '#ffffff', fontSize: '67px', lineHeight: '0.7', position: 'relative', zIndex: 1, textShadow: '0 0 10px rgba(255,255,255,0.8), 0 0 30px rgba(255,255,255,0.5), 0 0 60px rgba(255,255,255,0.25)' }}>+</span>
          </button>
          {/* Nav labels */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '20px' }}>
            {navItems.map(item => {
              const isActive = view === item.id;
              return (
                <button 
                  key={item.id}
                  onClick={() => onChangeView(item.id)}
                  style={{ 
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent'
                  }}
                >
                  <span 
                    className="font-bebas-book" 
                    style={{ 
                      fontSize: '20px',
                      color: isActive ? '#ffffff' : '#919b99',
                      letterSpacing: '0.1em',
                      transition: 'color 0.3s'
                    }}
                  >
                    {item.id === 'preferences' ? t('preferencesShort') : item.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>
    );
  }

  // Le menu descend sous la barre de statut quand la page la recouvre (app web installée ou app native sur iPad):
  // env(safe-area-inset-top) vaut 0 dans un navigateur ordinaire.
  return (
    <header
      className="ms-enter-nav fixed top-0 right-0 z-40"
      style={{ paddingTop: 'calc(10px + env(safe-area-inset-top))', paddingRight: '13px' }}
    >
      <div ref={navContainerRef} className="flex gap-6" style={{ position: 'relative', paddingBottom: '5px' }}>
        {navItems.map(item => {
          const isActive = view === item.id;
          return (
            <button 
              key={item.id}
              onClick={() => onChangeView(item.id)}
              onMouseEnter={() => setHoveredItem(item.id)}
              onMouseLeave={() => setHoveredItem(null)}
              className="cursor-pointer"
              style={{ 
                background: 'none',
                border: 'none',
                padding: '0 4px',
                position: 'relative',
              }}
            >
              <span 
                ref={el => navSpanRefs.current[item.id] = el}
                className="font-bebas-regular tracking-wider whitespace-nowrap"
                style={{ letterSpacing: '0.04em', 
                  fontSize: '20px',
                  color: isActive ? '#FAF9F7' : hoveredItem === item.id ? '#8B9B99' : '#5A6B69',
                  textShadow: isActive ? '0 0 12px rgba(155,171,169,0.4), 0 0 25px rgba(155,171,169,0.15)' : 'none',
                  lineHeight: '1.2',
                  transition: 'color 0.2s ease-out, text-shadow 0.3s ease',
                }}
              >
                {item.label}
              </span>
            </button>
          );
        })}
        {/* Per-item glow above active word */}
        {navItems.map(item => {
          const span = navSpanRefs.current[item.id];
          const container = navContainerRef.current;
          if (!span || !container) return null;
          const cRect = container.getBoundingClientRect();
          const sRect = span.getBoundingClientRect();
          const centerX = sRect.left - cRect.left + sRect.width / 2 - 30;
          const isActive = view === item.id;
          const glowColor = 'rgba(255,255,255,0.12)';
          return (
            <div key={item.id + '-glow'} style={{
              position: 'absolute',
              top: '-8px',
              left: centerX + 'px',
              width: '60px',
              height: '30px',
              background: `radial-gradient(ellipse at center, ${glowColor} 0%, transparent 70%)`,
              borderRadius: '50%',
              pointerEvents: 'none',
              opacity: isActive ? 1 : 0,
              transition: 'opacity 0.35s ease',
            }}/>
          );
        })}
        {/* Sliding underline bar */}
        <div style={{
          position: 'absolute',
          bottom: '0',
          left: barStyle.left + 'px',
          width: barStyle.width + 'px',
          height: '3px',
          backgroundColor: view === 'retouching' ? 'rgba(216,175,76,0.5)' : 'rgba(90,107,105,0.5)',
          borderRadius: '1px',
          opacity: barReady ? 1 : 0,
          transition: (barInitialized.current ? 'left 0.35s cubic-bezier(0.4, 0, 0.2, 1), width 0.35s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.35s ease, ' : '') + 'opacity 0.25s ease',
          boxShadow: view === 'retouching' ? '0 0 6px rgba(216,175,76,0.4)' : '0 0 4px rgba(90,107,105,0.25)',
        }}/>
      </div>
    </header>
  );
};
