import React, { useEffect, useRef, useState } from 'react';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useFitZoom } from '../hooks/useFitZoom.js';
import { useViewportWidth } from '../hooks/useViewportWidth.js';
import { afterEntrance } from '../utils/entrance.js';
import { useSwipeActions } from '../hooks/useSwipeActions.js';
import { useLang } from '../i18n/LangProvider.jsx';
import { MandateType, renderMandate } from '../projects/constants.js';
import { useStore } from '../projects/StoreProvider.jsx';
import { daysSince, formatDateShort, formatDuration, formatTime } from '../utils/dates.js';
import { fetchWeather } from '../weather/api.js';
import { calcDeparture } from '../weather/departure.js';
import { useWeatherStatus } from '../weather/WeatherStatusProvider.jsx';
import { ShootCheckIcon, StarIcon, TrashIcon } from './icons/misc.jsx';
import { WeatherRow, weatherRowDismiss } from './WeatherRow.jsx';
import { getTravelTime } from '../maps/google.js';
import { checkLocationPermission, getCurrentPosition } from '../native/geolocation.js';
import { liveActivityAvailable, pickSunTarget, startShootActivity } from '../native/liveActivity.js';
import { useShootOfDay } from '../native/shootOfDay.js';
import { dayIcon } from '../weather/iconsLogic.js';

export const ProjectCard = ({ project, index = 0, onSelect, onMouseDownDrag, openActionsId, setOpenActionsId }) => {
  const { advanceProject, deleteProject } = useStore();
  const { t } = useLang();
  const { reportWeather, clearWeather } = useWeatherStatus();
  const [weather, setWeather] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReady, setConfirmReady] = useState(false);
  const [confirmDone, setConfirmDone] = useState(false);

  useEffect(() => {
    if (!project.lat || !project.lng) return;
    let cancelled = false;
    (async () => {
      const result = await fetchWeather(project.lat, project.lng);
      if (cancelled) return;
      if (result.data) {
        setWeather(result.data);
        reportWeather(project.id, {
          state: result.fromCache ? 'stale' : 'ok',
          error: result.error || null,
          cachedAt: result.cachedAt || null,
        });
      } else {
        // Aucune donnee a montrer pour cette carte: on signale l'echec au contexte.
        setWeather(null);
        reportWeather(project.id, { state: 'error', error: result.error, status: result.status });
      }
    })();
    return () => { cancelled = true; };
  }, [project.lat, project.lng, project.id, reportWeather]);

  // Quand la carte disparait (delete, changement de statut), on retire son rapport du contexte.
  useEffect(() => () => { clearWeather(project.id); }, [project.id, clearWeather]);
  const sun = weather?.daily?.[0];
  const departAM = calcDeparture(sun?.sunrise, project.travelTime?.durationSeconds);
  const departPM = calcDeparture(sun?.sunset, project.travelTime?.durationSeconds);

  // Shooting du jour (appui long dans la liste): le nom porte une coche dorée et, dans l'app iPhone, la carte démarre
  // ou met à jour l'activité en direct (écran verrouillé, Dynamic Island): soleil du jour, météo comme la bande
  // météo, trajet depuis la position actuelle si elle est permise (sinon le trajet planifié), départ, et l'événement
  // solaire visé par la barre et le compte à rebours.
  const shootOfDay = useShootOfDay();
  const isShootOfDay = shootOfDay?.projectId === project.id;
  useEffect(() => {
    if (!isShootOfDay || !liveActivityAvailable || !weather?.daily?.length) return;
    let cancelled = false;
    (async () => {
      let travel = project.travelTime || null;
      try {
        if ((await checkLocationPermission()) === 'granted') {
          const pos = await getCurrentPosition({ enableHighAccuracy: false, timeout: 8000 });
          travel = await getTravelTime(pos.coords.latitude, pos.coords.longitude, project.lat, project.lng);
        }
      } catch (e) { /* position indisponible: trajet planifié */ }
      if (cancelled) return;
      const target = pickSunTarget(weather.daily, project.orientation);
      if (!target) return;
      const depart = calcDeparture(target.isSunrise ? target.day.sunrise : target.day.sunset, travel?.durationSeconds);
      startShootActivity(project.id, {
        name: project.name,
        sunriseText: formatTime(target.day.sunrise),
        sunsetText: formatTime(target.day.sunset),
        icon: dayIcon(target.day),
        cloudText: target.day.cloudcover != null ? `${target.day.cloudcover}%` : '--',
        travelText: travel?.durationSeconds ? formatDuration(travel.durationSeconds).replace(/^0/, '') : null,
        kmText: travel?.distanceMeters ? `${Math.round(travel.distanceMeters / 1000)} KM` : null,
        departText: depart ? formatTime(depart).replace(':', 'H') : null,
        targetDate: Math.round(target.date.getTime() / 1000),
        targetIsSunrise: target.isSunrise,
        startDate: Math.round(target.barStart.getTime() / 1000),
      });
    })();
    return () => { cancelled = true; };
  }, [isShootOfDay, weather, project.id, project.name, project.lat, project.lng, project.orientation, project.travelTime]);

  // Couleurs adaptées au mode sombre/clair
  const colorActive = '#FAF9F7';
  const colorInactive = '#404A48';
  const colorCharcoal = '#8B9B99';
  const colorRed = '#d83152';
  
  const handleDelete = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (confirmDelete && confirmReady) {
      deleteProject(project.id);
    } else if (!confirmDelete) {
      setConfirmDelete(true);
      setConfirmReady(false);
      setConfirmDone(false);
      setTimeout(() => setConfirmReady(true), 600);
      setTimeout(() => { setConfirmDelete(false); setConfirmReady(false); }, 4000);
    }
  };
  
  const handleDone = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (confirmDone) {
      advanceProject(project.id);
      setConfirmDone(false);
    } else {
      setConfirmDone(true);
      setConfirmDelete(false);
      setTimeout(() => setConfirmDone(false), 3000);
    }
  };

  const isMobile = useIsMobile();
  const cardRef = useRef(null);
  const scrollRef = useRef(null);
  const contentRef = useRef(null);
  const actionsRef = useRef(null);
  const haloWhiteRef = useRef(null);
  const actionsOpen = openActionsId === project.id;
  const setActionsOpen = (v) => setOpenActionsId(v ? project.id : null);
  const actionW = 160;
  // iPad (interface large au doigt, sans survol): le tiroir de suppression se révèle en glissant la carte vers la
  // gauche, comme sur téléphone (corbeille seule; « Passer en édition » reste dans la fiche).
  const [touchOnly] = useState(() => window.matchMedia('(hover: none)').matches);
  const swipeWide = !isMobile && touchOnly;

  useSwipeActions({ cardRef, contentRef, actionsRef, haloWhiteRef, scrollRef, actionW, isMobile: isMobile || swipeWide, setActionsOpen, syncHalo: false, variant: isMobile ? 'mobile' : 'wide' });

  // Rangée desktop sur iPad en portrait et dans les fenêtres étroites (sous 1024 px): la colonne CRÉÉ quitte la
  // rangée (elle reste dans la fiche) et la rangée se réduit juste assez pour tenir dans la carte au lieu d'être
  // coupée à droite.
  const compactRow = useViewportWidth() < 1024;
  const rowBoxRef = useRef(null);
  const rowRef = useRef(null);
  const rowZoom = useFitZoom(rowBoxRef, rowRef, !isMobile);

  const isFirstMount = useRef(true);
  useEffect(() => afterEntrance(() => { isFirstMount.current = false; }), []);

  if (isMobile) {
    const tx = actionsOpen ? actionW : 0;
    const ease = 'transform 0.6s cubic-bezier(0.2, 1.5, 0.4, 1)';
    return (
      <div ref={cardRef} data-open={actionsOpen} data-project-id={project.id} className={isFirstMount.current ? 'animate-card-in' : ''}
        style={{ position: 'relative', margin: '0 12px', marginBottom: '40px', ...(isFirstMount.current ? { animationDelay: `${0.05 + index * 0.05}s` } : {}), WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}
      >
        {/* Layer 2: fond (coins droits) + halos + contours flous */}
        <div style={{ position: 'absolute', top: 0, left: '-40px', right: 0, bottom: '-15px', borderRadius: '0px', overflow: 'hidden', background: 'rgba(0,0,0,0.14)', WebkitMaskImage: 'linear-gradient(to right, black, black calc(100% - 50px), transparent), linear-gradient(to bottom, transparent, black 50px, black calc(100% - 50px), transparent)', WebkitMaskComposite: 'destination-in', maskImage: 'linear-gradient(to right, black, black calc(100% - 50px), transparent), linear-gradient(to bottom, transparent, black 50px, black calc(100% - 50px), transparent)', maskComposite: 'intersect', pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: '50%', bottom: '-350px', width: '700px', height: '500px', borderRadius: '50%', background: 'radial-gradient(ellipse 60% 45%, rgba(100,200,190,0.6) 0%, rgba(100,200,190,0.3) 40%, rgba(100,200,190,0) 70%)', mixBlendMode: 'screen', pointerEvents: 'none', transform: 'translateX(-50%)' }}/>
          <div style={{ position: 'absolute', left: '-400px', bottom: '-400px', width: '660px', height: '660px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(251,227,127,0.4) 0%, rgba(251,227,127,0.1) 40%, rgba(251,227,127,0) 70%)', pointerEvents: 'none' }}/>
        </div>
        {/* Layer 1.5: masque (coins droits) + halo blanc central */}
        <div ref={haloWhiteRef} style={{ position: 'absolute', top: '-5px', left: '-40px', right: 0, bottom: '-5px', borderRadius: '0px', overflow: 'hidden', pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: '-500px', top: '50%', transform: 'translateY(-50%)', width: '660px', height: '660px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.04) 40%, rgba(255,255,255,0) 70%)', pointerEvents: 'none' }}/>
        </div>
        {/* Layer 1: contenu */}
        <div ref={contentRef} style={{ transform: `translateX(${-tx}px)`, transition: ease, padding: '5px 5px', position: 'relative', zIndex: 1, willChange: 'transform', backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
          {actionsOpen && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 10 }}
              onClick={() => { setActionsOpen(false); }}
            />
          )}
          <div onClick={() => { if (!actionsOpen) onSelect(project); }} style={{ display: 'flex', flexDirection: 'row', gap: '0' }}>
            {project.mandates?.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', paddingRight: '10px', borderRight: '1px solid rgba(255,255,255,0.15)', marginRight: '10px', flexShrink: 0, opacity: project.onHold ? 0.4 : 1, transition: 'opacity 0.3s' }}>
                {['INT', 'EXT', 'DRONE', 'DRONE+C', 'VID'].filter(x => project.mandates.includes(x)).map((m) => {
                  const label = m === 'DRONE+C' ? 'DRONE' : m === 'DRONE' ? 'DRONE' : m;
                  return <span key={m} className="font-bebas-book uppercase" style={{ fontSize: '15px', lineHeight: '0.9', letterSpacing: '0.04em', color: colorActive }}>{m === 'DRONE+C' ? <span><span style={{ color: colorActive }}>DRON</span><span style={{ color: '#d83152' }}>E</span></span> : label}</span>;
                })}
              </div>
            )}
            <div style={{ flex: 1, textAlign: 'left', display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-start' }}>
              <span className="font-bebas-book text-charcoal" style={{ letterSpacing: '0.04em', fontSize: '24px', lineHeight: '0.9', opacity: project.onHold ? 0.4 : 1, transition: 'opacity 0.3s' }}>
                {project.name} {project.isContest && <StarIcon/>}{isShootOfDay && <ShootCheckIcon/>}
              </span>
            </div>
          </div>
          <div style={{ height: '1px', background: 'linear-gradient(to right, rgba(255,255,255,0.15), rgba(255,255,255,0))', margin: '4px -5px 0 -5px' }}/>
          <div style={{ position: 'relative', margin: '0 -5px' }}>
            <div ref={scrollRef}
              style={{ display: 'flex', overflowX: actionsOpen ? 'hidden' : 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', marginTop: '6px', opacity: project.onHold ? 0.1 : 1, transition: 'opacity 0.3s' }}
            >
              <div style={{ flexShrink: 0 }} onClick={() => { if (!actionsOpen) onSelect(project); }}>
                {project.lat && project.lng ? <WeatherRow daily={weather?.daily} hourly={weather?.hourly} orientation={project.orientation} onDayClick={() => { if (!actionsOpen) onSelect(project); }}/> : <p className="text-charcoal-muted text-sm italic py-2">{t('weatherUnavailable')}</p>}
              </div>
            </div>
            {project.onHold && (
              <div style={{ position: 'absolute', left: '5px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                <span className="font-bebas-regular uppercase" style={{ color: '#7dd3c6', fontSize: '20px', letterSpacing: '0.04em', lineHeight: 1 }}>{t('onHold')}</span>
              </div>
            )}
          </div>
        </div>
        <div ref={actionsRef} style={{
          position: 'absolute', right: 0, top: 0, bottom: 0, width: `${actionW}px`,
          display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: '16px', paddingRight: '20px',
          transform: `translateX(${actionW - tx}px)`, transition: ease, zIndex: 1
        }}>
          {/* Red/pink glow - moves with swipe */}
          <div style={{ position: 'absolute', left: '100%', top: '50%', width: '400px', height: '400px', borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(216,49,82,0.8) 0%, rgba(216,49,82,0.3) 40%, rgba(216,49,82,0) 70%)', mixBlendMode: 'screen', pointerEvents: 'none', transform: 'translate(-17%, calc(-50% + 25px)) scaleX(1.22)' }}/>
          {confirmDelete ? <button className="font-bebas-bold" style={{ background: 'none', border: 'none', color: '#FF3B30', fontSize: '15px', cursor: 'pointer', letterSpacing: '0.03em', textShadow: '0 0 12px rgba(255,59,48,0.4)', padding: '6px 2px', whiteSpace: 'nowrap', position: 'relative', top: '25px' }} onClick={() => { deleteProject(project.id); }}>{t('deleteConfirm')}</button> : <button style={{ background: 'none', border: 'none', padding: '6px 2px', cursor: 'pointer', color: '#FF3B30', filter: 'drop-shadow(0 0 4px rgba(255,59,48,0.3))', position: 'relative', top: '22px' }} onClick={() => { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000); }}><TrashIcon/></button>}
        </div>
      </div>
    );
  }

  // Desktop layout (unchanged; sur iPad, enveloppé dans le calque qui glisse pour révéler le tiroir)
  const txWide = swipeWide && actionsOpen ? actionW : 0;
  const easeWide = 'transform 0.6s cubic-bezier(0.2, 1.5, 0.4, 1)';
  const desktopCard = (
    <div
      className={`project-card py-4 px-4 mb-3 hover:bg-cream-dark/30 overflow-hidden animate-card-in border-b border-adaptive`}
      style={{ animationDelay: `${0.05 + index * 0.05}s` }}
      onMouseDown={onMouseDownDrag ? (e) => onMouseDownDrag(e, project.id, index) : undefined}
    >
      <div onClick={() => onSelect(project)} className="cursor-pointer" onMouseEnter={() => { if (weatherRowDismiss.current) { weatherRowDismiss.current(); weatherRowDismiss.current = null; } }}>
        <div className="flex items-start justify-between gap-4" style={{ marginBottom: '-10px' }}>
          <h3 className="font-bebas-book text-charcoal flex items-center gap-2" style={{ letterSpacing: '0.04em', fontSize: '35px', opacity: project.onHold ? 0.4 : 1, transition: 'opacity 0.3s' }}>
            {project.name} {project.isContest && <StarIcon/>}
          </h3>
        </div>
      </div>
      <div className="card-info-flare" style={{ left: '-350px', top: '-50px' }}></div>
      <div ref={rowBoxRef} style={{ position: 'relative' }}>
      <div ref={rowRef} className="flex items-center gap-0" style={{ width: 'max-content', zoom: rowZoom < 1 ? rowZoom : undefined, opacity: project.onHold ? 0.1 : 1, transition: 'opacity 0.3s' }}>
        {/* Pendant le chargement, le squelette (plus large que les 9 jours) est rogné à leur largeur: la rangée
            garde sa taille finale et sa réduction sur iPad ne saute pas à l'arrivée de la météo. */}
        <div className="min-w-0" style={{ minWidth: '432px', overflow: "visible", ...(weather ? null : { width: '432px', overflow: 'hidden' }) }}>
          {project.lat && project.lng ? <WeatherRow daily={weather?.daily} hourly={weather?.hourly} orientation={project.orientation} onDayClick={() => onSelect(project)} tapOpensDetail/> : <p className="text-charcoal-muted text-sm italic py-2 cursor-pointer" onClick={() => onSelect(project)}>{t('weatherUnavailable')}</p>}
        </div>
        <div onMouseEnter={() => { if (weatherRowDismiss.current) { weatherRowDismiss.current(); weatherRowDismiss.current = null; } }} onClick={() => onSelect(project)} className="cursor-pointer flex items-stretch flex-shrink-0 font-bebas-bold uppercase ml-4" style={{ letterSpacing: '0.04em', fontSize: '22px', minHeight: '110px', lineHeight: '1', marginBottom: '-16px' }}>
          <div className="flex flex-col justify-center pl-2 border-l border-adaptive" style={{ width: '75px' }}>
            {Object.values(MandateType).map(m => {
              const active = project.mandates?.includes(m);
              const alwaysShow = m === 'INT' || m === 'EXT' || m === 'DRONE';
              if (!alwaysShow && !active) return null;
              return <React.Fragment key={m}>{renderMandate(m, active ? colorActive : colorInactive)}</React.Fragment>;
            })}
          </div>
          <div className="flex flex-col justify-center pl-2 ml-4 border-l border-adaptive" style={{ minWidth: '85px' }}>
            <span style={{ color: colorInactive }}>{t('sun')}</span>
            <span style={{ color: (project.orientation?.includes('AM') && sun) ? colorActive : colorInactive }}>
              AM {sun ? formatTime(sun.sunrise) : '-'}
            </span>
            <span style={{ color: (project.orientation?.includes('PM') && sun) ? colorActive : colorInactive }}>
              PM {sun ? formatTime(sun.sunset) : '-'}
            </span>
          </div>
          <div className="flex flex-col justify-center pl-2 ml-6 border-l border-adaptive" style={{ minWidth: '80px' }}>
            <span style={{ color: colorInactive }}>{t('travel')}</span>
            <span style={{ color: project.travelTime?.durationSeconds ? colorActive : colorInactive }}>{project.travelTime?.durationSeconds ? formatDuration(project.travelTime.durationSeconds) : '-'}</span>
            {project.travelTime?.distanceMeters > 0 ? <span style={{ color: colorCharcoal, letterSpacing: '0.1em', marginTop: '-5px' }} className="text-lg">{Math.round(project.travelTime.distanceMeters / 1000)} KM</span> : <span style={{ color: 'transparent' }}>&nbsp;</span>}
          </div>
          <div className="flex flex-col justify-center pl-2 ml-6 border-l border-adaptive" style={{ minWidth: '75px' }}>
            {/* Deux lignes comme la colonne SOLEIL: départ du matin (lever) puis du soir (coucher), atténuées selon l'orientation. */}
            <span style={{ color: colorInactive }}>{t('depart')}</span>
            <span style={{ color: (project.orientation?.includes('AM') && departAM) ? colorActive : colorInactive }}>{departAM ? formatTime(departAM).replace(':','H') : '-'}</span>
            <span style={{ color: (project.orientation?.includes('PM') && departPM) ? colorActive : colorInactive }}>{departPM ? formatTime(departPM).replace(':','H') : '-'}</span>
          </div>
          {!compactRow && <div className="flex flex-col justify-center text-left pl-2 ml-4 border-l border-adaptive" style={{ minWidth: '120px' }}>
            <span style={{ color: colorInactive }}>{t('created')}</span>
            <span style={{ color: colorActive }}>{formatDateShort(project.createdAt)}</span>
            <span style={{ color: colorCharcoal }}>{daysSince(project.createdAt)} {daysSince(project.createdAt) <= 1 ? t('day') : t('days')}</span>
          </div>}
        </div>
      </div>
      {project.onHold && (
        <div style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
          <span className="font-bebas-regular uppercase" style={{ color: '#7dd3c6', fontSize: '25px', letterSpacing: '0.04em', lineHeight: 1 }}>{t('onHold')}</span>
        </div>
      )}
      </div>
    </div>
  );
  return (
    <div className="card-glow-wrap" ref={swipeWide ? cardRef : undefined} data-open={swipeWide ? actionsOpen : undefined}>
    {swipeWide ? (
      <div ref={contentRef} style={{ position: 'relative', zIndex: 1, transform: `translateX(${-txWide}px)`, transition: easeWide }}>
        {actionsOpen && <div style={{ position: 'absolute', inset: 0, zIndex: 10 }} onClick={() => setActionsOpen(false)}/>}
        {desktopCard}
      </div>
    ) : desktopCard}
    {swipeWide && (
      <div ref={actionsRef} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${actionW}px`, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: '28px', transform: `translateX(${actionW - txWide}px)`, transition: easeWide, zIndex: 1 }}>
        {/* Halo rouge du tiroir, comme sur téléphone (il suit le glissement). Halo et boutons descendent de 29 px: centrés
            sur la rangée météo et les colonnes plutôt que sur toute la carte (titre compris), comme le décalage du téléphone. */}
        <div style={{ position: 'absolute', left: '100%', top: '50%', width: '400px', height: '400px', borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(216,49,82,0.8) 0%, rgba(216,49,82,0.3) 40%, rgba(216,49,82,0) 70%)', mixBlendMode: 'screen', pointerEvents: 'none', transform: 'translate(-17%, calc(-50% + 29px)) scaleX(1.22)' }}/>
        {confirmDelete ? <button className="font-bebas-bold" style={{ background: 'none', border: 'none', color: '#FF3B30', fontSize: '16px', cursor: 'pointer', letterSpacing: '0.03em', textShadow: '0 0 12px rgba(255,59,48,0.4)', padding: '6px 2px', whiteSpace: 'nowrap', position: 'relative', top: '29px' }} onClick={() => { deleteProject(project.id); }}>{t('deleteConfirm')}</button> : <button style={{ background: 'none', border: 'none', padding: '6px 2px', cursor: 'pointer', color: '#FF3B30', filter: 'drop-shadow(0 0 4px rgba(255,59,48,0.3))', position: 'relative', top: '29px' }} onClick={() => { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000); }}><TrashIcon/></button>}
      </div>
    )}
    <div className="hidden lg:flex items-center gap-4 card-actions" style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)' }}>
      <button onClick={handleDone} className="font-bebas-bold uppercase" style={{ background: 'none', border: 'none', color: confirmDone ? '#d83152' : colorCharcoal, fontSize: '16px', cursor: 'pointer', padding: '6px 2px', letterSpacing: '0.03em', transition: 'text-shadow 0.2s, color 0.2s', textShadow: confirmDone ? '0 0 12px rgba(216,49,82,0.4), 0 0 30px rgba(216,49,82,0.15)' : 'none' }} onMouseEnter={e => { e.target.style.color = '#FAF9F7'; e.target.style.textShadow = '0 0 12px rgba(255,255,255,0.25), 0 0 30px rgba(255,255,255,0.1)'; }} onMouseLeave={e => { if (!confirmDone) { e.target.style.color = colorCharcoal; e.target.style.textShadow = 'none'; } else { e.target.style.color = '#d83152'; e.target.style.textShadow = '0 0 12px rgba(216,49,82,0.4), 0 0 30px rgba(216,49,82,0.15)'; } }}>{confirmDone ? t('moveToEditingConfirm') : t('moveToEditing')}</button>
      {confirmDelete ? <button onClick={handleDelete} className="font-bebas-bold" style={{ background: 'none', border: 'none', color: '#FF3B30', fontSize: '16px', cursor: confirmReady ? 'pointer' : 'default', letterSpacing: '0.03em', transition: 'color 0.3s', textShadow: confirmReady ? '0 0 12px rgba(255,59,48,0.4)' : 'none', padding: '6px 2px' }}>{t('deleteConfirm')}</button> : <button onClick={handleDelete} className="p-2 trash-btn text-red-500" title={t('delete')}><TrashIcon/></button>}
    </div>
    </div>
  );
};
