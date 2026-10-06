// Vue 3D dans la fenêtre de la carte (bascule SAT / 3D / MAP). Le moteur (three.js) n'est chargé
// qu'à l'ouverture. Les environs viennent de loadScene (cache partagé, sinon fonction serveur); les
// bâtiments dessinés s'affichent tout de suite, les voisins s'ajoutent quand ils arrivent.
// La légende dit toujours d'où vient ce qu'on regarde: condition de lumière (prévision) et hauteur de la forme
// en face (réglée dans le projet, mesurée Overture, par défaut).
import React, { useEffect, useRef, useState } from 'react';
import { loadScene } from './data.js';

const TOUCH = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(hover: none)').matches; // le rendu affiné est réservé aux ordinateurs
const BTN = { background: 'rgba(20,24,26,0.45)', border: '1px solid rgba(255,255,255,0.5)', borderRadius: '14px', padding: '5px 12px 3px', color: 'rgba(255,255,255,0.9)', fontSize: '13px', letterSpacing: '0.08em', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', cursor: 'pointer' };

export const Scene3D = ({ lat, lng, buildings, orientation, timeMs, weatherRow, visible, zoomRef }) => { // zoomRef.current(f) : les boutons + et - de la fenêtre
  const box = useRef(null);
  const eng = useRef(null);
  const [info, setInfo] = useState(null);
  const [status, setStatus] = useState(null); // { text, busy }: busy = anneau d'attente, sinon message seul (erreur)
  const [rt, setRt] = useState(false); // rendu affiné (lancer de rayons) à la demande

  useEffect(() => {
    if (!visible || !box.current || !lat || !lng) return;
    let cancelled = false;
    setStatus({ text: 'Chargement', busy: true });
    import('./engine.js').then(m => {
      if (cancelled || !box.current) return;
      const e = m.createScene3D(box.current, { onInfo: setInfo });
      eng.current = e; if (zoomRef) zoomRef.current = (f) => e.zoom(f);
      if (import.meta.env.DEV) window.__scene3d = e; // inspection en développement seulement
      e.setProject({ lat, lng, buildings, orientation });
      e.setTime(timeMs); e.setWeather(weatherRow); if (rt) e.setRayTracing(true);
      setStatus({ text: 'Environs en préparation', busy: true });
      loadScene(lat, lng).then(d => { if (!cancelled && eng.current === e) { e.setData(d); setStatus(null); } })
        .catch(err => { console.warn('[scene3d] environs indisponibles:', err); if (!cancelled) setStatus({ text: 'Environs indisponibles, bâtiments du projet seulement', busy: false }); });
    }).catch(err => { console.error('[scene3d] moteur:', err); if (!cancelled) setStatus({ text: 'La 3D ne peut pas s’afficher ici', busy: false }); });
    return () => { cancelled = true; if (zoomRef) zoomRef.current = null; if (eng.current) { eng.current.dispose(); eng.current = null; } };
  }, [visible, lat, lng]);
  useEffect(() => { if (eng.current) eng.current.setProject({ lat, lng, buildings, orientation }); }, [buildings, orientation]);
  useEffect(() => { if (eng.current) eng.current.setTime(timeMs); }, [timeMs]);
  useEffect(() => { if (eng.current) eng.current.setRayTracing(rt); }, [rt]);
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
        {info.height && <div style={{ opacity: 0.75 }}>{info.height}</div>}
        {info.rt && <div style={{ opacity: 0.75 }}>{info.rt}</div>}
        {info.srcLine && <div style={{ opacity: 0.6, fontSize: '11px' }}>{info.srcLine}</div>}
      </div>}
      {info && <svg style={{ position: 'absolute', right: '14px', bottom: '12px', width: '34px', height: '34px', pointerEvents: 'none' }} viewBox="0 0 34 34">
        <circle cx="17" cy="17" r="15" fill="rgba(20,24,26,.35)" stroke="rgba(255,255,255,.55)" strokeWidth="1"/>
        <g transform={`rotate(${(-info.northDeg).toFixed(1)} 17 17)`}><path d="M17 5 L20 17 L17 15.5 L14 17 Z" fill="#fff"/><path d="M17 29 L20 17 L17 18.5 L14 17 Z" fill="rgba(255,255,255,.35)"/></g>
      </svg>}
      {!TOUCH && <button className="font-bebas-book" onClick={() => setRt(v => !v)} style={{ ...BTN, position: 'absolute', right: '58px', bottom: '14px', background: rt ? 'rgba(255,255,255,0.85)' : BTN.background, color: rt ? '#23282b' : BTN.color }}>RENDU AFFINÉ</button>}
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
