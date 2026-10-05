// Vue 3D dans la fenêtre de la carte (bascule SAT / 3D / MAP). Le moteur (three.js) n'est chargé
// qu'à l'ouverture. Les environs viennent de loadScene (cache partagé, sinon fonction serveur); les
// bâtiments dessinés s'affichent tout de suite, les voisins s'ajoutent quand ils arrivent.
import React, { useEffect, useRef, useState } from 'react';
import { loadScene } from './data.js';

export const Scene3D = ({ lat, lng, buildings, orientation, style, timeMs, weatherRow, visible, onAnalyze }) => {
  const box = useRef(null);
  const eng = useRef(null);
  const [info, setInfo] = useState(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!visible || !box.current || !lat || !lng) return;
    let cancelled = false;
    setStatus('Chargement de la 3D');
    import('./engine.js').then(m => {
      if (cancelled || !box.current) return;
      const e = m.createScene3D(box.current, { onInfo: setInfo });
      eng.current = e;
      if (import.meta.env.DEV) window.__scene3d = e; // inspection en développement seulement
      e.setProject({ lat, lng, buildings, orientation, style });
      e.setTime(timeMs); e.setWeather(weatherRow);
      setStatus('Environs en cours de chargement');
      loadScene(lat, lng).then(d => { if (!cancelled && eng.current === e) { e.setData(d); setStatus(''); } })
        .catch(err => { console.warn('[scene3d] environs indisponibles:', err); if (!cancelled) setStatus('Environs indisponibles, bâtiments du projet seulement'); });
    }).catch(err => { console.error('[scene3d] moteur:', err); if (!cancelled) setStatus('La 3D ne peut pas s’afficher ici'); });
    return () => { cancelled = true; if (eng.current) { eng.current.dispose(); eng.current = null; } };
  }, [visible, lat, lng]);
  useEffect(() => { if (eng.current) eng.current.setProject({ lat, lng, buildings, orientation, style }); }, [buildings, orientation, style]);
  useEffect(() => { if (eng.current) eng.current.setTime(timeMs); }, [timeMs]);
  useEffect(() => { if (eng.current) eng.current.setWeather(weatherRow); }, [weatherRow?.time, weatherRow?.cloudLow, weatherRow?.cloudMid, weatherRow?.cloudHigh, weatherRow?.sunFraction]);

  if (!visible) return null;
  const color = info?.light === false ? '#23282b' : '#f4f4f2';
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 6, background: '#202427', overflow: 'hidden' }}>
      <div ref={box} style={{ position: 'absolute', inset: 0 }}/>
      {info && <div style={{ position: 'absolute', left: '14px', bottom: '12px', fontSize: '12px', lineHeight: '1.45', color, pointerEvents: 'none', textShadow: info.light ? '0 1px 2px rgba(0,0,0,0.35)' : 'none' }}>
        <div>{info.cond}</div>
        {info.parts && <div style={{ opacity: 0.8 }}>{info.parts}</div>}
        <div style={{ opacity: 0.75 }}>{info.where}</div>
      </div>}
      {info && <svg style={{ position: 'absolute', right: '14px', bottom: '12px', width: '34px', height: '34px', pointerEvents: 'none' }} viewBox="0 0 34 34">
        <circle cx="17" cy="17" r="15" fill="rgba(20,24,26,.35)" stroke="rgba(255,255,255,.55)" strokeWidth="1"/>
        <g transform={`rotate(${(-info.northDeg).toFixed(1)} 17 17)`}><path d="M17 5 L20 17 L17 15.5 L14 17 Z" fill="#fff"/><path d="M17 29 L20 17 L17 18.5 L14 17 Z" fill="rgba(255,255,255,.35)"/></g>
      </svg>}
      {onAnalyze && <button className="font-bebas-book" disabled={busy} onClick={async () => { setBusy(true); setNote(''); try { await onAnalyze(); setNote('Style mis à jour d’après les images'); } catch (err) { setNote(String(err && err.message || err)); } finally { setBusy(false); setTimeout(() => setNote(''), 6000); } }}
        style={{ position: 'absolute', right: '58px', bottom: '14px', background: 'rgba(20,24,26,0.45)', border: '1px solid rgba(255,255,255,0.5)', borderRadius: '14px', padding: '5px 12px 3px', color: 'rgba(255,255,255,0.9)', fontSize: '13px', letterSpacing: '0.08em', cursor: busy ? 'default' : 'pointer', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}>
        {busy ? 'ANALYSE EN COURS' : style ? 'RÉANALYSER LES IMAGES' : 'ANALYSER LES IMAGES'}</button>}
      {note && <div className="font-bebas-book" style={{ position: 'absolute', right: '58px', bottom: '48px', fontSize: '13px', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.85)', background: 'rgba(20,24,26,0.5)', padding: '4px 10px 2px', borderRadius: '10px', pointerEvents: 'none' }}>{note.toUpperCase()}</div>}
      {status && <div className="font-bebas-book" style={{ position: 'absolute', top: '50%', left: 0, right: 0, textAlign: 'center', fontSize: '15px', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.75)', pointerEvents: 'none' }}>{status.toUpperCase()}</div>}
    </div>
  );
};
