import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useLang } from '../i18n/LangProvider.jsx';
import { getCurrentPosition } from '../native/geolocation.js';
import { useStore } from '../projects/StoreProvider.jsx';
import { SKY_CHOICES, nearestProject, saveSkyReport } from '../weather/skyReports.js';

// Témoin du ciel: photo, ce que le photographe voit (un toucher), position et projet rattaché. Ouvert depuis la carte
// météo actuelle (iPhone), à côté du + (ordinateur, iPad) ou depuis la fiche d'un projet (project donné: rattachement fixe).
// Nouvelle interface: typo système (SF Pro), corps 16 px graisse 400, étiquettes 600.
const FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif";
const ACCENT = '#7dd3c6';
const SKY_KEYS = { clear: 'skyClear', clouds: 'skyClouds', overcast: 'skyOvercast', fog: 'skyFog', rain: 'skyRain', snow: 'skySnow' };

// Appareil photo (tracé de Lucide)
export const CameraIcon = ({ size = 20, color = 'currentColor', style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true">
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>
  </svg>
);

export const SkyReportSheet = ({ open, onClose, project = null }) => {
  const { t } = useLang();
  const { projects } = useStore();
  const isMobile = useIsMobile();
  const [pos, setPos] = useState(null);           // { lat, lng, accuracy }
  const [posState, setPosState] = useState('locating');
  const [sky, setSky] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState(null);
  const [state, setState] = useState('idle');      // idle | saving | saved | error
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setSky(null); setPhoto(null); setPreview(null); setState('idle'); setPos(null); setPosState('locating');
    let alive = true;
    getCurrentPosition({ enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 })
      .then((p) => { if (alive) { setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy != null ? Math.round(p.coords.accuracy) : null }); setPosState('ok'); } })
      .catch(() => {
        if (!alive) return;
        // Depuis une fiche, la position du projet sert à défaut (précision inconnue)
        if (project && project.lat != null) { setPos({ lat: project.lat, lng: project.lng, accuracy: null }); setPosState('ok'); }
        else setPosState('none');
      });
    return () => { alive = false; };
  }, [open, project]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  if (!open) return null;
  const linked = project || (pos ? nearestProject(projects, pos.lat, pos.lng) : null);
  const canSave = !!sky && !!pos && state !== 'saving' && state !== 'saved';

  const onPhoto = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    setPhoto(f); setPreview(URL.createObjectURL(f));
  };
  const save = async () => {
    if (!canSave) return;
    setState('saving');
    try {
      await saveSkyReport({ sky, photo, pos, projectId: linked ? linked.id : null });
      setState('saved');
      setTimeout(onClose, 1400);
    } catch (e) {
      console.error('Sky report error:', e);
      setState('error');
    }
  };

  const text = { fontFamily: FONT, fontSize: 16, fontWeight: 400, color: '#E8ECEB', lineHeight: 1.35 };
  const label = { fontFamily: FONT, fontSize: 13, fontWeight: 600, color: '#8B9B99', letterSpacing: '0.02em' };
  const choice = (selected) => ({ ...text, height: 48, borderRadius: 10, border: `1px solid ${selected ? ACCENT : 'rgba(255,255,255,0.14)'}`, background: selected ? 'rgba(125,211,198,0.10)' : 'rgba(255,255,255,0.03)', color: selected ? ACCENT : '#E8ECEB', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 });

  const panel = (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(10,12,12,0.72)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: isMobile ? 'stretch' : 'center', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('skyReport')} style={{ width: isMobile ? '100%' : 440, maxHeight: '100%', overflowY: 'auto', boxSizing: 'border-box', background: '#1b2020', borderRadius: isMobile ? 0 : 16, border: isMobile ? 'none' : '1px solid rgba(255,255,255,0.08)', padding: isMobile ? 'calc(20px + env(safe-area-inset-top)) 20px calc(24px + env(safe-area-inset-bottom))' : '22px 24px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif", fontSize: 22, fontWeight: 600, color: '#FAF9F7', margin: 0 }}>{t('skyReport')}</h2>
          <button type="button" onClick={onClose} aria-label={t('skyCancel')} style={{ background: 'none', border: 'none', padding: 6, margin: -6, cursor: 'pointer', color: '#8B9B99', display: 'flex' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>

        {/* Photo du ciel: appareil photo arrière du téléphone; sur ordinateur, choix d'un fichier */}
        <input ref={inputRef} type="file" accept="image/*" capture="environment" onChange={onPhoto} style={{ display: 'none' }}/>
        {preview ? (
          <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', height: 220, background: '#111' }}>
            <img src={preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}/>
            <button type="button" onClick={() => inputRef.current && inputRef.current.click()} style={{ ...text, fontSize: 15, position: 'absolute', right: 10, bottom: 10, height: 36, padding: '0 14px', borderRadius: 18, border: 'none', background: 'rgba(0,0,0,0.55)', color: '#FAF9F7', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>{t('skyRetake')}</button>
          </div>
        ) : (
          <button type="button" onClick={() => inputRef.current && inputRef.current.click()} style={{ ...text, height: 120, borderRadius: 12, border: '1px dashed rgba(255,255,255,0.22)', background: 'rgba(255,255,255,0.03)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <CameraIcon size={28} color="#8B9B99"/>
            <span>{t('skyTakePhoto')}</span>
          </button>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={label}>{t('skyWhat')}</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {SKY_CHOICES.map((k) => <button key={k} type="button" onClick={() => setSky(k)} aria-pressed={sky === k} style={choice(sky === k)}>{t(SKY_KEYS[k])}</button>)}
          </div>
        </div>

        <div style={{ ...text, fontSize: 15, color: '#8B9B99' }}>
          {posState === 'locating' ? t('skyLocating')
            : posState === 'none' ? t('skyNoPos')
            : linked ? <span>{t('skyProject')} <span style={{ color: '#E8ECEB' }}>{linked.name}</span></span>
            : t('skyNoProject')}
        </div>

        {state === 'error' && <div style={{ ...text, fontSize: 15, color: '#d83152' }}>{t('skyError')}</div>}

        <button type="button" onClick={save} disabled={!canSave} style={{ ...text, fontWeight: 600, height: 50, borderRadius: 12, border: 'none', cursor: canSave ? 'pointer' : 'default', background: state === 'saved' ? 'rgba(125,211,198,0.16)' : canSave ? ACCENT : 'rgba(255,255,255,0.08)', color: state === 'saved' ? ACCENT : canSave ? '#10201d' : 'rgba(255,255,255,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {state === 'saving' ? t('skySaving') : state === 'saved' ? t('skySaved') : t('skySave')}
        </button>
      </div>
    </div>
  );
  return ReactDOM.createPortal(panel, document.body);
};
