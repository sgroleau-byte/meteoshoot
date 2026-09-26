import React, { useEffect, useRef, useState } from 'react';
import { useLang } from '../i18n/LangProvider.jsx';
import { geocodeAddress, getTravelTime } from '../maps/google.js';
import { MandateType } from '../projects/constants.js';
import { toggleMandate } from '../projects/helpers.js';
import { useStore } from '../projects/StoreProvider.jsx';
import { UpgradeModal } from '../subscription/UpgradeModal.jsx';
import { FolderCombo } from './pickers.jsx';

// === Mobile New Project Screen (slides in from right) ===
export const MobileNewProjectScreen = ({ isOpen, onClose, onCreated }) => {
  const { addProject, prefs } = useStore();
  const { t } = useLang();
  const [form, setForm] = useState({ name: '', address: '', lat: null, lng: null, mandates: [], orientation: [], isContest: false, clientFolder: '' });
  const [loading, setLoading] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const addressInputRef = React.useRef(null);
  const nameInputRef = React.useRef(null);
  const autocompleteRef = React.useRef(null);
  const prevOpen = React.useRef(false);

  // Reset form when opening
  useEffect(() => {
    if (isOpen && !prevOpen.current) {
      setForm({ name: '', address: '', lat: null, lng: null, mandates: [], orientation: [], isContest: false, clientFolder: '' });
      if (addressInputRef.current) addressInputRef.current.value = '';
      autocompleteRef.current = null;
      setTimeout(() => nameInputRef.current?.focus(), 500);
    }
    prevOpen.current = isOpen;
  }, [isOpen]);

  // Init Google Places
  useEffect(() => {
    if (isOpen && addressInputRef.current && !autocompleteRef.current && window.google) {
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
  }, [isOpen]);

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
    onCreated();
  };

  const inputStyle = { background: 'transparent', position: 'relative', zIndex: 2, border: '1px solid rgba(255,255,255,0.15)', padding: '12px 14px', color: 'rgba(255,255,255,0.85)', width: '100%', outline: 'none', fontSize: '16px', borderRadius: '8px' };

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: '100%',
      background: '#1e2224',
      zIndex: 50,
      transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
      transition: 'transform 0.4s cubic-bezier(0.32, 0.72, 0, 1)',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)',
      paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 100px)',
      paddingLeft: '20px',
      paddingRight: '20px'
    }}>
      {/* Back button */}
      <button onClick={onClose} style={{ 
        background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', 
        fontSize: '16px', padding: '8px 0', marginBottom: '24px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: '6px'
      }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        <span className="font-bebas-book" style={{ fontSize: '18px', letterSpacing: '0.05em' }}>RETOUR</span>
      </button>

      <h2 className="font-bebas-bold" style={{ letterSpacing: '0.04em', fontSize: '28px', color: 'rgba(255,255,255,0.85)', marginBottom: '32px' }}>{t('newProject')}</h2>

      <div style={{ marginBottom: '24px' }}>
        <label className="newproj-label font-bebas-book">{t('projectName')}</label>
        <input ref={nameInputRef} type="search" autoComplete="one-time-code" autoCorrect="off" autoCapitalize="characters" spellCheck="false" data-1p-ignore="true" data-lpignore="true" data-form-type="other" name="projectname_notafield" enterKeyHint="done" value={form.name} onChange={e => setForm({...form, name: e.target.value.toUpperCase()})} onKeyDown={e => { if (e.key === 'Enter') { e.target.blur(); handleSubmit(); } }} placeholder={t('projectNamePlaceholder')} style={inputStyle}/>
      </div>

      <div style={{ marginBottom: '24px' }}>
        <label className="newproj-label font-bebas-book">{t('projectAddress')}</label>
        <input ref={addressInputRef} type="search" autoComplete="one-time-code" autoCorrect="off" autoCapitalize="off" spellCheck="false" data-1p-ignore="true" data-lpignore="true" data-form-type="other" name="projectaddr_notafield" enterKeyHint="done" defaultValue={form.address} placeholder={t('enterAddress')} style={inputStyle}/>
      </div>

      <div style={{ marginBottom: '24px' }}>
        <label className="newproj-label font-bebas-book">MANDAT</label>
        <div className="flex gap-3 flex-wrap">
          {Object.values(MandateType).map(m => (
            <button key={m} type="button" onClick={() => setForm({...form, mandates: toggleMandate(form.mandates, m)})} className={`newproj-toggle font-bebas-bold ${form.mandates.includes(m) ? 'active' : ''}`} style={form.mandates.includes(m) && m === 'DRONE+C' ? {} : {}}>{m === 'DRONE+C' ? (form.mandates.includes(m) ? React.createElement('span', null, 'DRONE.', React.createElement('span', {style:{color:'#d83152'}}, 'C')) : 'DRONE.C') : m}</button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: '32px' }}>
        <label className="newproj-label font-bebas-book">ORIENTATION</label>
        <div className="flex gap-3">
          {['AM','PM'].map(o => (
            <button key={o} type="button" onClick={() => setForm({...form, orientation: form.orientation.includes(o) ? form.orientation.filter(x => x !== o) : [...form.orientation, o]})} className={`newproj-toggle font-bebas-bold ${form.orientation.includes(o) ? 'active' : ''}`}>{o}</button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: '32px' }}>
        <FolderCombo value={form.clientFolder} onChange={(v) => setForm(f => ({ ...f, clientFolder: v }))}/>
      </div>

      <div style={{ display: 'flex', gap: '24px', alignItems: 'center', marginTop: '8px' }}>
        <button onClick={handleSubmit} disabled={loading || !form.name.trim()} className="font-bebas-bold" style={{
          background: 'none', border: 'none', padding: '8px 0',
          color: !form.name.trim() ? 'rgba(255,255,255,0.2)' : '#FAF9F7',
          fontSize: '20px', cursor: 'pointer', letterSpacing: '0.05em',
          textShadow: form.name.trim() ? '0 0 12px rgba(255,255,255,0.3)' : 'none',
          transition: 'color 0.2s, text-shadow 0.2s'
        }}>{loading ? 'CRÉATION...' : t('added')}</button>
        <button onClick={onClose} className="font-bebas-bold" style={{
          background: 'none', border: 'none', padding: '8px 0',
          color: '#FAF9F7', fontSize: '20px', cursor: 'pointer', letterSpacing: '0.05em'
        }}>{t('cancel')}</button>
      </div>
      <UpgradeModal isOpen={showUpgradeModal} onClose={() => setShowUpgradeModal(false)} />
    </div>
  );
};
