import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useLang } from '../i18n/LangProvider.jsx';
import { useStore } from '../projects/StoreProvider.jsx';

// iOS-style date wheel picker
export const MONTHS_FR = ['JAN','FÉV','MAR','AVR','MAI','JUN','JUL','AOÛ','SEP','OCT','NOV','DÉC'];

// Draggable wheel column
export const WheelColumn = ({ items, selected, onSelect, width, renderItem }) => {
  const ref = useRef(null);
  const itemH = 40;
  const state = useRef({ dragging: false, startY: 0, startScroll: 0, lastY: 0, lastT: 0, vel: 0 });
  
  useEffect(() => {
    if (ref.current) ref.current.scrollTo({ top: items.indexOf(selected) * itemH, behavior: 'smooth' });
  }, []);
  
  const snapAndSelect = () => {
    if (!ref.current) return;
    const idx = Math.round(ref.current.scrollTop / itemH);
    const clamped = Math.max(0, Math.min(idx, items.length - 1));
    ref.current.style.scrollSnapType = 'y mandatory';
    ref.current.scrollTo({ top: clamped * itemH, behavior: 'smooth' });
    if (items[clamped] !== selected) onSelect(items[clamped]);
  };
  
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const s = state.current;
    
    const getY = (e) => e.touches ? e.touches[0].clientY : e.clientY;
    
    const onDown = (e) => {
      s.dragging = true;
      s.startY = getY(e);
      s.startScroll = el.scrollTop;
      s.lastY = s.startY;
      s.lastT = Date.now();
      s.vel = 0;
      el.style.scrollSnapType = 'none';
      if (!e.touches) e.preventDefault();
    };
    const onMove = (e) => {
      if (!s.dragging) return;
      const y = getY(e);
      const now = Date.now();
      const dt = now - s.lastT;
      if (dt > 0) s.vel = (s.lastY - y) / dt;
      s.lastY = y; s.lastT = now;
      el.scrollTop = s.startScroll - (y - s.startY);
      // Live update
      const idx = Math.round(el.scrollTop / itemH);
      const clamped = Math.max(0, Math.min(idx, items.length - 1));
      if (items[clamped] !== selected) onSelect(items[clamped]);
    };
    const onUp = () => {
      if (!s.dragging) return;
      s.dragging = false;
      if (Math.abs(s.vel) > 0.3) {
        const target = el.scrollTop + s.vel * 120;
        el.scrollTop = target;
      }
      snapAndSelect();
    };
    
    el.addEventListener('mousedown', onDown);
    el.addEventListener('touchstart', onDown, { passive: true });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
    return () => {
      el.removeEventListener('mousedown', onDown);
      el.removeEventListener('touchstart', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
    };
  }, [items, selected]);
  
  return (
    <div ref={ref}
      style={{ height: itemH * 3, overflow: 'auto', scrollSnapType: 'y mandatory', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', width, cursor: 'grab', userSelect: 'none' }}>
      <div style={{ height: itemH }}/>
      {items.map((item, i) => (
        <div key={i} style={{
          height: itemH, display: 'flex', alignItems: 'center', justifyContent: 'center',
          scrollSnapAlign: 'center', fontSize: item === selected ? '22px' : '17px',
          color: item === selected ? '#ffffff' : 'rgba(255,255,255,0.3)',
          fontFamily: 'BebasNeue-Bold, sans-serif', letterSpacing: '0.05em',
          transition: 'color 0.15s, font-size 0.15s', pointerEvents: 'none'
        }}>{renderItem ? renderItem(item) : item}</div>
      ))}
      <div style={{ height: itemH }}/>
    </div>
  );
};

// ===== Champ DOSSIER (combo réutilisable) =====
// Utilisé tel quel par le formulaire d'ajout (value='') et le détail projet
// (value=project.clientFolder). Deux modes: sélection (menu déroulant custom des dossiers
// existants) et création (saisie texte). Le + bascule vers la création; en création il pivote
// en × pour revenir à la sélection. Un dossier n'est qu'une valeur texte portée par un projet:
// taper un nom ne crée rien tout de suite, il est matérialisé au CRÉER / à l'updateProject.
export const useExistingFolders = () => {
  const { projects } = useStore();
  return React.useMemo(() => {
    const seen = new Set(), out = [];
    for (const p of projects) {
      const f = (p.clientFolder || '').trim();
      if (f && !seen.has(f)) { seen.add(f); out.push(f); }
    }
    return out; // dans l'ordre de première apparition (≈ ordre d'ajout)
  }, [projects]);
};

export const FolderCombo = ({ value, onChange }) => {
  const folders = useExistingFolders();
  const noFolders = folders.length === 0;
  const [mode, setMode] = useState(() => noFolders ? 'create' : 'select');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [menuRect, setMenuRect] = useState(null);
  const rootRef = useRef(null);
  const fieldRef = useRef(null);
  const inputRef = useRef(null);
  const isCreate = mode === 'create';

  // Menu en position fixe (portail): on le ferme au clic dehors et au scroll, sinon il
  // se détacherait du champ.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e) => {
      if (rootRef.current && rootRef.current.contains(e.target)) return;
      const menu = document.getElementById('folder-menu-portal');
      if (menu && menu.contains(e.target)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDocDown);
    window.addEventListener('scroll', onScroll, true);
    return () => { document.removeEventListener('mousedown', onDocDown); window.removeEventListener('scroll', onScroll, true); };
  }, [open]);

  const openMenu = () => {
    if (fieldRef.current) {
      const r = fieldRef.current.getBoundingClientRect();
      setMenuRect({ top: r.bottom + 2, left: r.left, width: r.width });
    }
    setOpen(true);
  };
  const toCreate = () => { setOpen(false); setMode('create'); setDraft(''); setTimeout(() => inputRef.current && inputRef.current.focus(), 0); };
  const toSelect = () => { setMode('select'); setDraft(''); };
  const commitDraft = () => { const v = draft.trim(); if (v) onChange(v); if (!noFolders) setMode('select'); };
  const pick = (f) => { onChange(f); setOpen(false); };

  return (
    <div ref={rootRef} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'relative', top: '1px', flexShrink: 0 }} aria-hidden="true">
        <path d="M3 7.2c0-.83.67-1.5 1.5-1.5h4.05l1.8 1.9h8.15c.83 0 1.5.67 1.5 1.5v8.2c0 .83-.67 1.5-1.5 1.5h-15.5c-.83 0-1.5-.67-1.5-1.5V7.2Z"/>
      </svg>
      <div ref={fieldRef} style={{ position: 'relative', flex: 1, minWidth: 0, border: '1px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center' }}>
        {isCreate ? (
          <input ref={inputRef} type="text" value={draft}
            autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck="false"
            data-1p-ignore="true" data-lpignore="true" data-form-type="other"
            onChange={(e) => setDraft(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitDraft(); } else if (e.key === 'Escape' && !noFolders) { toSelect(); } }}
            onBlur={commitDraft}
            placeholder="NOM DU DOSSIER"
            className="font-bebas-book"
            style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: '#ffffff', padding: '9px 44px 9px 12px', fontSize: '17px', letterSpacing: '0.05em' }}
          />
        ) : (
          <div onClick={openMenu} className="font-bebas-book"
            style={{ flex: 1, minWidth: 0, cursor: 'pointer', padding: '9px 44px 9px 12px', fontSize: '17px', letterSpacing: '0.05em', color: value ? '#ffffff' : 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {value || 'DOSSIER'}
          </div>
        )}
        <button type="button" onClick={isCreate ? toSelect : toCreate}
          aria-label={isCreate ? 'Choisir un dossier existant' : 'Créer un nouveau dossier'}
          style={{ position: 'absolute', top: 0, right: 0, height: '100%', width: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          <span style={{ display: 'inline-block', fontSize: '24px', lineHeight: 1, fontWeight: 200, color: '#ffffff', transform: isCreate ? 'rotate(45deg)' : 'none', transition: 'transform 0.2s ease', position: 'relative', top: '-1px' }}>+</span>
        </button>
      </div>
      {open && !isCreate && menuRect && ReactDOM.createPortal(
        <div id="folder-menu-portal" style={{ position: 'fixed', top: menuRect.top, left: menuRect.left, width: menuRect.width, zIndex: 9999, background: 'rgba(20,24,27,0.97)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.15)', maxHeight: '240px', overflowY: 'auto' }}>
          {value && (
            <div onClick={() => pick('')} className="font-bebas-book folder-option"
              style={{ padding: '9px 12px', fontSize: '15px', letterSpacing: '0.05em', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>AUCUN</div>
          )}
          {folders.map((f) => (
            <div key={f} onClick={() => pick(f)} className="font-bebas-book folder-option"
              style={{ padding: '9px 12px', fontSize: '17px', letterSpacing: '0.05em', cursor: 'pointer', color: f === value ? '#ffffff' : 'rgba(255,255,255,0.45)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f}</div>
          ))}
        </div>, document.body)}
    </div>
  );
};

export const DateWheelPicker = ({ date, onChange, onClose, onCancel, title, dropDown }) => {
  const { t } = useLang();
  const [selDay, setSelDay] = useState(date.getDate());
  const [selMonth, setSelMonth] = useState(date.getMonth());
  const [selYear, setSelYear] = useState(date.getFullYear());
  const originalDate = useRef(new Date(date));
  const itemH = 40;
  
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);
  const daysInMonth = new Date(selYear, selMonth + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  
  useEffect(() => {
    const d = Math.min(selDay, daysInMonth);
    const newDate = new Date(selYear, selMonth, d);
    onChange(newDate);
  }, [selDay, selMonth, selYear]);
  
  const resetToday = () => { onChange(new Date()); onClose(); };
  const handleCancel = () => { if (onCancel) onCancel(originalDate.current); onClose(); };
  
  const leftBtn = onCancel
    ? { label: t('cancel'), action: handleCancel, color: 'rgba(255,255,255,0.4)' }
    : { label: t('today'), action: resetToday, color: '#7dd3c6' };
  
  const posStyle = dropDown
    ? { position: 'relative', width: '100%', maxWidth: '350px', zIndex: 20, background: 'rgba(20,24,27,0.95)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderRadius: '16px', padding: '12px 0 18px' }
    : { position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '350px', zIndex: 20, background: 'rgba(20,24,27,0.7)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderRadius: '16px 16px 0 0', padding: '12px 0 18px' };

  // data-no-pull: faire tourner la roue vers le bas ne doit pas déclencher le rafraîchissement par glissement (App.jsx).
  return (
    <div style={posStyle} data-no-pull>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px 8px' }}>
        <button onClick={leftBtn.action} className="font-bebas-bold" style={{ background: 'none', border: 'none', color: leftBtn.color, fontSize: '20px', cursor: 'pointer', letterSpacing: '0.05em' }}>{leftBtn.label}</button>
        <span className="font-bebas-bold" style={{ fontSize: '16px', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.05em' }}>{title || t('sunDate')}</span>
        <button onClick={onClose} className="font-bebas-bold" style={{ background: 'none', border: 'none', color: '#FAF9F7', fontSize: '20px', cursor: 'pointer', letterSpacing: '0.05em', textShadow: '0 0 12px rgba(255,255,255,0.4), 0 0 25px rgba(255,255,255,0.15)' }}>OK</button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', position: 'relative' }}>
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: '300px', height: itemH, background: 'rgba(255,255,255,0.08)', borderRadius: '10px', pointerEvents: 'none' }}/>
        <WheelColumn items={MONTHS_FR.map((_, i) => i)} selected={selMonth} onSelect={setSelMonth} width="100px" renderItem={(i) => t('monthAbbrev')[i]} />
        <WheelColumn items={days} selected={selDay} onSelect={setSelDay} width="60px" />
        <WheelColumn items={years} selected={selYear} onSelect={setSelYear} width="80px" />
      </div>
    </div>
  );
};
