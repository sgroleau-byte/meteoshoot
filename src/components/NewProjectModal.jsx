import React, { useEffect, useRef, useState } from 'react';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useLang } from '../i18n/LangProvider.jsx';
import { geocodeAddress, getTravelTime } from '../maps/google.js';
import { MandateType } from '../projects/constants.js';
import { toggleMandate } from '../projects/helpers.js';
import { useStore } from '../projects/StoreProvider.jsx';
import { FolderCombo } from './pickers.jsx';

export const NewProjectModal = ({ isOpen, onClose, onCreated, origin, onOpen }) => {
  const { addProject, prefs } = useStore();
  const { t } = useLang();
  const [form, setForm] = useState({ name: '', address: '', lat: null, lng: null, mandates: [], orientation: [], isContest: false, clientFolder: '' });
  const [loading, setLoading] = useState(false);
  const [justCreated, setJustCreated] = useState(null);
  const [animated, setAnimated] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [winSize, setWinSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const addressInputRef = React.useRef(null);
  const nameInputRef = React.useRef(null);
  const autocompleteRef = React.useRef(null);
  const prevOpen = React.useRef(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    const onResize = () => setWinSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Animate open + reset form
  useEffect(() => {
    if (isOpen && !prevOpen.current) {
      setForm({ name: '', address: '', lat: null, lng: null, mandates: [], orientation: [], isContest: false, clientFolder: '' });
      if (addressInputRef.current) addressInputRef.current.value = '';
      autocompleteRef.current = null;
      requestAnimationFrame(() => requestAnimationFrame(() => setAnimated(true)));
      setTimeout(() => nameInputRef.current?.focus(), 500);
    }
    prevOpen.current = isOpen;
  }, [isOpen]);

  // Init Google Places when opening
  useEffect(() => {
    if (animated && addressInputRef.current && !autocompleteRef.current && window.google) {
      autocompleteRef.current = new google.maps.places.Autocomplete(addressInputRef.current, {
        types: ['establishment', 'geocode'],
        componentRestrictions: { country: 'ca' },
        fields: ['formatted_address', 'geometry', 'name']
      });
      autocompleteRef.current.addListener('place_changed', () => {
        const place = autocompleteRef.current.getPlace();
        if (place.geometry) {
          setForm(f => ({ ...f, address: place.formatted_address, lat: place.geometry.location.lat(), lng: place.geometry.location.lng() }));
        }
      });
    }
  }, [animated]);

  const handleClose = () => {
    setAnimated(false);
    setTimeout(() => onClose(), 600);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    setLoading(true);
    let data = { ...form };
    if (form.address && !form.lat) {
      try { const result = await geocodeAddress(form.address); data.lat = result.lat; data.lng = result.lng; data.address = result.formattedAddress; } catch (err) { console.warn('Geocoding error:', err); }
    }
    if (data.lat && data.lng && prefs.homeLat && prefs.homeLng) {
      try { const travel = await getTravelTime(prefs.homeLat, prefs.homeLng, data.lat, data.lng); data.travelTime = travel; data.departureAddress = prefs.homeAddress; data.departureLat = prefs.homeLat; data.departureLng = prefs.homeLng; } catch (err) { console.warn('Travel time error:', err); }
    }
    const result = addProject(data);
    setLoading(false);
    if (result && result.error === 'limit_reached') {
      setShowUpgradeModal(true);
      return;
    }
    handleClose();
  };

  // ===== MOBILE LAYOUT =====
  if (isMobile) {
    return (
      <React.Fragment>
        {/* Floating + button - desktop only, hidden on mobile (in nav bar) */}
        {!isOpen && !animated && !isMobile && (
          <button 
            onClick={onOpen}
            style={{ 
              position: 'fixed', zIndex: 51, bottom: '90px', right: '16px',
              width: '56px', height: '56px', borderRadius: '50%',
              background: '#E07A2B', color: '#fff', border: 'none',
              fontSize: '32px', lineHeight: '1', cursor: 'pointer',
              boxShadow: '0 4px 20px rgba(224,122,43,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
          >+</button>
        )}

        {/* Full-screen modal */}
        {(isOpen || animated) && (
          <div 
            className={`newproj-overlay ${animated ? 'open' : ''}`}
            style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', padding: '24px', paddingTop: '80px' }}
            onClick={handleClose}
          >
            <div onClick={e => e.stopPropagation()} style={{ 
              border: '1px solid rgba(255,255,255,0.15)', 
              padding: '24px 20px',
              background: 'rgba(30,34,36,0.95)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              maxWidth: '400px', width: '100%', margin: '0 auto',
              opacity: animated ? 1 : 0,
              transform: animated ? 'translateY(0)' : 'translateY(20px)',
              transition: 'opacity 0.3s ease 0.15s, transform 0.3s ease 0.15s'
            }}>
              <div className="mb-5">
                <label className="newproj-label font-bebas-book">{t('projectName')}</label>
                <input ref={nameInputRef} type="text" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false" data-1p-ignore="true" data-lpignore="true" data-form-type="other" value={form.name} onChange={e => setForm({...form, name: e.target.value.toUpperCase()})} onKeyDown={e => e.key === 'Enter' && handleSubmit()} placeholder={t('projectNamePlaceholder')} style={{ background: 'transparent', position: 'relative', zIndex: 2, border: '1px solid rgba(255,255,255,0.15)', padding: '10px 12px', color: 'rgba(255,255,255,0.85)', width: '100%', outline: 'none', fontSize: '15px' }}/>
              </div>
              <div className="mb-5">
                <label className="newproj-label font-bebas-book">{t('projectAddress')}</label>
                <input ref={addressInputRef} type="text" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false" data-1p-ignore="true" data-lpignore="true" data-form-type="other" defaultValue={form.address} placeholder={t('enterAddress')} style={{ background: 'transparent', position: 'relative', zIndex: 2, border: '1px solid rgba(255,255,255,0.15)', padding: '10px 12px', color: 'rgba(255,255,255,0.85)', width: '100%', outline: 'none', fontSize: '15px' }}/>
              </div>
              <div className="mb-5">
                <label className="newproj-label font-bebas-book">MANDAT</label>
                <div className="flex gap-4 flex-wrap">
                  {Object.values(MandateType).map(m => (
                    <button key={m} type="button" onClick={() => setForm({...form, mandates: toggleMandate(form.mandates, m)})} className={`newproj-toggle font-bebas-bold ${form.mandates.includes(m) ? 'active' : ''}`} style={form.mandates.includes(m) && m === 'DRONE+C' ? {} : {}}>{m === 'DRONE+C' ? (form.mandates.includes(m) ? React.createElement('span', null, 'DRONE.', React.createElement('span', {style:{color:'#d83152'}}, 'C')) : 'DRONE.C') : m}</button>
                  ))}
                </div>
              </div>
              <div className="mb-6">
                <label className="newproj-label font-bebas-book">ORIENTATION</label>
                <div className="flex gap-4">
                  {['AM','PM'].map(o => (
                    <button key={o} type="button" onClick={() => setForm({...form, orientation: form.orientation.includes(o) ? form.orientation.filter(x => x !== o) : [...form.orientation, o]})} className={`newproj-toggle font-bebas-bold ${form.orientation.includes(o) ? 'active' : ''}`}>{o}</button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <button onClick={handleSubmit} disabled={loading || !form.name.trim()} className="font-bebas-bold" style={{ letterSpacing: '0.04em', fontSize: '18px', color: !form.name.trim() ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.6)', background: 'none', border: 'none', cursor: 'pointer' }}>{loading ? 'CRÉATION...' : t('added')}</button>
                <div style={{ width: '1px', height: '18px', background: 'rgba(255,255,255,0.15)' }}/>
                <button onClick={handleClose} className="font-bebas-bold" style={{ letterSpacing: '0.04em', fontSize: '18px', color: 'rgba(255,255,255,0.6)', background: 'none', border: 'none', cursor: 'pointer' }}>{t('cancel')}</button>
              </div>
            </div>
          </div>
        )}
      </React.Fragment>
    );
  }

  // ===== DESKTOP LAYOUT (original) =====
  // Panel: centered on screen
  const panelW = 560;
  const panelH = 485; // +75 pour loger la ligne DOSSIER sous ORIENTATION sans chevaucher CRÉER/ANNULER
  const panelX = (winSize.w - panelW) / 2 + 60;
  const panelY = (winSize.h - panelH) / 2;

  // + big position center
  const plusSize = 900;
  const plusBaseX = panelX - plusSize * 0.45 + 275 - 125 + 25;
  const plusBaseY = panelY + panelH / 2 - plusSize * 0.38 + 113.5;
  const plusCX = plusBaseX + plusSize * 0.10;
  const plusCY = plusBaseY + plusSize * 0.32;

  return (
    <React.Fragment>
      {/* Overlay - only when open */}
      {(isOpen || animated) && <div className={`newproj-overlay ${animated ? 'open' : ''}`} onClick={handleClose}/>}

      {/* The + : always visible, small when idle, big when open */}
      <span 
        className="font-bebas-regular" 
        onClick={!isOpen && !animated ? onOpen : undefined}
        style={{ 
          position: 'fixed', zIndex: 61, lineHeight: '0.8', cursor: !animated ? 'pointer' : 'default',
          left: animated ? plusCX : (origin ? origin.x : 0), 
          top: animated ? plusCY : (origin ? origin.y : 0), 
          fontSize: animated ? '900px' : '110px',
          transform: animated ? 'translate(-50%, -50%) rotate(90deg)' : 'none',
          filter: animated ? 'blur(3px)' : 'blur(0px)',
          color: animated ? 'rgba(255,255,255,0.25)' : 'var(--text-primary)',
          transition: 'left 0.55s cubic-bezier(0.16, 1, 0.3, 1), top 0.55s cubic-bezier(0.16, 1, 0.3, 1), font-size 0.55s cubic-bezier(0.16, 1, 0.3, 1), transform 0.55s cubic-bezier(0.16, 1, 0.3, 1), filter 0.55s cubic-bezier(0.16, 1, 0.3, 1), color 0.3s ease'
        }}
      >+</span>

      {/* Blur zone + Panel + Actions: only when open */}
      {(isOpen || animated) && (
        <React.Fragment>
          <div className={`newproj-plusblur ${animated ? 'open' : ''}`} style={{ left: panelX, top: panelY, width: panelW, height: panelH }}/>

          <div className={`newproj-panel ${animated ? 'open' : ''}`} style={{ left: panelX, top: panelY, width: panelW, padding: '28px 32px' }} onClick={e => e.stopPropagation()}>
            <div className="mb-5">
              <label className="newproj-label font-bebas-book">{t('projectName')}</label>
              <input ref={nameInputRef} type="text" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false" data-1p-ignore="true" data-lpignore="true" data-form-type="other" value={form.name} onChange={e => setForm({...form, name: e.target.value.toUpperCase()})} onKeyDown={e => e.key === 'Enter' && handleSubmit()} placeholder={t('projectNamePlaceholder')}/>
            </div>
            <div className="mb-5">
              <label className="newproj-label font-bebas-book">{t('projectAddress')}</label>
              <input ref={addressInputRef} type="text" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false" data-1p-ignore="true" data-lpignore="true" data-form-type="other" defaultValue={form.address} placeholder={t('enterAddress')}/>
            </div>
            <div className="mb-5">
              <label className="newproj-label font-bebas-book">MANDAT</label>
              <div className="flex gap-5">
                {Object.values(MandateType).map(m => (
                  <button key={m} type="button" onClick={() => setForm({...form, mandates: toggleMandate(form.mandates, m)})} className={`newproj-toggle font-bebas-bold ${form.mandates.includes(m) ? 'active' : ''}`} style={form.mandates.includes(m) && m === 'DRONE+C' ? {} : {}}>{m === 'DRONE+C' ? (form.mandates.includes(m) ? React.createElement('span', null, 'DRONE.', React.createElement('span', {style:{color:'#d83152'}}, 'C')) : 'DRONE.C') : m}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="newproj-label font-bebas-book">ORIENTATION</label>
              <div className="flex gap-4">
                {['AM','PM'].map(o => (
                  <button key={o} type="button" onClick={() => setForm({...form, orientation: form.orientation.includes(o) ? form.orientation.filter(x => x !== o) : [...form.orientation, o]})} className={`newproj-toggle font-bebas-bold ${form.orientation.includes(o) ? 'active' : ''}`}>{o}</button>
                ))}
              </div>
            </div>
            <div style={{ marginTop: '22px' }}>
              <FolderCombo value={form.clientFolder} onChange={(v) => setForm(f => ({ ...f, clientFolder: v }))}/>
            </div>
          </div>

          <div className={`newproj-actions ${animated ? 'open' : ''}`} style={{ left: panelX, top: panelY + panelH + 14 }}>
            <div className="flex items-end">
              <button onClick={handleSubmit} disabled={loading || !form.name.trim()} className="font-bebas-bold">{loading ? 'CRÉATION...' : t('added')}</button>
              <div style={{ width: '1px', background: 'rgba(255,255,255,0.15)', alignSelf: 'stretch', marginLeft: '20px', marginRight: '20px', marginTop: '-9px' }}/>
              <button onClick={handleClose} className="font-bebas-bold">{t('cancel')}</button>
              {justCreated && <span className="font-bebas-bold" style={{ letterSpacing: '0.04em', fontSize: '14px', color: 'rgba(255,255,255,0.4)', marginLeft: '16px' }}>✓ {justCreated} {t('added')}</span>}
            </div>
          </div>
        </React.Fragment>
      )}
    </React.Fragment>
  );
};
