import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useLang } from '../i18n/LangProvider.jsx';
import { geocodeAddress } from '../maps/google.js';
import { EDIT_LIST_DEFAULTS, getEditListPrefs } from '../projects/helpers.js';
import { useStore } from '../projects/StoreProvider.jsx';
import { useSubscription } from '../subscription/SubscriptionProvider.jsx';
import { UpgradeModal } from '../subscription/UpgradeModal.jsx';
import { getWeatherSim, setWeatherSim } from '../weather/api.js';

// Préférences de la liste Édition : champ numérique borné (pas de 5) et bascule OUI | NON.
export const EditPrefNumber = ({ label, value, min, max, step, fallback, unit, onChange }) => {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const clamp = (n) => Math.min(max, Math.max(min, n));
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
      <span className="font-bebas-regular text-charcoal-muted" style={{ fontSize: '16px', letterSpacing: '0.04em' }}>{label}</span>
      <div className="flex items-center gap-3" style={{ flexShrink: 0 }}>
        <div style={{ border: '1px solid rgba(255,255,255,0.15)', padding: '8px 12px', display: 'inline-block' }}>
          <input type="number" value={text} min={min} max={max} step={step}
            onChange={e => { setText(e.target.value); const n = parseInt(e.target.value, 10); if (!isNaN(n) && n >= min && n <= max && n !== value) onChange(n); }}
            onBlur={e => { const n = parseInt(e.target.value, 10); const v = isNaN(n) ? fallback : clamp(n); setText(String(v)); if (v !== value) onChange(v); }}
            className="bg-transparent text-charcoal" style={{ fontSize: '15px', outline: 'none', border: 'none', color: 'rgba(255,255,255,0.85)', width: '40px' }}/>
        </div>
        <span className="font-bebas-light text-charcoal-muted" style={{ letterSpacing: '0.04em', fontSize: '19px' }}>{unit}</span>
      </div>
    </div>
  );
};
export const EditPrefToggle = ({ label, value, onChange }) => {
  const { t } = useLang();
  const opt = (on, key) => <span onClick={() => onChange(on)} style={{ fontFamily: "'Bebas Neue', sans-serif", fontWeight: value === on ? 700 : 300, fontSize: '18px', letterSpacing: '0.04em', cursor: 'pointer', color: value === on ? '#ffffff' : 'rgba(255,255,255,0.3)' }}>{t(key)}</span>;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
      <span className="font-bebas-regular text-charcoal-muted" style={{ fontSize: '16px', letterSpacing: '0.04em' }}>{label}</span>
      <div className="flex items-center gap-4" style={{ flexShrink: 0 }}>{opt(true, 'yes')}<span style={{ color: 'rgba(255,255,255,0.15)' }}>|</span>{opt(false, 'no')}</div>
    </div>
  );
};

export const PreferencesView = () => {
  const { prefs, setPrefs } = useStore();
  const editPrefs = getEditListPrefs(prefs);
  const { user, signOut } = useAuth();
  const { tier, isActive, profile, isShooterUser } = useSubscription();
  const { t, lang, setLang } = useLang();
  const isMobile = useIsMobile();
  const [showUpgradePref, setShowUpgradePref] = useState(false);
  const [msg, setMsg] = useState(null);
  const homeInputRef = React.useRef(null);
  const autocompleteRef = React.useRef(null);

  // Setup Google Places Autocomplete for home address
  useEffect(() => {
    if (homeInputRef.current && !autocompleteRef.current && window.google) {
      autocompleteRef.current = new google.maps.places.Autocomplete(homeInputRef.current, {
        types: ['address'],
        componentRestrictions: { country: 'ca' },
        fields: ['formatted_address', 'geometry']
      });
      
      autocompleteRef.current.addListener('place_changed', async () => {
        const place = autocompleteRef.current.getPlace();
        if (place.geometry) {
          setPrefs({
            homeAddress: place.formatted_address,
            homeLat: place.geometry.location.lat(),
            homeLng: place.geometry.location.lng()
          });
          setMsg({ type: 'success', text: t('addressSaved') });
        }
      });
    }
  }, []);

  const saveHomeManual = async () => {
    const address = homeInputRef.current?.value;
    if (!address) return;
    
    try {
      const result = await geocodeAddress(address);
      setPrefs({
        homeAddress: result.formattedAddress,
        homeLat: result.lat,
        homeLng: result.lng
      });
      homeInputRef.current.value = result.formattedAddress;
      setMsg({ type: 'success', text: t('addressSavedShort') });
    } catch (e) {
      setMsg({ type: 'error', text: t('addressNotFound') });
    }
  };

  return (
    <div className="pb-8" style={{ paddingLeft: isMobile ? '0' : 'max(0px, calc((100vw - 1200px) / 2))', paddingTop: isMobile ? 'calc(16px + env(safe-area-inset-top))' : 'calc(100px + env(safe-area-inset-top))' }}>
      {!isMobile && <h1 className="font-bebas-bold" style={{ position: 'fixed', top: 'calc(7px + env(safe-area-inset-top))', left: '10px', fontSize: '24px', color: '#5a6b69', letterSpacing: '0.03em', zIndex: 5 }}>{t('preferences')}</h1>}
      <div className={isMobile ? 'px-4' : 'pl-8 md:pl-12'}>
        {msg && <div className={`mb-6 p-3 rounded ${msg.type === "success" ? "bg-transparent" : "bg-red-50 text-red-700"}`} style={msg.type === "success" ? { color: "#7dd3c6" } : {}}>{msg.text}</div>}
        <div>
          <div className="py-5 border-b border-adaptive">
            <label className="font-bebas-regular text-charcoal-muted" style={{ fontSize: '22px', letterSpacing: '0.04em' }}>{t('homeAddressLabel')}</label>
            <div style={{ border: '1px solid rgba(255,255,255,0.15)', padding: '8px 12px', marginTop: '8px', maxWidth: '600px' }}>
              <input
                ref={homeInputRef}
                type="text"
                defaultValue={prefs.homeAddress || ''}
                placeholder={t('homeAddressPlaceholder')} 
                className="w-full bg-transparent text-charcoal" style={{ fontSize: '15px', outline: 'none', border: 'none', color: 'rgba(255,255,255,0.85)' }}
              />
            </div>
            {prefs.homeLat && <p className="text-xs mt-2" style={{ color: "#7dd3c6" }}>✓ {prefs.homeAddress}</p>}
          </div>

          <div className="py-5 border-b border-adaptive">
            <label className="font-bebas-regular text-charcoal-muted" style={{ fontSize: '22px', letterSpacing: '0.04em' }}>{t('editListSection')}</label>
            <div style={{ marginTop: '10px', maxWidth: '600px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <EditPrefNumber label={t('editAlertLabel')} value={editPrefs.editAlertDays} min={5} max={90} step={5} fallback={EDIT_LIST_DEFAULTS.editAlertDays} unit={t('days')} onChange={v => setPrefs({ editAlertDays: v })}/>
              <EditPrefNumber label={t('editWarnLabel')} value={editPrefs.editWarnDays} min={0} max={60} step={5} fallback={EDIT_LIST_DEFAULTS.editWarnDays} unit={t('days')} onChange={v => setPrefs({ editWarnDays: v })}/>
              <EditPrefToggle label={t('editShowGaugeLabel')} value={editPrefs.editShowGauge} onChange={v => setPrefs({ editShowGauge: v })}/>
              <EditPrefToggle label={t('editShowThresholdLabel')} value={editPrefs.editShowThreshold} onChange={v => setPrefs({ editShowThreshold: v })}/>
              <EditPrefToggle label={t('editSortUrgencyLabel')} value={editPrefs.editSortUrgency} onChange={v => setPrefs({ editSortUrgency: v })}/>
            </div>
          </div>

          <div className="py-5 border-b border-adaptive">
            <label className="font-bebas-regular text-charcoal-muted" style={{ fontSize: '22px', letterSpacing: '0.04em' }}>{t('plan')}</label>
            <div style={{ marginTop: '8px', maxWidth: '600px' }}>
              <div className="flex items-center gap-3">
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: tier === 'shooter' ? '#E07A2B' : '#7dd3c6', boxShadow: tier === 'shooter' ? '0 0 6px rgba(224,122,43,0.5)' : '0 0 6px rgba(125,211,198,0.5)', flexShrink: 0 }}/>
                <span className="font-bebas-light" style={{ letterSpacing: '0.04em', fontSize: '18px', color: 'rgba(255,255,255,0.7)' }}>
                  {tier === 'free' ? t('freePlan') : tier === 'shooter' ? t('shooterPlan') : t('godPlan')}
                  {' | '}
                  {isActive ? t('active') : (profile?.subscription_status || '').toUpperCase()}
                </span>
              </div>
              {tier === 'free' && (
                <button onClick={() => setShowUpgradePref(true)} style={{
                  marginTop: '12px', background: 'none', border: '1px solid #E07A2B',
                  color: '#E07A2B', padding: '8px 20px', cursor: 'pointer',
                  fontFamily: "'Bebas Neue', sans-serif", fontWeight: 700, fontSize: '16px',
                  letterSpacing: '0.04em'
                }}>{t('upgradeToShooter')}</button>
              )}
              <a href="site/account.html" style={{
                display: 'inline-block', marginTop: '12px', marginLeft: tier === 'free' ? '16px' : '0',
                color: 'rgba(255,255,255,0.35)', fontSize: '14px',
                fontFamily: "'Bebas Neue', sans-serif", fontWeight: 300,
                letterSpacing: '0.04em', textDecoration: 'none'
              }}>{t('account')}</a>
            </div>
          </div>

          <div className="py-5 border-b border-adaptive">
            <label className="font-bebas-regular text-charcoal-muted" style={{ fontSize: '22px', letterSpacing: '0.04em' }}>{t('language')}</label>
            <div className="flex items-center gap-4" style={{ marginTop: '8px' }}>
              <span onClick={() => setLang('fr')} style={{
                fontFamily: "'Bebas Neue', sans-serif", fontWeight: lang === 'fr' ? 700 : 300,
                fontSize: '18px', letterSpacing: '0.04em', cursor: 'pointer',
                color: lang === 'fr' ? '#ffffff' : 'rgba(255,255,255,0.3)'
              }}>FR</span>
              <span style={{ color: 'rgba(255,255,255,0.15)' }}>|</span>
              <span onClick={() => setLang('en')} style={{
                fontFamily: "'Bebas Neue', sans-serif", fontWeight: lang === 'en' ? 700 : 300,
                fontSize: '18px', letterSpacing: '0.04em', cursor: 'pointer',
                color: lang === 'en' ? '#ffffff' : 'rgba(255,255,255,0.3)'
              }}>EN</span>
            </div>
          </div>

          <div className="py-5 border-b border-adaptive">
            <label className="font-bebas-regular text-charcoal-muted" style={{ fontSize: '22px', letterSpacing: '0.04em' }}>{t('weatherService')}</label>
            <div style={{ marginTop: '8px', maxWidth: '600px' }}>
              <div className="flex items-center gap-3">
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#7dd3c6', boxShadow: '0 0 6px rgba(125,211,198,0.5)', flexShrink: 0 }}/>
                <span className="font-bebas-light" style={{ letterSpacing: '0.04em', fontSize: '18px', color: 'rgba(255,255,255,0.7)' }}>OPEN-METEO | ICON (DWD) + GFS (NOAA)</span>
              </div>
              <div style={{ marginTop: '16px' }}>
                <label className="font-bebas-regular text-charcoal-muted" style={{ fontSize: '16px', letterSpacing: '0.04em' }}>{t('apiKeyLabel')}</label>
                <div style={{ border: '1px solid rgba(255,255,255,0.15)', padding: '8px 12px', marginTop: '4px' }}>
                  <input 
                    type="text" 
                    value={prefs.weatherApiKey || ''}
                    onChange={e => setPrefs({ weatherApiKey: e.target.value })}
                    placeholder={t('apiKeyPlaceholder')}
                    disabled
                    className="w-full bg-transparent" style={{ fontSize: '15px', outline: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}
                  />
                </div>
              </div>
            </div>
          </div>

          {isDev && (
            <div className="py-5 border-b border-adaptive">
              <label className="font-bebas-regular text-charcoal-muted" style={{ fontSize: '22px', letterSpacing: '0.04em' }}>SIMULATION MÉTÉO (DEV)</label>
              <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                {[
                  { key: 'off', label: 'AUCUNE' },
                  { key: 'api', label: 'PANNE API' },
                  { key: 'network', label: 'PANNE RÉSEAU' },
                ].map(opt => {
                  const current = getWeatherSim() || 'off';
                  const active = current === opt.key;
                  return (
                    <button
                      key={opt.key}
                      onClick={() => {
                        setWeatherSim(opt.key);
                        // Force un rechargement pour relancer les useEffect des cartes.
                        // C'est le plus direct et garantit que tout l'arbre repart proprement.
                        location.reload();
                      }}
                      className="font-bebas-regular"
                      style={{
                        background: active ? 'rgba(224,122,43,0.18)' : 'transparent',
                        border: `1px solid ${active ? 'rgba(224,122,43,0.55)' : 'rgba(255,255,255,0.15)'}`,
                        color: active ? '#E07A2B' : 'rgba(255,255,255,0.55)',
                        padding: '6px 14px',
                        borderRadius: '4px',
                        fontSize: '14px',
                        letterSpacing: '0.05em',
                        cursor: 'pointer',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <div className="font-bebas-light" style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)', marginTop: '10px', letterSpacing: '0.04em', lineHeight: 1.45 }}>
                Court-circuite les appels Open-Meteo pour tester la bannière et le badge de cache. Disponible uniquement en dev.
              </div>
            </div>
          )}

          {user?.email === 'sgroleau@me.com' && (
            <div className="py-5 border-b border-adaptive" onClick={() => { window.location.href = '/site/dieu.html'; }} style={{ cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
              <span className="font-bebas-regular" style={{ fontSize: '22px', letterSpacing: '0.04em', color: 'rgba(224,122,43,0.4)' }}>ADMIN</span>
            </div>
          )}

          <div className="py-5 border-b border-adaptive" onClick={(e) => { e.preventDefault(); e.stopPropagation(); signOut(); }} style={{ cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
            <span className="font-bebas-regular" style={{ fontSize: '22px', letterSpacing: '0.04em', color: 'rgba(255,255,255,0.4)' }}>{t('disconnect')}</span>
          </div>

          <div className="py-5" style={{ display: 'flex', justifyContent: 'center', marginTop: '60px' }}>
            <div style={{ textAlign: 'center' }}>
              <div className="font-bebas-light" style={{ fontSize: '22px', color: '#8A9A98', letterSpacing: '0.08em' }}>METEOSHOOT v633.158</div>
              <div className="font-bebas-bold" style={{ fontSize: '24px', color: '#8A9A98', letterSpacing: '0.15em', marginTop: '6px' }}>DRIFT{'&'}GRAIN</div>
            </div>
          </div>
        </div>
      </div>
      <UpgradeModal isOpen={showUpgradePref} onClose={() => setShowUpgradePref(false)} />
    </div>
  );
};
