import React, { useEffect, useRef, useState } from 'react';
import { useIsMobile } from '../../hooks/useIsMobile.js';
import { useLang } from '../../i18n/LangProvider.jsx';
import { geocodeAddress, getTravelTime } from '../../maps/google.js';
import { useStore } from '../../projects/StoreProvider.jsx';
import { formatDuration, formatTime } from '../../utils/dates.js';
import { fetchWeather } from '../../weather/api.js';
import { cloudcoverToIcon, veilIcon } from '../../weather/iconsLogic.js';
import { SMOKE_TINT, WeatherIcon } from '../icons/WeatherIcon.jsx';
import { WeatherRow } from '../WeatherRow.jsx';

// ============================================================
// ROUTE: planification de déplacements (maison canonique)
// ============================================================
export const RT_CARD = { background: '#23282A', border: '1px solid #2E3437', borderRadius: 14, padding: 14 };
// Carte hôtel : fond plus clair que les arrêts pour la repérer d'un coup d'œil dans la liste.
export const RT_HOTEL_CARD = { ...RT_CARD, background: '#2F3639', border: '1px solid #444E51' };
export const RT_FIELD = { width: '100%', background: '#191D1F', border: '1px solid #333A3C', borderRadius: 8, color: '#EDEDE9', padding: '8px 10px', fontSize: 14, fontFamily: 'inherit', outline: 'none' };
export const rtFmtDateFR = (s) => { if (!s) return ''; try { return new Date(s + 'T12:00').toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' }); } catch (e) { return s; } };
export const rtToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export const RtChevron = ({ dir = 'up', c = '#7D8C8A' }) => <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d={dir === 'up' ? 'M6 14l6-6 6 6' : 'M6 10l6 6 6-6'} stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
export const RtTrash = ({ c = '#8B9B99' }) => <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0v13a1 1 0 01-1 1H7a1 1 0 01-1-1V7" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>;
export const RtPin = ({ c = '#8B9B99' }) => <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" stroke={c} strokeWidth="1.7"/></svg>;
export const RtBed = ({ c = '#B9C6C3', s = 19 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'relative', top: '1px' }}><path d="M2 20v-7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v7"/><path d="M4 11V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4"/><path d="M2 18h20"/><path d="M12 5v6"/></svg>;

export const MONTHS_ABBR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
// Sélecteur de date inline (jour / mois abrégé / année), sans calendrier natif.
export const RouteDateSelects = ({ value, onChange }) => {
  const parse = (v) => { const p = v ? v.split('-').map(Number) : []; return { y: p[0] || '', m: p[1] || '', d: p[2] || '' }; };
  const [st, setSt] = useState(() => parse(value));
  useEffect(() => { setSt(parse(value)); }, [value]);
  const { y, m, d } = st;
  const change = (ny, nm, nd) => { setSt({ y: ny, m: nm, d: nd }); if (ny && nm && nd) onChange(`${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`); };
  const dim = new Date(y || 2026, m || 1, 0).getDate();
  const cy = new Date().getFullYear();
  const sel = { background: '#191D1F', border: '1px solid #333A3C', borderRadius: 8, color: '#EDEDE9', padding: '6px 9px', fontSize: 16, fontFamily: 'inherit', cursor: 'pointer' };
  return (
    <span style={{ display: 'inline-flex', gap: 5 }}>
      <select style={sel} value={d} onChange={e => change(y, m, Number(e.target.value) || '')}><option value="">jour</option>{Array.from({ length: dim }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}</select>
      <select style={sel} value={m} onChange={e => change(y, Number(e.target.value) || '', d)}><option value="">mois</option>{MONTHS_ABBR.map((mo, i) => <option key={i} value={i + 1}>{mo}</option>)}</select>
      <select style={sel} value={y} onChange={e => change(Number(e.target.value) || '', m, d)}><option value="">année</option>{[cy, cy + 1].map(yr => <option key={yr} value={yr}>{yr}</option>)}</select>
    </span>
  );
};

// Bande météo horaire: exactement le même rendu que le détail d'un projet.
export const RouteHourly = ({ weather }) => {
  const { t } = useLang();
  const getIconFromCloudcover = (cc, origIcon, isNight = false, sunFraction = null, cloudLow = null, smoke = 0) => {
    if (origIcon === 'thunderstorm') return 'thunderstorm';
    if (origIcon === 'snow') return 'snow';
    if (origIcon === 'rain') return 'rain';
    if (!isNight) {
      // Fumee de feux: signalee par la teinte de fond seulement; l'icone reste la vraie meteo.
      const veil = veilIcon(cc, cloudLow, sunFraction);
      if (veil) return veil;
    }
    return cloudcoverToIcon(cc, isNight);
  };
  if (!weather || !weather.hourly || !weather.hourly.length) return <span style={{ fontSize: 12, color: '#5A6B69' }}>Météo en cours...</span>;
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const filtered = weather.hourly.filter(h => new Date(h.time) >= oneHourAgo).slice(0, 72);
  const dailyMap = {};
  if (weather.daily) weather.daily.forEach(d => { const dateStr = new Date(d.sunrise).toDateString(); dailyMap[dateStr] = { sunrise: d.sunrise, sunset: d.sunset }; });
  const days = [];
  let currentDay = null;
  filtered.forEach(h => { const hDate = new Date(h.time); const dateStr = hDate.toDateString(); if (dateStr !== currentDay) { days.push({ date: hDate, dateStr, hours: [], sun: dailyMap[dateStr] || null }); currentDay = dateStr; } days[days.length - 1].hours.push(h); });
  return (
    <div className="relative">
      <div className="flex gap-0 pt-0 pb-2 overflow-x-auto hour-scroll items-start">
        {days.map((day, di) => {
          const sunriseH = day.sun?.sunrise ? new Date(day.sun.sunrise).getHours() : null;
          const sunsetH = day.sun?.sunset ? new Date(day.sun.sunset).getHours() : null;
          const sunriseM = day.sun?.sunrise ? new Date(day.sun.sunrise).getMinutes() : null;
          const sunsetM = day.sun?.sunset ? new Date(day.sun.sunset).getMinutes() : null;
          return (
            <React.Fragment key={day.dateStr}>
              {di > 0 && (<div style={{ width: '1px', background: 'rgba(255,255,255,0.15)', alignSelf: 'stretch', flexShrink: 0, margin: '0 2px', marginBottom: '-8px' }}/>)}
              <div className="flex flex-col flex-shrink-0">
                <div className="px-2" style={{ paddingBottom: '0', marginBottom: '-9px' }}>
                  <span className="font-bebas-book" style={{ letterSpacing: '0.04em', fontSize: '19px', whiteSpace: 'nowrap', color: '#8B9B99' }}>
                    {['DIMANCHE','LUNDI','MARDI','MERCREDI','JEUDI','VENDREDI','SAMEDI'][day.date.getDay()]} {day.date.getDate()} {['JAN','FÉV','MAR','AVR','MAI','JUN','JUL','AOÛ','SEP','OCT','NOV','DÉC'][day.date.getMonth()]}.
                  </span>
                </div>
                <div className="flex gap-0">
                  {day.hours.map(h => {
                    const hDate = new Date(h.time);
                    const hr = hDate.getHours();
                    const isSunrise = sunriseH === hr;
                    const isSunset = sunsetH === hr;
                    const isNight = sunriseH !== null && sunsetH !== null && (hr < sunriseH || hr >= sunsetH);
                    const icon = getIconFromCloudcover(h.cloudcover, h.icon, isNight, h.sunFraction, h.cloudLow, h.smoke);
                    const sunPct = h.sunFraction != null ? Math.round(h.sunFraction * 100) : null;
                    const sunColor = sunPct == null ? '#6f7d7b' : sunPct >= 60 ? '#E9D27A' : sunPct >= 45 ? '#E4CB78' : sunPct >= 32 ? '#DBCD92' : sunPct >= 20 ? '#CFC8A4' : sunPct >= 10 ? '#C3BDAA' : '#A7A99C';
                    let timeLabel = `${hr}H`;
                    if (isSunrise && sunriseM !== null) timeLabel = formatTime(day.sun.sunrise).replace(':', 'H');
                    else if (isSunset && sunsetM !== null) timeLabel = formatTime(day.sun.sunset).replace(':', 'H');
                    return (
                      <div key={h.time} className={`flex flex-col items-center gap-0 min-w-[56px] px-0 py-1 ${isNight ? 'bg-charcoal/5' : ''}`} style={!isNight && h.smoke ? { background: SMOKE_TINT[h.smoke] } : undefined}>
                        {isSunrise && <svg width="18" height="10" viewBox="0 0 18 10" style={{ marginBottom: '8px' }}><polyline points="1,9 9,2 17,9" fill="none" stroke="#404A48" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        {isSunset && <svg width="18" height="10" viewBox="0 0 18 10" style={{ marginBottom: '8px' }}><polyline points="1,1 9,8 17,1" fill="none" stroke="#404A48" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        {!(isSunrise || isSunset) && <div style={{ height: '10px', marginBottom: '8px' }}/>}
                        <span className="font-bebas-bold leading-none" style={{ letterSpacing: '0.04em', fontSize: (isSunrise || isSunset) ? '20px' : '18px', color: (isSunrise || isSunset) ? '#ffffff' : undefined }}>
                          <span className={!(isSunrise || isSunset) ? 'text-charcoal-muted' : ''}>{timeLabel}</span>
                        </span>
                        <WeatherIcon type={icon} className={`w-10 h-10 ${isNight ? 'opacity-50' : ''}`}/>
                        <span className="font-bebas-bold text-base leading-none text-charcoal" style={{ letterSpacing: '0.04em', marginTop: '7px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                          <svg width="12" height="12" viewBox="0 0 32 32" style={{ flexShrink: 0, position: 'relative', top: '-1.5px' }}><g fill="#8A9794"><circle cx="12" cy="18" r="6"/><circle cx="20" cy="16" r="7"/><rect x="8" y="18" width="15" height="6" rx="3"/></g></svg>
                          {h.cloudcover != null ? `${h.cloudcover}%` : '--'}
                        </span>
                        <span className="font-bebas-bold text-base leading-none" style={{ letterSpacing: '0.04em', marginTop: '7px', display: 'inline-flex', alignItems: 'center', gap: '3px', color: sunColor }}>
                          <svg width="11" height="11" viewBox="0 0 32 32" style={{ flexShrink: 0, position: 'relative', top: '-1.5px' }}><circle cx="16" cy="16" r="8" fill={sunColor}/></svg>
                          {sunPct != null ? `${sunPct}%` : '--'}
                        </span>
                        <span className="font-bebas-bold text-base leading-none text-charcoal-muted" style={{ letterSpacing: '0.04em', marginTop: '7px' }}>{h.temp}&deg;</span>
                        <span className="font-bebas-bold text-sm leading-none text-charcoal-muted" style={{ marginTop: '7px' }}>{h.wind} <span className="text-xs">{t('kmh')}</span></span>
                        {h.precip > 0 && <span className="font-bebas-bold text-sm leading-none" style={{ marginTop: '7px', letterSpacing: '0.04em', color: '#7dd3c6' }}>{h.precip < 1 ? h.precip.toFixed(1) : Math.round(h.precip)} <span className="text-xs">MM</span></span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

// Ajout manuel d'une destination (Nom + Adresse géocodée), sous la liste de shootings
export const ManualDestForm = ({ onAdd }) => {
  const [name, setName] = useState('');
  const addrRef = useRef(null);
  const acRef = useRef(null);
  const dataRef = useRef({ address: '', lat: null, lng: null });
  useEffect(() => {
    if (!addrRef.current || acRef.current || !window.google) return;
    acRef.current = new google.maps.places.Autocomplete(addrRef.current, { types: ['address'], componentRestrictions: { country: 'ca' }, fields: ['formatted_address', 'geometry'] });
    acRef.current.addListener('place_changed', () => {
      const p = acRef.current.getPlace();
      if (p && p.geometry) { addrRef.current.value = p.formatted_address; dataRef.current = { address: p.formatted_address, lat: p.geometry.location.lat(), lng: p.geometry.location.lng() }; }
    });
  }, []);
  const submit = async () => {
    let d = dataRef.current;
    const typed = ((addrRef.current && addrRef.current.value) || '').trim();
    if (typed && typed !== d.address) {
      try { const r = await geocodeAddress(typed); d = { address: r.formattedAddress, lat: r.lat, lng: r.lng }; } catch (e) { d = { address: typed, lat: null, lng: null }; }
    }
    if (!name.trim() && !d.address) return;
    onAdd({ name: name.trim() || d.address, address: d.address, lat: d.lat, lng: d.lng });
    setName(''); if (addrRef.current) addrRef.current.value = ''; dataRef.current = { address: '', lat: null, lng: null };
  };
  return (
    <div style={{ marginTop: 12, borderTop: '1px solid #2E3437', paddingTop: 10 }}>
      <div className="font-bebas-regular" style={{ fontSize: 13, color: '#7D8C8A', letterSpacing: '0.04em', marginBottom: 6 }}>OU SAISIR UNE ADRESSE</div>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Nom" style={{ ...RT_FIELD, marginBottom: 6 }} />
      <input ref={addrRef} placeholder="Adresse..." style={{ ...RT_FIELD, marginBottom: 8 }} />
      <button onClick={submit} className="font-bebas-regular" style={{ width: '100%', textAlign: 'center', background: '#2A2F32', border: '1px solid #3A4143', borderRadius: 8, color: '#EDEDE9', padding: '8px', cursor: 'pointer', fontSize: 15, letterSpacing: '0.04em' }}>AJOUTER</button>
    </div>
  );
};

export const RouteDestinationCard = ({ dest, index, leg, onUpdate, onRemove, onMove, canUp, canDown, innerRef }) => {
  const { projects } = useStore();
  const proj = projects.find(p => p.id === dest.projectId);
  const displayName = (proj && proj.name) || dest.name || 'Sans nom';
  const pastel = RT_PASTELS[index % RT_PASTELS.length];
  const [weather, setWeather] = useState(null);
  const [editDate, setEditDate] = useState(false);
  const [editNote, setEditNote] = useState(false);
  const [wxMode, setWxMode] = useState('days');
  useEffect(() => {
    if (dest.lat == null || dest.lng == null) { setWeather(null); return; }
    let alive = true;
    fetchWeather(dest.lat, dest.lng).then(res => { if (alive) setWeather(res && res.data ? res.data : null); }).catch(() => { if (alive) setWeather(null); });
    return () => { alive = false; };
  }, [dest.lat, dest.lng]);

  const dStart = dest.dateStart || dest.date || '';
  const dEnd = dest.dateEnd || '';
  const dayList = (() => {
    if (!dStart) return [];
    const end = (dEnd && dEnd > dStart) ? dEnd : dStart;
    const out = [];
    const e = new Date(end + 'T12:00');
    for (let dt = new Date(dStart + 'T12:00'); dt <= e && out.length < 90; dt.setDate(dt.getDate() + 1)) {
      out.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`);
    }
    return out;
  })();
  const chip = { fontSize: 17, color: '#C9D2D0', background: '#191D1F', border: '1px solid #333A3C', borderRadius: 20, padding: '5px 15px', cursor: 'pointer' };
  const addBtn = { fontSize: 16, color: '#7D8C8A', background: 'none', border: '1px dashed #3A4143', borderRadius: 20, padding: '5px 14px', cursor: 'pointer' };

  return (
    <div ref={innerRef} style={{ ...RT_CARD, marginBottom: 20 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: '0 0 auto', width: 33, height: 33, borderRadius: '50%', background: pastel, color: '#181b1e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 700, marginTop: 2 }}>{index + 1}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="font-bebas-regular" style={{ fontSize: 30, color: '#EDEDE9', letterSpacing: '0.03em', lineHeight: 1.05 }}>{displayName}</div>
          {dest.address && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
              <span style={{ fontSize: 17, color: '#7D8C8A' }}>{dest.address}</span>
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest.address)}`} target="_blank" rel="noopener noreferrer"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); const tmp = document.createElement('a'); tmp.href = e.currentTarget.href; tmp.target = '_blank'; tmp.rel = 'noopener noreferrer'; document.body.appendChild(tmp); tmp.click(); tmp.remove(); }}
                title="Ouvrir dans Google Maps" style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7dd3c6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
              </a>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
            {editDate ? (
              <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16, color: '#7D8C8A', width: 26, textAlign: 'right' }}>Du</span>
                  <RouteDateSelects value={dStart} onChange={v => onUpdate({ dateStart: v })} />
                  <button onClick={() => onUpdate({ dateStart: rtToday() })} className="font-bebas-regular" style={{ background: 'none', border: 'none', color: '#8FA09E', cursor: 'pointer', fontSize: 14, letterSpacing: '0.03em', textDecoration: 'underline', textUnderlineOffset: '3px' }}>aujourd'hui</button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16, color: '#7D8C8A', width: 26, textAlign: 'right' }}>au</span>
                  <RouteDateSelects value={dEnd || dStart} onChange={v => onUpdate({ dateEnd: v })} />
                  <button onClick={() => setEditDate(false)} style={{ ...chip, background: '#2A2F32', marginLeft: 4 }}>OK</button>
                </div>
              </div>
            ) : (
              dStart ? dayList.map(dstr => <span key={dstr} style={chip} onClick={() => setEditDate(true)}>{rtFmtDateFR(dstr)}</span>) : <button style={addBtn} onClick={() => setEditDate(true)}>+ date</button>
            )}
            {leg && <span style={{ fontSize: 16, color: '#7D8C8A' }}>{index === 0 ? 'depuis le départ' : "depuis l'arrêt précédent"} : <b className="font-bebas-regular" style={{ color: '#C9D2D0', fontSize: 20 }}>{formatDuration(leg.durationSeconds)}</b> &middot; {leg.distanceText}</span>}
          </div>

          <div style={{ marginTop: 8 }}>
            {editNote ? (
              <textarea autoFocus style={{ ...RT_FIELD, resize: 'vertical', minHeight: 48, fontSize: 17 }} rows="2" value={dest.note || ''} onChange={e => onUpdate({ note: e.target.value })} onBlur={() => setEditNote(false)} placeholder="Note (accès, contact, repérage, matériel...)" />
            ) : (
              dest.note ? <div onClick={() => setEditNote(true)} style={{ fontSize: 17, color: '#8FA09E', fontStyle: 'italic', cursor: 'pointer' }}>{dest.note}</div> : <button style={addBtn} onClick={() => setEditNote(true)}>+ note</button>
            )}
          </div>

          {dest.lat != null && dest.lng != null && (
            <div style={{ marginTop: 10 }}>
              {weather ? (
                <div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    {[['days', '5 JOURS'], ['hours', 'PAR HEURE']].map(([m, label]) => (
                      <button key={m} onClick={() => setWxMode(m)} className="font-bebas-regular" style={{ fontSize: 13, letterSpacing: '0.05em', padding: '3px 12px', borderRadius: 20, cursor: 'pointer', border: '1px solid ' + (wxMode === m ? '#4A5453' : '#2E3437'), background: wxMode === m ? '#2A2F32' : 'transparent', color: wxMode === m ? '#EDEDE9' : '#7D8C8A' }}>{label}</button>
                    ))}
                  </div>
                  {wxMode === 'hours'
                    ? <RouteHourly weather={weather} />
                    : <div style={{ zoom: 1.1 }}><WeatherRow daily={weather.daily} hourly={weather.hourly} maxDays={5} orientation={[]} onDayClick={() => {}} /></div>}
                </div>
              ) : <span style={{ fontSize: 11, color: '#5A6B69' }}>Météo en cours...</span>}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 2, marginTop: 8 }}>
            <button onClick={() => onMove(-1)} disabled={!canUp} style={{ background: 'none', border: 'none', padding: 4, cursor: canUp ? 'pointer' : 'default', opacity: canUp ? 1 : 0.3 }}><RtChevron dir="up"/></button>
            <button onClick={() => onMove(1)} disabled={!canDown} style={{ background: 'none', border: 'none', padding: 4, cursor: canDown ? 'pointer' : 'default', opacity: canDown ? 1 : 0.3 }}><RtChevron dir="down"/></button>
            <button onClick={onRemove} style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer' }}><RtTrash c="#d83152"/></button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const RT_PASTELS = ['#D0A9B4', '#A9BCD0', '#A9C6B2', '#D0C6A6', '#BEB2CC', '#A8C6C2', '#D0B4A6', '#BAC4A6'];
export const RT_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#2d2d2d' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#2d2d2d' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a8a8a' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#b0b0b0' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#8a8a8a' }] },
  { featureType: 'poi', elementType: 'labels.icon', stylers: [{ saturation: -100 }, { lightness: -20 }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#333333' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#6b8a6b' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#3a3a3a' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#252525' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9a9a9a' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#4a4a4a' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#2a2a2a' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#b0b0b0' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#353535' }] },
  { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#8a8a8a' }] },
  { featureType: 'transit', elementType: 'labels.icon', stylers: [{ saturation: -100 }, { lightness: -20 }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#1a1a1a' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4a4a4a' }] },
  { featureType: 'water', elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a1a' }] },
];

// Carte d'un trajet : départ + destinations reliées dans l'ordre (Google Maps sombre)
// Gélule (pilule) flottante au-dessus d'un point cliqué sur la carte
export const makeRoutePill = (map) => {
  const div = document.createElement('div');
  div.style.cssText = 'position:absolute;transform:translate(-50%,-150%);background:rgba(18,22,25,0.72);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);color:#EDEDE9;border:1px solid rgba(255,255,255,0.14);font-family:Montserrat,sans-serif;font-weight:700;font-size:15px;letter-spacing:0.01em;padding:5px 13px;border-radius:999px;white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,0.45);pointer-events:none;display:none;';
  const ov = new google.maps.OverlayView();
  ov.onAdd = function () { this.getPanes().floatPane.appendChild(div); };
  ov.draw = function () { if (div.style.display === 'none' || !this.__pos) return; const p = this.getProjection().fromLatLngToDivPixel(this.__pos); if (p) { div.style.left = p.x + 'px'; div.style.top = p.y + 'px'; } };
  ov.onRemove = function () { if (div.parentNode) div.parentNode.removeChild(div); };
  ov.showPill = function (latLng, text) { this.__pos = latLng; div.textContent = text; div.style.display = 'block'; this.draw(); };
  ov.hidePill = function () { div.style.display = 'none'; };
  ov.setMap(map);
  return ov;
};

// Voile translucide sur les tuiles seulement (pane sous les tracés) : la carte
// s'estompe mais marqueurs, route et gélule restent nets.
export const makeMapDim = (map, color, opacity) => {
  const div = document.createElement('div');
  div.style.cssText = `position:absolute;background:${color};opacity:${opacity};pointer-events:none;`;
  const ov = new google.maps.OverlayView();
  ov.onAdd = function () { this.getPanes().mapPane.appendChild(div); };
  ov.draw = function () {
    const proj = this.getProjection(); if (!proj) return;
    const b = map.getBounds(); if (!b) return;
    const ne = proj.fromLatLngToDivPixel(b.getNorthEast());
    const sw = proj.fromLatLngToDivPixel(b.getSouthWest());
    const pad = 300;
    div.style.left = (Math.min(sw.x, ne.x) - pad) + 'px';
    div.style.top = (Math.min(ne.y, sw.y) - pad) + 'px';
    div.style.width = (Math.abs(ne.x - sw.x) + pad * 2) + 'px';
    div.style.height = (Math.abs(sw.y - ne.y) + pad * 2) + 'px';
  };
  ov.onRemove = function () { if (div.parentNode) div.parentNode.removeChild(div); };
  ov.setMap(map);
  return ov;
};

// Contrôle de zoom custom (deux fois plus petit, fond blanc 40%)
export const makeZoomControl = (map) => {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin:8px;';
  const mk = (label, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label;
    b.style.cssText = 'width:22px;height:22px;border:none;border-radius:5px;background:rgba(255,255,255,0.4);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);color:#181b1e;font-size:17px;font-weight:700;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.3);';
    b.addEventListener('click', fn);
    return b;
  };
  wrap.appendChild(mk('+', () => map.setZoom((map.getZoom() || 8) + 1)));
  wrap.appendChild(mk('−', () => map.setZoom((map.getZoom() || 8) - 1)));
  map.controls[google.maps.ControlPosition.RIGHT_BOTTOM].push(wrap);
  return wrap;
};

// Décale une trajectoire perpendiculairement à son sens de circulation (vers sa droite),
// en mètres, pour que deux routes empruntant la même voie (typiquement un aller et un
// retour, donc en sens opposés) se retrouvent de chaque côté plutôt que superposées, et
// restent ainsi cliquables individuellement.
export const rtOffsetPath = (path, offMeters) => {
  if (!offMeters || !path || path.length < 2) return path;
  const R = 111320;
  const toLL = (p) => ({ lat: (typeof p.lat === 'function' ? p.lat() : p.lat), lng: (typeof p.lng === 'function' ? p.lng() : p.lng) });
  const ll = path.map(toLL);
  const out = [];
  for (let i = 0; i < ll.length; i++) {
    const cur = ll[i];
    const a = ll[Math.max(0, i - 1)];
    const b = ll[Math.min(ll.length - 1, i + 1)];
    const cosLat = Math.cos(cur.lat * Math.PI / 180) || 1e-6;
    let east = (b.lng - a.lng) * R * cosLat;
    let north = (b.lat - a.lat) * R;
    const len = Math.hypot(east, north) || 1;
    east /= len; north /= len;
    // perpendiculaire droite (rotation -90°): (est, nord) -> (nord, -est)
    const rE = north, rN = -east;
    out.push({
      lat: cur.lat + (rN * offMeters) / R,
      lng: cur.lng + (rE * offMeters) / (R * cosLat),
    });
  }
  return out;
};

export const RouteMiniMap = ({ depLat, depLng, destinations, legs, height = 340 }) => {
  const ref = useRef(null);
  const mapRef = useRef(null);
  const pillRef = useRef(null);
  const dirRef = useRef(null);
  const geo = (destinations || []).filter(d => d.lat != null && d.lng != null);
  const key = JSON.stringify([depLat, depLng, ...geo.map(d => [d.lat, d.lng, d.name])]);
  useEffect(() => {
    if (!ref.current || !window.google) return;
    let alive = true;
    const pts = [];
    if (depLat != null && depLng != null) pts.push({ lat: depLat, lng: depLng, dep: true });
    geo.forEach((d, i) => pts.push({ lat: d.lat, lng: d.lng, n: i + 1, leg: (legs || {})[d.id], color: RT_PASTELS[i % RT_PASTELS.length] }));
    if (pts.length === 0) return;
    // Décalage latéral proportionnel à l'étendue de la route: l'écart à l'écran reste
    // à peu près constant à l'échelle d'ajustement (fitBounds). Facteur calibrable.
    let mnLa = 90, mxLa = -90, mnLo = 180, mxLo = -180;
    pts.forEach(p => { mnLa = Math.min(mnLa, p.lat); mxLa = Math.max(mxLa, p.lat); mnLo = Math.min(mnLo, p.lng); mxLo = Math.max(mxLo, p.lng); });
    const midLa = (mnLa + mxLa) / 2;
    const spanM = Math.max((mxLa - mnLa) * 111320, (mxLo - mnLo) * 111320 * Math.cos(midLa * Math.PI / 180), 1);
    const offMeters = Math.min(1200, Math.max(15, spanM * 0.004));
    if (!mapRef.current) {
      mapRef.current = new google.maps.Map(ref.current, {
        disableDefaultUI: true, zoomControl: false,
        gestureHandling: 'greedy', scrollwheel: false, keyboardShortcuts: false,
        clickableIcons: false, backgroundColor: '#181b1e', styles: RT_MAP_STYLE, mapTypeId: 'roadmap',
      });
      pillRef.current = makeRoutePill(mapRef.current);
      mapRef.current.addListener('click', () => { if (pillRef.current) pillRef.current.hidePill(); });
      makeMapDim(mapRef.current, '#15191B', 0.7);
      makeZoomControl(mapRef.current);
      dirRef.current = new google.maps.DirectionsService();
    }
    const map = mapRef.current;
    (map.__ov || []).forEach(o => o.setMap(null));
    const ov = [];
    const showInfo = (latLng, durText, distText) => {
      if (!pillRef.current) return;
      const txt = (durText || distText) ? `${durText || ''}${durText && distText ? ' · ' : ''}${distText || ''}` : 'Distance...';
      pillRef.current.showPill(latLng, txt);
    };
    const addSeg = (path, durText, distText, color) => {
      const seg = new google.maps.Polyline({ path: rtOffsetPath(path, offMeters), map, clickable: true, strokeColor: color || '#A7B7B4', strokeOpacity: 0.95, strokeWeight: 4 });
      seg.addListener('click', (e) => showInfo(e.latLng, durText, distText));
      ov.push(seg);
    };
    const drawStraight = () => {
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k], b = pts[k + 1];
        const lg = b.leg;
        addSeg([{ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }], lg ? formatDuration(lg.durationSeconds) : '', lg ? lg.distanceText : '', b.color);
      }
    };
    // Marqueurs
    pts.forEach(p => {
      if (p.dep) ov.push(new google.maps.Marker({ position: { lat: p.lat, lng: p.lng }, map, zIndex: 10, icon: { path: google.maps.SymbolPath.CIRCLE, scale: 6, fillColor: '#EDEDE9', fillOpacity: 1, strokeColor: '#181b1e', strokeWeight: 2.5 } }));
      else ov.push(new google.maps.Marker({ position: { lat: p.lat, lng: p.lng }, map, zIndex: 11, label: { text: String(p.n), color: '#181b1e', fontSize: '12px', fontWeight: '700' }, icon: { path: google.maps.SymbolPath.CIRCLE, scale: 13, fillColor: p.color || '#EDEDE9', fillOpacity: 1, strokeColor: '#181b1e', strokeWeight: 2 } }));
    });
    map.__ov = ov;
    if (pts.length === 1) { map.setCenter({ lat: pts[0].lat, lng: pts[0].lng }); map.setZoom(11); }
    else { const bnds = new google.maps.LatLngBounds(); pts.forEach(p => bnds.extend({ lat: p.lat, lng: p.lng })); map.fitBounds(bnds, 44); }

    // Vraie route routière (Directions), un tronçon cliquable par segment
    if (pts.length >= 2) {
      const origin = { lat: pts[0].lat, lng: pts[0].lng };
      const destination = { lat: pts[pts.length - 1].lat, lng: pts[pts.length - 1].lng };
      const waypoints = pts.slice(1, -1).map(p => ({ location: { lat: p.lat, lng: p.lng }, stopover: true }));
      dirRef.current.route({ origin, destination, waypoints, travelMode: google.maps.TravelMode.DRIVING }, (res, status) => {
        if (!alive) return;
        if (status === 'OK' && res.routes && res.routes[0] && res.routes[0].legs) {
          res.routes[0].legs.forEach((lg, i) => {
            const path = [];
            (lg.steps || []).forEach(s => (s.path || []).forEach(pt => path.push(pt)));
            if (path.length > 1) addSeg(path, lg.duration ? formatDuration(lg.duration.value) : '', lg.distance ? lg.distance.text : '', pts[i + 1] && pts[i + 1].color);
          });
          map.__ov = ov;
          if (res.routes[0].bounds) map.fitBounds(res.routes[0].bounds, 44);
        } else {
          drawStraight();
          map.__ov = ov;
        }
      });
    }
    return () => { alive = false; };
  }, [key]);
  return <div ref={ref} style={{ height, borderRadius: 12, overflow: 'hidden', border: '1px solid #2A2F32', background: '#15191B' }} />;
};

// Ouvre un lien externe (Google Maps, Google Earth) dans une nouvelle fenêtre: dans le site installé en app
// (Mac, iPhone) et dans l'app native, un simple target=_blank sur le lien est bloqué.
export const rtOpenMap = (e) => { e.preventDefault(); e.stopPropagation(); const tmp = document.createElement('a'); tmp.href = e.currentTarget.href; tmp.target = '_blank'; tmp.rel = 'noopener noreferrer'; document.body.appendChild(tmp); tmp.click(); tmp.remove(); };

// Boîte hôtel : une nuitée glissée entre deux destinations d'une route.
export const RouteHotelBox = ({ hotel, hostName, nextName, fromLabel, legs, onEdit, onRemove, collapsible }) => {
  const [open, setOpen] = useState(false);
  const expanded = !collapsible || open;
  const to = legs && legs.to, from = legs && legs.from;
  const legRow = (lbl, leg) => (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
      <span style={{ fontSize: 12.5, color: '#7D8C8A', textTransform: 'uppercase', letterSpacing: '0.04em', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lbl}</span>
      <span style={{ fontSize: 13, color: '#7D8C8A', flexShrink: 0 }}>{leg ? <span><b className="font-bebas-regular" style={{ color: '#C9D2D0', fontSize: 18 }}>{formatDuration(leg.durationSeconds)}</b> &middot; {leg.distanceText}</span> : <span style={{ color: '#5A6B69' }}>…</span>}</span>
    </div>
  );
  return (
    <div style={RT_HOTEL_CARD}>
      <div onClick={collapsible ? () => setOpen(o => !o) : undefined} style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: collapsible ? 'pointer' : 'default' }}>
        <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}><RtBed c="#C9D2D0" s={collapsible ? 18 : 20} /></span>
        <div className="font-bebas-regular" style={{ flex: 1, minWidth: 0, fontSize: collapsible ? 20 : 23, color: '#EDEDE9', letterSpacing: '0.03em', lineHeight: 1.1, wordBreak: expanded ? 'break-word' : 'normal', whiteSpace: expanded ? 'normal' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hotel.name || 'Hôtel'}</div>
        {collapsible && <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}><RtChevron dir={expanded ? 'up' : 'down'} c="#7D8C8A" /></span>}
        {expanded && <button onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Retirer l'hôtel" style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', flexShrink: 0 }}><RtTrash c="#5A6B69" /></button>}
      </div>
      {expanded && (
        <React.Fragment>
          {hotel.address && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <span style={{ fontSize: 15, color: '#7D8C8A', minWidth: 0 }}>{hotel.address}</span>
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(hotel.address)}`} target="_blank" rel="noopener noreferrer" onClick={rtOpenMap} title="Ouvrir dans Google Maps" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', position: 'relative', top: '1px' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7dd3c6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
              </a>
            </div>
          )}
          <div style={{ marginTop: 12, borderTop: '1px solid #3E4749', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
            {legRow(fromLabel || `De ${hostName}`, to)}
            {nextName ? legRow(`Vers ${nextName}`, from) : null}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="font-bebas-regular" style={{ background: 'none', border: 'none', color: '#7D8C8A', cursor: 'pointer', fontSize: 13, letterSpacing: '0.05em', textDecoration: 'underline', textUnderlineOffset: '3px' }}>MODIFIER</button>
          </div>
        </React.Fragment>
      )}
    </div>
  );
};

// Formulaire d'ajout / modification d'un hôtel (nom + adresse via Google Places).
export const RouteHotelForm = ({ initial, onSave, onCancel }) => {
  const [name, setName] = useState((initial && initial.name) || '');
  const addrRef = useRef(null);
  const acRef = useRef(null);
  const dataRef = useRef({ address: (initial && initial.address) || '', lat: (initial && initial.lat) ?? null, lng: (initial && initial.lng) ?? null });
  useEffect(() => {
    if (!addrRef.current) return;
    if (initial && initial.address) addrRef.current.value = initial.address;
    if (acRef.current || !window.google) return;
    acRef.current = new google.maps.places.Autocomplete(addrRef.current, { componentRestrictions: { country: 'ca' }, fields: ['name', 'formatted_address', 'geometry'] });
    acRef.current.addListener('place_changed', () => {
      const p = acRef.current.getPlace();
      if (p && p.geometry) {
        dataRef.current = { address: p.formatted_address || addrRef.current.value, lat: p.geometry.location.lat(), lng: p.geometry.location.lng() };
        addrRef.current.value = p.formatted_address || addrRef.current.value;
        if (p.name) setName(prev => prev.trim() ? prev : p.name);
      }
    });
  }, []);
  const submit = async () => {
    let d = dataRef.current;
    const typed = ((addrRef.current && addrRef.current.value) || '').trim();
    if (typed && typed !== d.address) {
      try { const r = await geocodeAddress(typed); d = { address: r.formattedAddress, lat: r.lat, lng: r.lng }; } catch (e) { d = { address: typed, lat: null, lng: null }; }
    }
    if (!name.trim() && !d.address) return;
    onSave({ name: name.trim() || 'Hôtel', address: d.address, lat: d.lat, lng: d.lng });
  };
  return (
    <div style={RT_HOTEL_CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <RtBed c="#B9C6C3" s={17} />
        <span className="font-bebas-regular" style={{ fontSize: 15, color: '#C9D2D0', letterSpacing: '0.06em', position: 'relative', top: '1px' }}>{initial ? 'MODIFIER L\'HÔTEL' : 'AJOUTER UN HÔTEL'}</span>
      </div>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Nom de l'hôtel" style={{ ...RT_FIELD, marginBottom: 6 }} />
      <input ref={addrRef} placeholder="Adresse ou nom (Google)..." style={{ ...RT_FIELD, marginBottom: 10 }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onCancel} className="font-bebas-regular" style={{ flex: '0 0 auto', background: 'none', border: '1px solid #3A4143', borderRadius: 8, color: '#8FA09E', padding: '8px 14px', cursor: 'pointer', fontSize: 14, letterSpacing: '0.04em' }}>ANNULER</button>
        <button onClick={submit} className="font-bebas-regular" style={{ flex: 1, background: '#2A2F32', border: '1px solid #3A4143', borderRadius: 8, color: '#EDEDE9', padding: '8px', cursor: 'pointer', fontSize: 15, letterSpacing: '0.04em' }}>ENREGISTRER</button>
      </div>
    </div>
  );
};

// Bouton d'ajout d'un hôtel (état vide d'un tronçon) : gros + blanc + icône lit seule.
export const RouteHotelAdd = ({ onClick }) => (
  <button onClick={onClick} title="Ajouter un hôtel" style={{ width: '100%', border: '1px dashed #3A4143', borderRadius: 14, background: 'rgba(35,40,42,0.35)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '18px 0 16px' }}>
    <span style={{ fontFamily: "'Avenir','Montserrat',sans-serif", fontWeight: 300, fontSize: 40, lineHeight: 0.7, color: '#EDEDE9' }}>+</span>
    <RtBed c="#EDEDE9" s={22} />
  </button>
);

export const RouteDetail = ({ route, onBack, embedded, railMode }) => {
  const { projects, updateRoute, deleteRoute, prefs } = useStore();
  const [name, setName] = useState(route.name || '');
  const [dests, setDestsLocal] = useState(route.destinations || []);
  const [depAddr, setDepAddr] = useState(route.departureAddress || '');
  const [legs, setLegs] = useState({});
  const [confirmDel, setConfirmDel] = useState(false);
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState('');
  const commitTimer = useRef(null);
  const rootRef = useRef(null);
  const cardRefs = useRef([]);
  const [junctions, setJunctions] = useState([]);
  const [hotelLegs, setHotelLegs] = useState({});
  const [editHotelFor, setEditHotelFor] = useState(null);

  const depLat = route.useHome ? prefs.homeLat : route.departureLat;
  const depLng = route.useHome ? prefs.homeLng : route.departureLng;
  const depLabel = route.useHome ? (prefs.homeAddress || 'Ma résidence') : (route.departureAddress || 'Point de départ');

  const commit = (next) => { setDestsLocal(next); clearTimeout(commitTimer.current); commitTimer.current = setTimeout(() => updateRoute(route.id, { destinations: next }), 600); };
  const addFromProject = (p) => { commit([...dests, { id: `d_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, projectId: p.id, name: p.name, address: p.address || '', lat: p.lat ?? null, lng: p.lng ?? null, dateStart: '', dateEnd: '', note: '' }]); setPicking(false); setSearch(''); };
  const projectChoices = (projects || []).filter(p => { const q = search.trim().toLowerCase(); if (!q) return true; return (p.name || '').toLowerCase().includes(q) || (p.address || '').toLowerCase().includes(q); });
  const addManual = (data) => { commit([...dests, { id: `d_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, projectId: null, name: data.name || '', address: data.address || '', lat: data.lat ?? null, lng: data.lng ?? null, dateStart: '', dateEnd: '', note: '' }]); setPicking(false); setSearch(''); };
  const updateDest = (id, u) => commit(dests.map(d => d.id === id ? { ...d, ...u } : d));
  // La nuitée « avant le premier arrêt » (hotelBefore) reste accrochée à l'arrêt en tête de liste,
  // même quand on réordonne les arrêts ou qu'on retire le premier.
  const keepStartHotelFirst = (list) => {
    const i = list.findIndex(d => d.hotelBefore);
    if (i <= 0) return list;
    const n = list.map(d => ({ ...d }));
    const h = n[i].hotelBefore; n[i].hotelBefore = null;
    if (!n[0].hotelBefore) n[0].hotelBefore = h;
    return n;
  };
  const removeDest = (id) => {
    const gone = dests.find(d => d.id === id);
    let n = dests.filter(d => d.id !== id);
    if (gone && gone.hotelBefore && n.length > 0 && !n[0].hotelBefore) n = n.map((d, i) => i === 0 ? { ...d, hotelBefore: gone.hotelBefore } : d);
    commit(n);
  };
  const moveDest = (idx, dir) => { const j = idx + dir; if (j < 0 || j >= dests.length) return; const n = [...dests]; [n[idx], n[j]] = [n[j], n[idx]]; commit(keepStartHotelFirst(n)); };

  const depGeocode = async () => {
    const a = depAddr.trim();
    if (!a) return;
    try { const r = await geocodeAddress(a); setDepAddr(r.formattedAddress); updateRoute(route.id, { departureAddress: r.formattedAddress, departureLat: r.lat, departureLng: r.lng }); } catch (e) { updateRoute(route.id, { departureAddress: a }); }
  };

  const geoKey = JSON.stringify([depLat, depLng, ...dests.map(d => [d.id, d.lat, d.lng])]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const next = {};
      let p = (depLat != null && depLng != null) ? { lat: depLat, lng: depLng } : null;
      for (const d of dests) {
        if (d.lat != null && d.lng != null && p) { try { const r = await getTravelTime(p.lat, p.lng, d.lat, d.lng); if (r) next[d.id] = r; } catch (e) {} }
        if (d.lat != null && d.lng != null) p = { lat: d.lat, lng: d.lng };
      }
      if (alive) setLegs(next);
    })();
    return () => { alive = false; };
  }, [geoKey]);

  // Temps de trajet propres aux hôtels : arrêt -> hôtel -> arrêt suivant.
  const startHotel = (dests[0] && dests[0].hotelBefore) || null;
  const hotelGeoKey = JSON.stringify([depLat, depLng, startHotel && startHotel.lat, startHotel && startHotel.lng, ...dests.map(d => [d.id, d.lat, d.lng, d.hotel && d.hotel.lat, d.hotel && d.hotel.lng])]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const next = {};
      // Nuitée avant le premier arrêt : départ -> hôtel -> premier arrêt.
      if (startHotel && startHotel.lat != null && startHotel.lng != null) {
        const entry = {}, d0 = dests[0];
        if (depLat != null && depLng != null) { try { entry.to = await getTravelTime(depLat, depLng, startHotel.lat, startHotel.lng); } catch (e) {} }
        if (d0 && d0.lat != null && d0.lng != null) { try { entry.from = await getTravelTime(startHotel.lat, startHotel.lng, d0.lat, d0.lng); } catch (e) {} }
        next.start = entry;
      }
      for (let i = 0; i < dests.length; i++) {
        const d = dests[i], nd = dests[i + 1];
        const h = d.hotel;
        if (h && h.lat != null && h.lng != null) {
          const entry = {};
          if (d.lat != null && d.lng != null) { try { entry.to = await getTravelTime(d.lat, d.lng, h.lat, h.lng); } catch (e) {} }
          if (nd && nd.lat != null && nd.lng != null) { try { entry.from = await getTravelTime(h.lat, h.lng, nd.lat, nd.lng); } catch (e) {} }
          next[d.id] = entry;
        }
      }
      if (alive) setHotelLegs(next);
    })();
    return () => { alive = false; };
  }, [hotelGeoKey]);

  // Mesure la position verticale des jonctions entre cartes pour aligner la colonne hôtels (desktop large).
  React.useLayoutEffect(() => {
    if (!railMode) { setJunctions([]); return; }
    const measure = () => {
      if (!rootRef.current) return;
      const rootTop = rootRef.current.getBoundingClientRect().top;
      const js = [];
      // Nuitée avant le premier arrêt : ancrée juste au-dessus de la première carte.
      if (dests.length > 0 && cardRefs.current[0]) js.push({ destId: 'start', y: (cardRefs.current[0].getBoundingClientRect().top - rootTop) - 10 });
      for (let i = 0; i < dests.length; i++) {
        const a = cardRefs.current[i];
        if (!a) continue;
        const ar = a.getBoundingClientRect();
        const b = cardRefs.current[i + 1];
        // Dernier arrêt : pas de jonction, on ancre la nuitée sous la carte (moitié de sa marge basse).
        const y = b ? ((ar.bottom - rootTop) + (b.getBoundingClientRect().top - rootTop)) / 2 : (ar.bottom - rootTop) + 10;
        js.push({ destId: dests[i].id, y });
      }
      setJunctions(js);
    };
    measure();
    let ro;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(measure);
      if (rootRef.current) ro.observe(rootRef.current);
      cardRefs.current.forEach(el => el && ro.observe(el));
    }
    window.addEventListener('resize', measure);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [railMode, dests, legs, hotelLegs, editHotelFor]);

  const setHotel = (destId, hotel) => updateDest(destId, { hotel });
  const removeHotel = (destId) => { updateDest(destId, { hotel: null }); setEditHotelFor(null); };
  const destName = (d) => { if (!d) return ''; const p = (projects || []).find(pp => pp.id === d.projectId); return (p && p.name) || d.name || 'l\'arrêt'; };
  const renderHotelSlot = (d, nd, collapsible) => {
    if (editHotelFor === d.id) return <RouteHotelForm initial={d.hotel || null} onSave={h => { setHotel(d.id, h); setEditHotelFor(null); }} onCancel={() => setEditHotelFor(null)} />;
    if (d.hotel) return <RouteHotelBox hotel={d.hotel} hostName={destName(d)} nextName={destName(nd)} legs={hotelLegs[d.id]} collapsible={collapsible} onEdit={() => setEditHotelFor(d.id)} onRemove={() => removeHotel(d.id)} />;
    return <RouteHotelAdd onClick={() => setEditHotelFor(d.id)} />;
  };
  const setStartHotel = (hotel) => { commit(dests.map((d, i) => i === 0 ? { ...d, hotelBefore: hotel } : d)); setEditHotelFor(null); };
  const renderStartHotelSlot = (collapsible) => {
    if (editHotelFor === 'start') return <RouteHotelForm initial={startHotel} onSave={setStartHotel} onCancel={() => setEditHotelFor(null)} />;
    if (startHotel) return <RouteHotelBox hotel={startHotel} hostName={depLabel} fromLabel="Depuis le départ" nextName={destName(dests[0])} legs={hotelLegs.start} collapsible={collapsible} onEdit={() => setEditHotelFor('start')} onRemove={() => setStartHotel(null)} />;
    return <RouteHotelAdd onClick={() => setEditHotelFor('start')} />;
  };

  const totalSec = Object.values(legs).reduce((s, l) => s + (l.durationSeconds || 0), 0);
  const totalKm = Math.round(Object.values(legs).reduce((s, l) => s + (l.distanceMeters || 0), 0) / 1000);

  return (
    <div ref={rootRef} style={{ position: railMode ? 'relative' : undefined }}>
      {!embedded && (
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#7D8C8A', cursor: 'pointer', fontSize: 13, padding: '4px 0', marginBottom: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M15 6l-6 6 6 6" stroke="#7D8C8A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <span className="font-bebas-regular" style={{ letterSpacing: '0.06em' }}>ROUTES</span>
        </button>
      )}

      <input className="font-bebas-regular" style={{ background: 'transparent', border: 'none', color: '#EDEDE9', fontSize: 27, letterSpacing: '0.04em', width: '100%', outline: 'none', padding: 0, marginBottom: 4 }}
        value={name} onChange={e => setName(e.target.value)} onBlur={() => { if (name !== route.name) updateRoute(route.id, { name }); }} placeholder="NOM DE LA ROUTE" />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#7D8C8A', fontSize: 11, marginBottom: 4 }}>
        <RtPin /><span>DÉPART &middot; {depLabel}</span>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#8FA09E', marginBottom: route.useHome ? 16 : 6, cursor: 'pointer' }}>
        <input type="checkbox" checked={route.useHome !== false} onChange={e => updateRoute(route.id, { useHome: e.target.checked })} style={{ position: 'relative', top: '-1px', accentColor: '#8B9B99' }} />
        Partir de ma résidence
      </label>
      {route.useHome === false && <input style={{ ...RT_FIELD, marginBottom: 16 }} value={depAddr} onChange={e => setDepAddr(e.target.value)} onBlur={depGeocode} placeholder="Adresse de départ..." />}

      {((depLat != null && depLng != null) || dests.some(d => d.lat != null && d.lng != null)) && (
        <div style={{ marginBottom: 12 }}>
          <RouteMiniMap depLat={depLat} depLng={depLng} destinations={dests} legs={legs} />
        </div>
      )}

      {!railMode && dests.length > 0 && (
        <div style={{ marginBottom: 20 }}>{renderStartHotelSlot(true)}</div>
      )}
      {dests.map((d, i) => (
        <React.Fragment key={d.id}>
          <RouteDestinationCard innerRef={el => { cardRefs.current[i] = el; }} dest={d} index={i} leg={legs[d.id]}
            onUpdate={u => updateDest(d.id, u)} onRemove={() => removeDest(d.id)}
            onMove={dir => moveDest(i, dir)} canUp={i > 0} canDown={i < dests.length - 1} />
          {!railMode && (
            <div style={{ marginBottom: 20 }}>{renderHotelSlot(d, dests[i + 1], true)}</div>
          )}
        </React.Fragment>
      ))}

      {railMode && (
        <div style={{ position: 'absolute', top: 0, left: 'calc(100% + 34px)', width: 300 }} aria-hidden={junctions.length === 0}>
          {junctions.map(j => {
            const isStart = j.destId === 'start';
            const i = isStart ? -1 : dests.findIndex(x => x.id === j.destId);
            if (!isStart && i < 0) return null;
            const d = isStart ? null : dests[i], nd = isStart ? null : dests[i + 1];
            const linked = isStart ? !!startHotel : !!d.hotel;
            return (
              <div key={j.destId} style={{ position: 'absolute', top: j.y, right: 0, width: 300, transform: 'translateY(-50%)' }}>
                <div style={{ position: 'absolute', left: -38, top: '50%', transform: 'translateY(-50%)', width: 38, height: 2, display: 'flex', alignItems: 'center' }}>
                  <span style={{ flex: 1, height: 2, background: `linear-gradient(90deg, rgba(74,84,83,0), ${linked ? '#4A5453' : '#3A4143'})` }} />
                  <span style={{ position: 'absolute', left: -3, width: 9, height: 9, borderRadius: '50%', background: '#23282A', border: `2px solid ${linked ? '#7dd3c6' : '#4A5453'}` }} />
                </div>
                {isStart ? renderStartHotelSlot(false) : renderHotelSlot(d, nd, false)}
              </div>
            );
          })}
        </div>
      )}

      {picking ? (
        <div style={{ ...RT_CARD, marginBottom: 12, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="font-bebas-regular" style={{ fontSize: 15, color: '#C9D2D0', letterSpacing: '0.04em' }}>CHOISIR UN SHOOTING</span>
            <button onClick={() => { setPicking(false); setSearch(''); }} style={{ background: 'none', border: 'none', color: '#7D8C8A', cursor: 'pointer', fontSize: 12 }}>Annuler</button>
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un shooting..." style={{ ...RT_FIELD, marginBottom: 8 }} autoFocus />
          <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {projectChoices.length === 0 ? (
              <div style={{ fontSize: 12, color: '#7D8C8A', padding: 8, textAlign: 'center' }}>Aucun shooting trouvé.</div>
            ) : projectChoices.map(p => (
              <button key={p.id} onClick={() => addFromProject(p)} style={{ background: '#191D1F', border: '1px solid #2E3437', borderRadius: 8, padding: '8px 10px', textAlign: 'left', cursor: 'pointer' }}>
                <span className="font-bebas-regular" style={{ display: 'block', fontSize: 15, color: '#EDEDE9', letterSpacing: '0.03em' }}>{p.name || 'Sans nom'}</span>
                {p.address && <span style={{ fontSize: 10.5, color: '#7D8C8A' }}>{p.address}</span>}
              </button>
            ))}
          </div>
          <ManualDestForm onAdd={addManual} />
        </div>
      ) : (
        <button onClick={() => setPicking(true)} style={{ width: '100%', textAlign: 'center', border: '1px dashed #3A4143', borderRadius: 12, padding: 10, background: 'none', color: '#8B9B99', cursor: 'pointer', fontSize: 13, marginBottom: 12 }}>+ Ajouter une destination</button>
      )}

      {totalSec > 0 && (
        <div style={{ ...RT_CARD, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{ fontSize: 11, color: '#7D8C8A', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total du trajet</span>
          <span className="font-bebas-regular" style={{ fontSize: 19, color: '#EDEDE9', letterSpacing: '0.03em' }}>{formatDuration(totalSec)} &middot; {totalKm} KM</span>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={() => { if (confirmDel) { deleteRoute(route.id); onBack(); } else { setConfirmDel(true); setTimeout(() => setConfirmDel(false), 3000); } }}
          className="font-bebas-regular" style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: confirmDel ? '#d83152' : '#5A6B69', cursor: 'pointer', fontSize: 14, letterSpacing: '0.04em' }}>
          <RtTrash c={confirmDel ? '#d83152' : '#5A6B69'} />{confirmDel ? 'CONFIRMER LA SUPPRESSION' : 'SUPPRIMER LA ROUTE'}
        </button>
      </div>
    </div>
  );
};

export const RT_PANEL = { background: '#1B1F21', border: '1px solid #2A2F32', borderRadius: 16 };

export const RouteView = () => {
  const { routes, addRoute, prefs } = useStore();
  const isMobile = useIsMobile();
  const [openId, setOpenId] = useState(null);
  const [winW, setWinW] = useState(window.innerWidth);
  useEffect(() => { const on = () => setWinW(window.innerWidth); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);
  const active = routes.filter(r => !r.archived);
  // Desktop: si rien de sélectionné, on ouvre la première route (jamais de panneau vide).
  const effectiveId = openId || (!isMobile && active[0] ? active[0].id : null);
  const current = routes.find(r => r.id === effectiveId);

  const create = () => {
    const id = addRoute({ useHome: true, departureAddress: prefs.homeAddress, departureLat: prefs.homeLat, departureLng: prefs.homeLng, destinations: [] });
    setOpenId(id);
  };

  const listPanel = (
    <div style={{ ...RT_PANEL, padding: isMobile ? 14 : 16, ...(isMobile ? {} : { width: 320, flexShrink: 0, position: 'sticky', top: 100 }) }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span className="font-bebas-regular" style={{ fontSize: 30, color: '#EDEDE9', letterSpacing: '0.04em' }}>ROUTES</span>
        <button onClick={create} style={{ width: 30, height: 30, borderRadius: '50%', background: '#2A2F32', color: '#EDEDE9', border: 'none', fontSize: 22, lineHeight: 0.7, cursor: 'pointer' }}>+</button>
      </div>
      {active.length === 0 ? (
        <div style={{ color: '#7D8C8A', fontSize: 13, padding: '20px 4px', textAlign: 'center' }}>Aucune route. Touche « + » pour en créer une.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {active.map(r => {
            const ds = r.destinations || [];
            const dated = ds.flatMap(d => [d.dateStart || d.date, d.dateEnd]).filter(Boolean).sort();
            const sel = r.id === effectiveId;
            return (
              <button key={r.id} onClick={() => setOpenId(r.id)} style={{ background: '#23282A', border: `1px solid ${sel ? '#4A5453' : '#2E3437'}`, borderRadius: 12, padding: 12, width: '100%', textAlign: 'left', cursor: 'pointer' }}>
                <span className="font-bebas-regular" style={{ display: 'block', fontSize: 19, color: '#EDEDE9', letterSpacing: '0.03em' }}>{r.name || 'ROUTE SANS NOM'}</span>
                <span style={{ fontSize: 11, color: '#7D8C8A' }}>{ds.length} destination{ds.length > 1 ? 's' : ''}{dated.length > 0 ? ` · ${rtFmtDateFR(dated[0])}${dated.length > 1 ? ' au ' + rtFmtDateFR(dated[dated.length - 1]) : ''}` : ''}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  // iPhone : une colonne (liste, puis détail plein écran avec retour).
  if (isMobile) {
    return (
      <div style={{ paddingLeft: 12, paddingRight: 12, paddingBottom: 90, paddingTop: 'calc(16px + env(safe-area-inset-top))' }}>
        {openId && current
          ? <div style={{ ...RT_PANEL, padding: 14 }}><RouteDetail key={current.id} route={current} onBack={() => setOpenId(null)} /></div>
          : listPanel}
      </div>
    );
  }

  // Desktop : routes à gauche, détail au centre. Sur écran large, une 3e colonne
  // « hôtels » (nuitées entre deux arrêts) apparaît à droite ; sinon les hôtels
  // s'affichent en ligne dans le détail, sans toucher à la largeur centrale.
  const railMode = !isMobile && winW >= 1300 && !!current && (current.destinations || []).length >= 2;
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', maxWidth: railMode ? 1300 : 980, margin: '0 auto', paddingLeft: 16, paddingRight: 16, paddingBottom: 90, paddingTop: 100 }}>
      {listPanel}
      <div style={{ ...RT_PANEL, flex: 1, minWidth: 0, maxWidth: 620, padding: 18 }}>
        {current
          ? <RouteDetail key={current.id} route={current} embedded railMode={railMode} onBack={() => setOpenId(null)} />
          : <div style={{ color: '#7D8C8A', fontSize: 14, textAlign: 'center', padding: '60px 20px' }}>Sélectionne une route à gauche, ou crée-en une avec « + ».</div>}
      </div>
      {railMode && <div style={{ width: 300, flexShrink: 0 }} aria-hidden="true" />}
    </div>
  );
};
