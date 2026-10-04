import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useLang } from '../i18n/LangProvider.jsx';
import { formatTime, getDayAbbrev, getDayMonth, isToday } from '../utils/dates.js';
import { SHOOT_OPP_MIN, SUN_DIRECT_COLOR, cloudcoverToIcon, dayIcon, veilIcon } from '../weather/iconsLogic.js';
import { SMOKE_TINT, WeatherIcon } from './icons/WeatherIcon.jsx';

// ===== COMPONENTS =====

// Global tracker for active weather tooltip
export const weatherRowDismiss = { current: null };

export const WeatherRow = ({ daily, hourly, onDayClick, maxDays = 9, orientation = [], tapOpensDetail = false }) => {
  // Créneaux de shoot du projet (AM puis PM), pour l'indice d'opportunité sous chaque jour.
  const shootSlots = ['AM', 'PM'].filter((o) => (orientation || []).includes(o));
  const { t } = useLang();
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const [cellCenterX, setCellCenterX] = useState(0);
  const [displayX, setDisplayX] = useState(0);
  const [visible, setVisible] = useState(false);
  const rowRef = React.useRef(null);
  const hideTimer = React.useRef(null);
  const targetX = React.useRef(0);
  const currentX = React.useRef(0);
  const rafRef = React.useRef(null);
  const isMobile = useIsMobile();
  // Bulle de survol des jours. Dans la liste sur iPad (tapOpensDetail), le survol simulé au toucher l'affichait puis la
  // laissait par-dessus la fiche ouverte: au doigt, elle ne sert que là où toucher un jour n'ouvre rien (fiche, Route).
  const [touchOnly] = useState(() => window.matchMedia('(hover: none)').matches);
  const hoverTips = !isMobile && !(touchOnly && tapOpensDetail);

  // Close tooltip on scroll/wheel (desktop)
  useEffect(() => {
    if (isMobile) return;
    const dismiss = () => { setVisible(false); setHoveredIdx(null); };
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('wheel', dismiss, { passive: true });
    return () => { window.removeEventListener('scroll', dismiss, true); window.removeEventListener('wheel', dismiss); };
  }, [isMobile]);

  // Lerp animation loop (desktop only)
  useEffect(() => {
    if (isMobile) return;
    const animate = () => {
      const diff = targetX.current - currentX.current;
      currentX.current += diff * 0.15;
      if (Math.abs(diff) > 0.3) {
        setDisplayX(currentX.current);
      }
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [isMobile]);
  
  if (!daily?.length) return <div className="flex gap-2 py-2">{[...Array(10)].map((_,i) => <div key={i} className="flex flex-col items-center gap-0 min-w-[56px]"><div className="w-12 h-4 bg-cream-dark rounded animate-pulse"/><div className="w-8 h-8 bg-cream-dark rounded-full animate-pulse"/></div>)}</div>;
  
  const todayIndex = daily.findIndex(d => isToday(d.date));
  const startIndex = todayIndex >= 0 ? todayIndex : 0;
  const sortedDaily = daily.slice(startIndex, startIndex + maxDays);
  
  // Choix de l'icône du jour: logique partagée avec le widget iPhone (iconsLogic.dayIcon). La fumée de feux
  // est signalée par la teinte de fond (SMOKE_TINT) seulement; l'icône reste la vraie météo.
  const getIconFromCloudcover = (cloudcover, icon, sunFraction = null, cloudLow = null) => dayIcon({ cloudcover, icon, sunFraction, cloudLow });

  const handleCellEnter = (i, e) => {
    if (window.__isDragging) return;
    // Dismiss any other row's tooltip first
    if (weatherRowDismiss.current && weatherRowDismiss.current !== dismiss) {
      weatherRowDismiss.current();
    }
    weatherRowDismiss.current = dismiss;
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    const cellRect = e.currentTarget.getBoundingClientRect();
    const rowRect = rowRef.current.getBoundingClientRect();
    const cx = cellRect.left + cellRect.width / 2 - rowRect.left;
    if (hoveredIdx === null) { currentX.current = cx; setDisplayX(cx); }
    targetX.current = cx;
    setCellCenterX(cx);
    setHoveredIdx(i);
    setVisible(true);
  };

  const dismiss = () => {
    clearTimeout(hideTimer.current);
    setVisible(false);
    setHoveredIdx(null);
  };

  const handleRowLeave = () => {
    dismiss();
    if (weatherRowDismiss.current === dismiss) weatherRowDismiss.current = null;
  };

  const hoveredDay = hoveredIdx !== null ? sortedDaily[hoveredIdx] : null;
  
  return (
    <div 
      className="relative" 
      ref={rowRef}
      onMouseLeave={hoverTips ? handleRowLeave : undefined}
    >
      <div className="flex gap-0 py-0" style={{ overflow: 'visible' }}>
      {sortedDaily.map((day, i) => {
        const icon = getIconFromCloudcover(day.cloudcover, day.icon, day.sunFraction, day.cloudLow, day.smoke);
        const hasPrecip = ['rain', 'snow', 'thunderstorm'].includes(day.icon);
        const isSunny = hasPrecip ? false : (day.cloudcover !== null ? day.cloudcover <= 20 : ['sunny'].includes(day.icon));
        return (
          <div
            key={day.date}
            className={`day-cell relative flex flex-col items-center gap-0 min-w-[48px] px-0 py-0 rounded cursor-pointer ${i===0 ? 'bg-cream-dark/50' : ''}`}
            style={day.smoke ? { background: SMOKE_TINT[day.smoke] } : undefined}
            onClick={() => onDayClick?.()}
            onMouseEnter={hoverTips ? (e) => handleCellEnter(i, e) : undefined}
          >
            {isSunny && <div style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%) translateY(95%) scaleX(0.6) scaleY(1.4)', width: '60px', height: '60px', pointerEvents: 'none', zIndex: 0, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,226,107,0.3) 0%, rgba(255,226,107,0.1) 40%, transparent 70%)', animation: 'sunglowPulse 6s ease-in-out infinite' }}/>}
            <span className="font-bebas-bold text-sm leading-none" style={{ color: '#8B9B99' }}>
              {isToday(day.date) ? t('thisDay') : getDayAbbrev(day.date)}
            </span>
            <span className="font-bebas-bold text-xs leading-none" style={{ letterSpacing: '0.04em', color: '#8B9B99' }}>{getDayMonth(day.date)}</span>
            <WeatherIcon type={icon} className="w-8 h-8"/>
            <span className="font-bebas-bold text-sm leading-none text-charcoal-muted" style={{ letterSpacing: '0.04em', marginTop: '4px' }}>
              {day.cloudcover !== null ? `${day.cloudcover}%` : '--'}
            </span>
            {(() => {
              // Bande dorée étiquetée: les segments AM | PM du projet. Doré (intensité graduée) si le
              // créneau s'annonce beau, éteint sinon. La bande n'apparaît que si au moins un créneau est bon.
              const segs = shootSlots.map((slot) => {
                const w = slot === 'AM' ? day.am : day.pm;
                const pct = w && w.frac != null ? Math.round(w.frac * 100) : null;
                const good = w && !w.precip && pct != null && pct >= SHOOT_OPP_MIN;
                return { slot, good, col: good ? SUN_DIRECT_COLOR(pct) : null };
              });
              if (!segs.some((s) => s.good)) return null;
              return (
                <div style={{ marginTop: '3px', display: 'flex', gap: '1.5px', width: segs.length > 1 ? '40px' : '24px' }}>
                  {segs.map((s) => (
                    <div key={s.slot} className="font-bebas-bold" style={{ flex: 1, height: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: s.good ? s.col : 'rgba(255,255,255,0.08)', color: s.good ? '#412402' : 'rgba(255,255,255,0.3)', fontSize: '11px', letterSpacing: '0.02em', lineHeight: 1 }}>
                      <span style={{ position: 'relative', top: '1px' }}>{s.slot}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        );
      })}
      </div>
      {!isMobile && hoveredDay && ReactDOM.createPortal(
        <div 
          className="whitespace-nowrap px-3 py-2"
          style={{ 
            position: 'fixed',
            zIndex: 9999,
            top: rowRef.current ? rowRef.current.getBoundingClientRect().bottom + 12 : 0, 
            left: rowRef.current ? rowRef.current.getBoundingClientRect().left + displayX : 0, 
            transform: 'translateX(-50%)', 
            backgroundColor: 'var(--bg-primary)', 
            border: '1px solid var(--text-muted)', 
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            pointerEvents: 'none',
            opacity: visible ? 1 : 0,
            transition: 'opacity 0.25s ease'
          }}
        >
          <div className="absolute -top-2 w-0 h-0" style={{ left: `calc(50% + ${cellCenterX - displayX}px)`, transform: 'translateX(-50%)', borderLeft: '8px solid transparent', borderRight: '8px solid transparent', borderBottom: '8px solid var(--text-muted)' }}/>
          <div className="flex gap-2">
            <DayPeriodIcon label={t('sunrise')} period="sunrise" icon="sunrise" day={hoveredDay} hourly={hourly} sunriseHour={hoveredDay.sunrise ? new Date(hoveredDay.sunrise).getHours() : 6} sunsetHour={hoveredDay.sunset ? new Date(hoveredDay.sunset).getHours() : 20}/>
            <DayPeriodIcon label={t('am')} period="am" day={hoveredDay} hourly={hourly} sunriseHour={hoveredDay.sunrise ? new Date(hoveredDay.sunrise).getHours() : 6} sunsetHour={hoveredDay.sunset ? new Date(hoveredDay.sunset).getHours() : 20}/>
            <DayPeriodIcon label={t('pm')} period="pm" day={hoveredDay} hourly={hourly} sunriseHour={hoveredDay.sunrise ? new Date(hoveredDay.sunrise).getHours() : 6} sunsetHour={hoveredDay.sunset ? new Date(hoveredDay.sunset).getHours() : 20}/>
            <DayPeriodIcon label={t('sunset')} period="sunset" icon="sunset" day={hoveredDay} hourly={hourly} sunriseHour={hoveredDay.sunrise ? new Date(hoveredDay.sunrise).getHours() : 6} sunsetHour={hoveredDay.sunset ? new Date(hoveredDay.sunset).getHours() : 20}/>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export const DayPeriodIcon = ({ label, period, icon, day, hourly, sunriseHour, sunsetHour }) => {
  const getIconFromCloudAndPrecip = (cloudcover, dominantIcon, sunFraction = null, cloudLow = null, smoke = 0) => {
    if (dominantIcon === 'thunderstorm') return 'thunderstorm';
    if (dominantIcon === 'snow') return 'snow';
    if (dominantIcon === 'rain') return 'rain';
    // Fumee de feux: signalee par la teinte de fond seulement; l'icone reste la vraie meteo.
    const veil = veilIcon(cloudcover, cloudLow, sunFraction);
    if (veil) return veil;
    return cloudcoverToIcon(cloudcover);
  };
  
  // Calculer les heures de début/fin selon la période
  let startHour, endHour;
  if (period === 'sunrise') {
    startHour = sunriseHour - 1;
    endHour = sunriseHour + 1;
  } else if (period === 'am') {
    startHour = 8;
    endHour = 11;
  } else if (period === 'pm') {
    startHour = 13;
    endHour = 16;
  } else if (period === 'sunset') {
    startHour = sunsetHour - 1;
    endHour = sunsetHour + 1;
  }
  
  const dayDate = new Date(day.date + 'T00:00:00');
  let avgCloud = null;
  let avgFraction = day.sunFraction ?? null;
  let avgLow = day.cloudLow ?? null;
  let dominantIcon = null;
  
  if (hourly?.length) {
    const periodData = hourly.filter(h => {
      const hDate = new Date(h.time);
      const hHour = hDate.getHours();
      return hDate.toDateString() === dayDate.toDateString() && hHour >= startHour && hHour < endHour;
    });
    if (periodData.length) {
      // Only use hours with actual cloudcover data
      const withCloud = periodData.filter(h => h.cloudcover != null);
      if (withCloud.length) {
        avgCloud = Math.round(withCloud.reduce((a, b) => a + b.cloudcover, 0) / withCloud.length);
      } else {
        // Fallback to daily cloudcover
        avgCloud = day.cloudcover;
      }
      const withFrac = periodData.filter(h => h.sunFraction != null);
      if (withFrac.length) avgFraction = withFrac.reduce((a, b) => a + b.sunFraction, 0) / withFrac.length;
      const withLow = periodData.filter(h => h.cloudLow != null);
      if (withLow.length) avgLow = Math.round(withLow.reduce((a, b) => a + b.cloudLow, 0) / withLow.length);
      // Find dominant precipitation type
      const precipIcons = periodData.map(h => h.icon).filter(i => ['thunderstorm', 'rain', 'snow'].includes(i));
      if (precipIcons.length > 0) {
        if (precipIcons.includes('thunderstorm')) dominantIcon = 'thunderstorm';
        else if (precipIcons.includes('snow')) dominantIcon = 'snow';
        else if (precipIcons.includes('rain')) dominantIcon = 'rain';
      }
    } else {
      // No hourly data for this period: fallback to daily
      avgCloud = day.cloudcover;
    }
  } else {
    avgCloud = day.cloudcover;
  }
  
  return (
    <div className="flex flex-col items-center" style={day.smoke ? { background: SMOKE_TINT[day.smoke], borderRadius: '6px', padding: '2px 4px' } : undefined}>
      {icon === 'sunrise' ? (
        <span className="font-bebas-bold text-xl" style={{ letterSpacing: '0.04em', color: '#5E6C6A', height: '32px', display: 'flex', alignItems: 'center' }}>{day.sunrise ? formatTime(day.sunrise) : '--:--'}</span>
      ) : icon === 'sunset' ? (
        <span className="font-bebas-bold text-xl" style={{ letterSpacing: '0.04em', color: '#5E6C6A', height: '32px', display: 'flex', alignItems: 'center' }}>{day.sunset ? formatTime(day.sunset) : '--:--'}</span>
      ) : (
        <span className="font-bebas-bold text-xl" style={{ letterSpacing: '0.04em', color: '#5E6C6A', height: '32px', display: 'flex', alignItems: 'center' }}>{label}</span>
      )}
      {avgCloud !== null ? (
        <>
          <WeatherIcon type={getIconFromCloudAndPrecip(avgCloud, dominantIcon, avgFraction, avgLow, day.smoke)} className="w-8 h-8"/>
          <span className="font-bebas-bold text-sm text-charcoal-muted">{avgCloud}%</span>
        </>
      ) : (
        <span className="text-charcoal-muted text-sm">--</span>
      )}
    </div>
  );
};

export const HourlyWeather = ({ hourly, sunrise, sunset }) => {
  const { t } = useLang();
  if (!hourly?.length) return <div className="flex gap-3 py-4">{[...Array(12)].map((_,i) => <div key={i} className="flex flex-col items-center gap-2 min-w-[44px]"><div className="w-6 h-3 bg-cream-dark rounded animate-pulse"/><div className="w-6 h-6 bg-cream-dark rounded-full animate-pulse"/><div className="w-6 h-3 bg-cream-dark rounded animate-pulse"/></div>)}</div>;
  const sunriseH = sunrise ? new Date(sunrise).getHours() : null;
  const sunsetH = sunset ? new Date(sunset).getHours() : null;
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const filtered = hourly.filter(h => new Date(h.time) >= oneHourAgo).slice(0, 24);
  
  const getIconForHour = (h, isNight) => {
    const cc = h.cloudcover != null ? h.cloudcover : null;
    const origIcon = h.icon;
    if (origIcon === 'thunderstorm') return 'thunderstorm';
    if (origIcon === 'snow') return 'snow';
    if (origIcon === 'rain') return 'rain';
    if (cc === null) return origIcon || 'cloudy';
    return cloudcoverToIcon(cc, isNight);
  };
  
  return (
    <div className="relative">
      <div className="flex gap-2 py-4 overflow-x-auto hour-scroll">
        {filtered.map(h => {
          const hr = new Date(h.time).getHours();
          const isSunrise = sunriseH === hr;
          const isSunset = sunsetH === hr;
          const isNight = sunriseH && sunsetH && (hr < sunriseH || hr >= sunsetH);
          const icon = getIconForHour(h, isNight);
          return (
            <div key={h.time} className={`flex flex-col items-center gap-1 min-w-[44px] px-1 py-2 rounded ${isNight ? 'bg-charcoal/5' : ''}`}>
              <span className={`font-bebas-bold text-xs ${isSunrise || isSunset ? 'text-orange font-bold' : 'text-charcoal-muted'}`}>
                {isSunrise ? formatTime(sunrise).replace(':','H') : isSunset ? formatTime(sunset).replace(':','H') : `${hr}H`}
              </span>
              <WeatherIcon type={icon} className={`w-5 h-5 ${isNight ? 'opacity-60' : ''}`}/>
              <span className={`text-sm font-medium ${h.temp <= 0 ? 'text-blue-500' : h.temp >= 25 ? 'text-red-500' : 'text-charcoal'}`} style={{ marginTop: '3px' }}>{h.temp}°</span>
              <span className="text-[10px] text-charcoal-muted">{h.wind} <span className="text-[8px]">{t('kmh')}</span></span>
            </div>
          );
        })}
      </div>
      <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-cream to-transparent pointer-events-none"/>
    </div>
  );
};
