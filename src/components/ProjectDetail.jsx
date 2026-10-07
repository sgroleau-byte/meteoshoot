import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import SunCalc from 'suncalc';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { useViewportWidth } from '../hooks/useViewportWidth.js';
import { useLang } from '../i18n/LangProvider.jsx';
import * as AppleSat from '../maps/appleSat.js';
import { geocodeAddress, getTravelTime, reverseGeocode, typedAddressFallback } from '../maps/google.js';
import { StreetLabels } from '../maps/streetLabels.js';
import { MandateType, renderMandate } from '../projects/constants.js';
import { MAX_PROJECT_FILES_MB, fileHelpers } from '../projects/files.js';
import { toggleMandate } from '../projects/helpers.js';
import { useStore } from '../projects/StoreProvider.jsx';
import { Scene3D } from '../scene3d/Scene3D.jsx';
import { loadScene } from '../scene3d/data.js';
import { daysSince, formatDateShort, formatDuration, formatTime } from '../utils/dates.js';
import { linkifyPhonesInEditor } from '../utils/linkify.js';
import { fetchWeather } from '../weather/api.js';
import { calcDeparture, calcDepartureFromShootTime } from '../weather/departure.js';
import { getElevationProfile, isTerrainShadow } from '../weather/elevation.js';
import { cloudcoverToIcon, veilIcon } from '../weather/iconsLogic.js';
import { StarIcon } from './icons/misc.jsx';
import { SMOKE_TINT, WeatherIcon } from './icons/WeatherIcon.jsx';
import { DateWheelPicker, FolderCombo, TimeWheelPicker } from './pickers.jsx';
import { rtOpenMap } from './route/RouteView.jsx';
import { WeatherRow } from './WeatherRow.jsx';

export const ProjectDetail = ({ projectId, onClose }) => {
  const { projects, updateProject, advanceProject, revertProject, deleteProject, prefs } = useStore();
  const { user } = useAuth();
  const { t } = useLang();
  const project = projects.find(p => p.id === projectId);
  const [weather, setWeather] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [confirmDone, setConfirmDone] = useState(false);
  const [mapType, setMapType] = useState('hybrid'); // 'hybrid' (SAT, Google) ou 'sat2' (SAT2, satellite Plans d'Apple)
  const [mapKitReady, setMapKitReady] = useState(false);
  // SAT2 ne remplace la carte qu'une fois MapKit chargé: d'ici là, SAT reste en place et utilisable.
  const mapEngine = mapType === 'sat2' && AppleSat.appleSatAvailable() && mapKitReady ? 'apple' : 'google';
  const [overlayTick, setOverlayTick] = useState(0); // +1 quand le calque de nuit d'une nouvelle carte a sa projection
  const [mapEpoch, setMapEpoch] = useState(0); // +1 à chaque carte créée: les dessins se refont sur la nouvelle
  const [activeEngine, setActiveEngine] = useState('google'); // moteur de la carte affichée (SAT2: désaturation des images seulement)
  const [view3d, setView3d] = useState(false); // vue 3D dans la fenêtre de la carte (SAT / SAT2 / 3D)
  const scene3dZoom = useRef(null); // zoom de la vue 3D (boutons + et -), rempli par Scene3D
  const [mapZoom, setMapZoom] = useState(project?.mapZoom || 16);
  const [showMapFull, setShowMapFull] = useState(false);
  const [mapMenuOpen, setMapMenuOpen] = useState(false);
  const mapRevealedRef = React.useRef(false);
  const [mapRevealed, setMapRevealed] = useState(false);
  const [showSunLines, setShowSunLines] = useState(true);
  const [sunDate, setSunDate] = useState(() => new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [editingCreatedDate, setEditingCreatedDate] = useState(false);
  const [editingShotDate, setEditingShotDate] = useState(false);
  const [detailPickerPos, setDetailPickerPos] = useState({ top: 0, left: 0 });
  const [shootTimePos, setShootTimePos] = useState(null); // roue de l'heure du shooting ouverte (position) ou null
  const originalDateRef = useRef(null);
  const isToday = React.useMemo(() => { const n = new Date(); return sunDate.getDate() === n.getDate() && sunDate.getMonth() === n.getMonth() && sunDate.getFullYear() === n.getFullYear(); }, [sunDate]);
  const [sunHour, setSunHour] = useState(0);
  const [sunHourDisplay, setSunHourDisplay] = useState(0);
  // Survol d'une heure de la météo horaire (souris): le curseur de la carte la suit, ombres et vue 3D avec lui.
  // Le survol de la météo horaire ne déplace plus le curseur (retiré le 5 octobre 2026: la 3D basculait en nuit au passage
  // de la souris sur les heures de nuit); seul le curseur pilote la date et l'heure.
  // Vue 3D: instant du curseur et météo horaire la plus proche (nuages bas, moyens, hauts, soleil direct).
  const sceneTimeMs = React.useMemo(() => { const d = new Date(sunDate); d.setHours(0, 0, 0, 0); return d.getTime() + sunHourDisplay * 3600000; }, [sunDate, sunHourDisplay]);
  // Au-delà de 36 h de prévision (ou dans le passé), la scène suppose une journée ensoleillée et aucune icône
  // météo n'est affichée près du curseur: la prévision horaire n'est plus assez sûre pour piloter la lumière.
  const sceneRowCache = React.useRef(new WeakMap()); // même objet pour la même heure: la 3D ne se recalcule pas à chaque pas du curseur
  const sceneWeatherRow = React.useMemo(() => {
    if (!weather?.hourly?.length) return null;
    const now = Date.now(); if (sceneTimeMs > now + 36 * 3600000 || sceneTimeMs < now - 24 * 3600000) return null;
    let best = null, bd = Infinity;
    for (const h of weather.hourly) { const dd = Math.abs(new Date(h.time).getTime() - sceneTimeMs); if (dd < bd) { bd = dd; best = h; } }
    if (bd > 2 * 3600000) return null;
    // Les trois heures précédentes: la 3D garde le sol mouillé un moment après une averse.
    let row = sceneRowCache.current.get(best);
    if (!row) { const i = weather.hourly.indexOf(best); row = { ...best, prev: [1, 2, 3].map(k => weather.hourly[i - k] || null) }; sceneRowCache.current.set(best, row); }
    return row;
  }, [weather, sceneTimeMs]);
  const sunHourTargetRef = React.useRef(sunHour);
  const sunTimesSnapRef = React.useRef({ sr: 6, ss: 18 });
  
  // Smooth magnetic: gaussian-shaped pull, no hard edges
  const magneticSunHour = (raw) => raw;
  
  const rafRef = React.useRef(null);
  useEffect(() => {
    sunHourTargetRef.current = sunHour;
    const animate = () => {
      setSunHourDisplay(prev => {
        const diff = sunHourTargetRef.current - prev;
        if (Math.abs(diff) < 0.003) return sunHourTargetRef.current;
        rafRef.current = requestAnimationFrame(animate);
        return prev + diff * 0.3;
      });
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [sunHour]);
  const nightOpacity = React.useMemo(() => {
    if (!project?.lat || !project?.lng || !SunCalc) return 0;
    const st = SunCalc.getTimes(sunDate, project.lat, project.lng);
    const sr = st.sunrise ? st.sunrise.getHours() + st.sunrise.getMinutes()/60 : 6;
    const ss = st.sunset ? st.sunset.getHours() + st.sunset.getMinutes()/60 : 18;
    // Progressive: 0 during day, fade over 1h after sunset / before sunrise
    if (sunHour >= sr && sunHour <= ss) return 0;
    if (sunHour > ss && sunHour < ss + 1) return (sunHour - ss);
    if (sunHour < sr && sunHour > sr - 1) return (sr - sunHour);
    return 1;
  }, [sunHour, project?.lat, project?.lng, sunDate]);
  const mapIsNight = nightOpacity >= 1;
  const [editingName, setEditingName] = useState(false);
  const [addressCopied, setAddressCopied] = useState(false);
  const addressCopiedTimer = React.useRef(null);
  const addressInputRef = React.useRef(null);
  const autocompleteRef = React.useRef(null);
  const departureInputRef = React.useRef(null);
  const isMobile = useIsMobile();
  // Sous 1100 px (iPad en portrait, fenêtre étroite), la colonne de la carte n'a plus de place à droite des
  // champs de 700 px: la carte passe au-dessus, sur toute la largeur.
  const viewportWidth = useViewportWidth();
  const stackMap = !isMobile && viewportWidth < 1100;
  const departureAutocompleteRef = React.useRef(null);
  const mapContainerRef = React.useRef(null);
  const flareCanvasRef = React.useRef(null);
  const weatherCanvasRef = React.useRef(null);
  const weatherParticlesRef = React.useRef([]);
  const weatherAnimRef = React.useRef(null);
  
  // Weather particles effect behind slider
  useEffect(() => {
    if (isMobile) return;
    const canvas = weatherCanvasRef.current;
    if (!canvas) return;
    
    // Find hourly weather for current slider position
    const targetDate = new Date(sunDate);
    targetDate.setHours(Math.floor(sunHour), 0, 0, 0);
    const hourly = weather?.hourly?.find(h => {
      const ht = new Date(h.time);
      return ht.getFullYear() === targetDate.getFullYear() && ht.getMonth() === targetDate.getMonth() && ht.getDate() === targetDate.getDate() && ht.getHours() === targetDate.getHours();
    });
    
    if (!hourly) { 
      if (weatherAnimRef.current) cancelAnimationFrame(weatherAnimRef.current);
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      return; 
    }
    
    const precip = hourly.precip || 0;
    const temp = hourly.temp;
    const cloud = hourly.cloudcover || 0;
    const wind = hourly.wind || 0;
    const icon = hourly.icon || '';
    
    const isRain = precip > 0 && temp > 0;
    const isSnow = precip > 0 && temp <= 0;
    const isFog = icon.includes('fog') || icon.includes('mist');
    const hasParticles = isRain || isSnow || isFog;
    
    if (!hasParticles) {
      if (weatherAnimRef.current) cancelAnimationFrame(weatherAnimRef.current);
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      weatherParticlesRef.current = [];
      return;
    }
    
    const w = canvas.parentElement?.offsetWidth || 400;
    const h = canvas.parentElement?.offsetHeight || 200;
    canvas.width = w; canvas.height = h;
    
    // Initialize particles
    const count = isRain ? Math.min(60, Math.round(precip * 15)) : isSnow ? Math.min(40, Math.round(precip * 10)) : 25;
    if (weatherParticlesRef.current.length !== count) {
      weatherParticlesRef.current = Array.from({length: count}, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        speed: isRain ? 2 + Math.random() * 4 : isSnow ? 0.3 + Math.random() * 0.8 : 0.1 + Math.random() * 0.2,
        size: isRain ? 1 + Math.random() : isSnow ? 1.5 + Math.random() * 2.5 : 3 + Math.random() * 5,
        opacity: isRain ? 0.15 + Math.random() * 0.2 : isSnow ? 0.2 + Math.random() * 0.25 : 0.03 + Math.random() * 0.04,
        drift: isSnow ? -0.3 + Math.random() * 0.6 : isFog ? -0.1 + Math.random() * 0.2 : (wind > 10 ? 0.5 : 0),
        len: isRain ? 4 + Math.random() * 6 : 0,
      }));
    }
    
    const animate = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      
      weatherParticlesRef.current.forEach(p => {
        if (isRain) {
          ctx.strokeStyle = `rgba(180,200,220,${p.opacity})`;
          ctx.lineWidth = p.size * 0.5;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + p.drift, p.y + p.len);
          ctx.stroke();
          p.y += p.speed;
          p.x += p.drift;
        } else if (isSnow) {
          ctx.fillStyle = `rgba(255,255,255,${p.opacity})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          p.y += p.speed;
          p.x += p.drift + Math.sin(p.y * 0.02) * 0.3;
        } else if (isFog) {
          ctx.fillStyle = `rgba(200,200,210,${p.opacity})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          p.x += p.drift;
          p.y += Math.sin(p.x * 0.01) * 0.1;
        }
        
        if (p.y > h + 10) { p.y = -10; p.x = Math.random() * w; }
        if (p.x > w + 10) p.x = -10;
        if (p.x < -10) p.x = w + 10;
      });
      
      weatherAnimRef.current = requestAnimationFrame(animate);
    };
    
    if (weatherAnimRef.current) cancelAnimationFrame(weatherAnimRef.current);
    animate();
    
    return () => { if (weatherAnimRef.current) cancelAnimationFrame(weatherAnimRef.current); };
  }, [sunHour, sunDate, weather]);

  // Lens flare: 35mm prime style
  const drawLensFlare = React.useCallback((sunScreenX, sunScreenY, canvasW, canvasH, sunAltitude) => {
    const canvas = flareCanvasRef.current;
    if (!canvas) return;
    // Don't set canvas.width/height here: already set by caller
    const ctx = canvas.getContext('2d');
    
    // No flare if sun well below horizon
    if (sunAltitude <= -0.1) {
      // Moon glow at night
      const moonR = Math.min(canvasW, canvasH) * 0.12;
      const gradM = ctx.createRadialGradient(sunScreenX, sunScreenY, 0, sunScreenX, sunScreenY, moonR);
      gradM.addColorStop(0, 'rgba(220, 215, 200, 0.15)');
      gradM.addColorStop(0.3, 'rgba(200, 195, 185, 0.06)');
      gradM.addColorStop(1, 'rgba(200, 195, 185, 0)');
      ctx.fillStyle = gradM;
      ctx.fillRect(0, 0, canvasW, canvasH);
      return;
    }
    
    // Intensity: strongest near horizon (golden hour), fades as sun goes higher, fades to 0 at sunset
    const altDeg = sunAltitude * 180 / Math.PI;
    const intensity = altDeg < -3 ? 0 : altDeg < 0 ? (altDeg + 3) / 3 * 0.5 : altDeg < 5 ? 0.5 + altDeg / 10 : altDeg < 15 ? 1 : Math.max(0.35, 1 - (altDeg - 15) / 50);
    
    const cx = canvasW / 2, cy = canvasH / 2;
    const sx = sunScreenX, sy = sunScreenY;
    // Flare axis: sun → center → opposite
    const dx = cx - sx, dy = cy - sy;
    
    ctx.globalCompositeOperation = 'screen';
    
    // 1. Main sun glow: large warm bloom
    const mainR = Math.min(canvasW, canvasH) * 0.375 * intensity;
    const grad1 = ctx.createRadialGradient(sx, sy, 0, sx, sy, mainR);
    grad1.addColorStop(0, `rgba(255, 250, 230, ${0.9 * intensity})`);
    grad1.addColorStop(0.1, `rgba(255, 230, 150, ${0.6 * intensity})`);
    grad1.addColorStop(0.4, `rgba(255, 180, 80, ${0.15 * intensity})`);
    grad1.addColorStop(1, 'rgba(255, 180, 80, 0)');
    ctx.fillStyle = grad1;
    ctx.fillRect(0, 0, canvasW, canvasH);
    
    // 2. Hot center
    const hotR = mainR * 0.15;
    const grad0 = ctx.createRadialGradient(sx, sy, 0, sx, sy, hotR);
    grad0.addColorStop(0, `rgba(255, 255, 255, ${0.95 * intensity})`);
    grad0.addColorStop(0.5, `rgba(255, 245, 200, ${0.5 * intensity})`);
    grad0.addColorStop(1, 'rgba(255, 230, 150, 0)');
    ctx.fillStyle = grad0;
    ctx.fillRect(0, 0, canvasW, canvasH);
    
    // 3. Anamorphic horizontal streak
    ctx.save();
    ctx.translate(sx, sy);
    const streakW = canvasW * 1.5 * intensity;
    const streakH = 6;
    const gradS = ctx.createLinearGradient(-streakW/2, 0, streakW/2, 0);
    gradS.addColorStop(0, 'rgba(255, 200, 100, 0)');
    gradS.addColorStop(0.3, `rgba(255, 220, 150, ${0.25 * intensity})`);
    gradS.addColorStop(0.5, `rgba(255, 240, 200, ${0.5 * intensity})`);
    gradS.addColorStop(0.7, `rgba(255, 220, 150, ${0.25 * intensity})`);
    gradS.addColorStop(1, 'rgba(255, 200, 100, 0)');
    ctx.fillStyle = gradS;
    ctx.fillRect(-streakW/2, -streakH/2, streakW, streakH);
    // Wider softer streak
    const gradS2 = ctx.createLinearGradient(-streakW/2, 0, streakW/2, 0);
    gradS2.addColorStop(0, 'rgba(255, 200, 100, 0)');
    gradS2.addColorStop(0.35, `rgba(255, 210, 130, ${0.08 * intensity})`);
    gradS2.addColorStop(0.5, `rgba(255, 230, 180, ${0.15 * intensity})`);
    gradS2.addColorStop(0.65, `rgba(255, 210, 130, ${0.08 * intensity})`);
    gradS2.addColorStop(1, 'rgba(255, 200, 100, 0)');
    ctx.fillStyle = gradS2;
    ctx.fillRect(-streakW/2, -18, streakW, 36);
    ctx.restore();
    
    // 4. Ghost artifacts along flare axis
    const ghosts = [
      { pos: 0.3, size: 0.09, color: [255, 180, 60], alpha: 0.12 },
      { pos: 0.5, size: 0.135, color: [120, 200, 255], alpha: 0.08 },
      { pos: 0.65, size: 0.06, color: [255, 130, 80], alpha: 0.15 },
      { pos: 0.8, size: 0.18, color: [100, 180, 255], alpha: 0.06 },
      { pos: 1.0, size: 0.075, color: [200, 150, 255], alpha: 0.1 },
      { pos: 1.2, size: 0.12, color: [255, 200, 100], alpha: 0.07 },
      { pos: 1.5, size: 0.225, color: [80, 200, 180], alpha: 0.04 },
      { pos: 1.8, size: 0.045, color: [255, 160, 200], alpha: 0.12 },
    ];
    
    ghosts.forEach(g => {
      const gx = sx + dx * g.pos;
      const gy = sy + dy * g.pos;
      const gr = Math.min(canvasW, canvasH) * g.size;
      const [r, gc2, b] = g.color;
      
      // Ring ghost (hollow circle)
      const gradG = ctx.createRadialGradient(gx, gy, gr * 0.6, gx, gy, gr);
      gradG.addColorStop(0, 'rgba(0,0,0,0)');
      gradG.addColorStop(0.5, `rgba(${r},${gc2},${b},${g.alpha * intensity})`);
      gradG.addColorStop(0.8, `rgba(${r},${gc2},${b},${g.alpha * 0.5 * intensity})`);
      gradG.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradG;
      ctx.beginPath();
      ctx.arc(gx, gy, gr, 0, Math.PI * 2);
      ctx.fill();
    });
    
    // 5. Subtle rainbow ring near sun
    const rainR = mainR * 0.6;
    ctx.strokeStyle = `rgba(255, 180, 100, ${0.06 * intensity})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, rainR, 0, Math.PI * 2);
    ctx.stroke();
    
  }, []);
  const mapInstanceRef = React.useRef(null);
  const mapEngineRef = React.useRef('google'); // moteur de la carte en place: 'google' (SAT) ou 'apple' (SAT2)
  const mapCameraRef = React.useRef(null); // centre et zoom gardés au passage SAT <-> SAT2
  const mapTeardownRef = React.useRef(null); // démontage de la carte en place (gardé à travers « Mettre à jour »)
  const projectPosRef = React.useRef(null); // position courante du projet, lue par les écouteurs de la carte
  const mapBuiltForRef = React.useRef(null); // position du projet pour laquelle la carte en place a été construite
  const googleMapRef = React.useRef(null); // carte Google gardée en vie pendant SAT2 et entre deux adresses
  // Interface de la carte en place: Google Maps, ou la couche Plans d'Apple qui en reproduit les fonctions (SAT2).
  const gm = () => (mapEngineRef.current === 'apple' ? AppleSat : window.google && google.maps);
  projectPosRef.current = project?.lat && project?.lng ? { lat: project.lat, lng: project.lng } : null;
  const sunLinesRef = React.useRef([]);
  const sunPosLineRef = React.useRef(null);
  const shadowLineRef = React.useRef(null);
  const sunPosMarkerRef = React.useRef(null);
  const sunDotContainerRef = React.useRef(null);
  const sunDotHaloRef = React.useRef(null);
  const sunDotInnerRef = React.useRef(null);
  const sunTimePillsRef = React.useRef([]);
  const sunBearingRef = React.useRef(null);
  const nightOverlayRef = React.useRef(null);
  const markerRef = React.useRef(null);
  const [adjustedPos, setAdjustedPos] = useState(null);
  const effectiveCenterRef = React.useRef(null);
  
  // === Terrain Elevation Shadow ===
  const [terrainProfile, setTerrainProfile] = useState(null);
  const [terrainShadow, setTerrainShadow] = useState(false);
  const terrainProfileRef = React.useRef(null);
  
  // === Buildings & Shadow Simulation ===
  const [buildings, setBuildings] = useState(() => project?.buildings || []);
  const [drawingMode, setDrawingMode] = useState(false);
  const [drawingVertices, setDrawingVertices] = useState([]);
  const drawingVerticesRef = React.useRef([]);
  const [editingBuilding, setEditingBuilding] = useState(null); // index of building being edited
  const [hoveredBuilding, setHoveredBuilding] = useState(null);
  const [heightPickerIdx, setHeightPickerIdx] = useState(null);
  const [draggingHeight, setDraggingHeight] = useState(null); // { idx, startY, startH, currentH, offsetY }
  const BUILDING_COLORS = ['#ffe26b', '#7dd3c6', '#ff6b8a', '#b07dff', '#6bff8a'];
  // Couleur des murs d'une forme dans la vue 3D (pastille FORME, bouton 3D ouvert); sans choix: brique rouge.
  const WALL_COLORS = [['#7a3f33', 'Brique rouge'], ['#6e4a3a', 'Brique brune'], ['#b8957a', 'Brique beige'], ['#d2c2a4', 'Pierre claire'], ['#9a9a94', 'Béton'], ['#e8e4dc', 'Enduit blanc'], ['#b07d5e', 'Bois'], ['#5c5f63', 'Métal foncé']];
  const [wallPickFor, setWallPickFor] = useState(null); // index de la forme dont on choisit la couleur des murs
  const setWallColor = (idx, hex) => { setBuildings(prev => prev.map((bb, ii) => ii === idx ? { ...bb, wallColor: hex } : bb)); updateProject(project.id, { buildings: buildings.map((bb, ii) => ii === idx ? { ...bb, wallColor: hex } : bb) }); setWallPickFor(null); };

  // Height pill drag handlers
  useEffect(() => {
    if (!draggingHeight) return;
    const onMove = (clientY) => {
      const delta = draggingHeight.startY - clientY;
      const newH = Math.max(1, Math.min(200, Math.round(draggingHeight.startH + delta * 0.5)));
      setDraggingHeight(prev => prev ? { ...prev, currentH: newH, offsetY: clientY - prev.startY } : null);
      // Live update buildings for shadow
      setBuildings(prev => prev.map((bb, ii) => ii === draggingHeight.idx ? {...bb, height: newH} : bb));
    };
    const onEnd = () => {
      if (draggingHeight) {
        const idx = draggingHeight.idx;
        const h = draggingHeight.currentH;
        buildingsSaveTimer.current && clearTimeout(buildingsSaveTimer.current);
        buildingsSaveTimer.current = setTimeout(() => {
          updateProject(project.id, { buildings: buildings.map((bb, ii) => ii === idx ? {...bb, height: h} : bb) });
        }, 500);
      }
      setDraggingHeight(null);
    };
    const onMouseMove = (e) => onMove(e.clientY);
    const onTouchMove = (e) => onMove(e.touches[0].clientY);
    const onMouseUp = () => onEnd();
    const onTouchEnd = () => onEnd();
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [draggingHeight, buildings, project?.id]);
  const [buildingHeight, setBuildingHeight] = useState('');
  const [buildingName, setBuildingName] = useState('');
  const buildingPolygonsRef = React.useRef([]);
  const shadowPolygonsRef = React.useRef([]);
  const shadowOverlayRef = React.useRef(null);
  const wallPolygonsRef = React.useRef([]);
  const roofPolygonsRef = React.useRef([]);
  const drawingPolygonRef = React.useRef(null);
  const drawingMarkersRef = React.useRef([]);
  const drawClickListenerRef = React.useRef(null);
  const [editPanelPos, setEditPanelPos] = useState(null);
  const [drawPanelPos, setDrawPanelPos] = useState(null);
  const skipMapRecreateRef = React.useRef(false);
  // Reset adjustedPos when switching projects
  useEffect(() => { setAdjustedPos(null); effectiveCenterRef.current = null; }, [project?.id]);
  
  // Load buildings from project
  useEffect(() => { setBuildings(project?.buildings || []); setDrawingMode(false); setDrawingVertices([]); setEditingBuilding(null); }, [project?.id]);
  
  // Save buildings to project when changed (debounced)
  const buildingsSaveTimer = React.useRef(null);
  useEffect(() => {
    if (!project?.id) return;
    if (buildingsSaveTimer.current) clearTimeout(buildingsSaveTimer.current);
    buildingsSaveTimer.current = setTimeout(() => {
      updateProject(project.id, { buildings });
    }, 500);
    return () => { if (buildingsSaveTimer.current) clearTimeout(buildingsSaveTimer.current); };
  }, [buildings]);

  // Drawing mode: add click listener on map
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    // Clean up previous listener
    if (drawClickListenerRef.current) {
      gm().event.removeListener(drawClickListenerRef.current);
      drawClickListenerRef.current = null;
    }
    if (!drawingMode) {
      // Clean drawing preview
      if (drawingPolygonRef.current) { drawingPolygonRef.current.setMap(null); drawingPolygonRef.current = null; }
      drawingMarkersRef.current.forEach(m => m.setMap(null));
      drawingMarkersRef.current = [];
      return;
    }
    map.setOptions({ draggableCursor: 'crosshair' });
    drawClickListenerRef.current = map.addListener('click', (e) => {
      const pt = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      const next = [...drawingVerticesRef.current, pt];
      drawingVerticesRef.current = next;
      setDrawingVertices(next);
    });
    // Double-click to finish
    const dblClickListener = map.addListener('dblclick', (e) => {
      e.stop();
      if (drawingVerticesRef.current.length >= 3) {
        finishDrawingFromRef();
      }
    });
    // Enter key to finish
    const enterHandler = (e) => {
      if (e.key === 'Enter' && drawingVerticesRef.current.length >= 3) {
        finishDrawingFromRef();
      }
    };
    document.addEventListener('keydown', enterHandler);
    return () => {
      if (drawClickListenerRef.current) {
        gm().event.removeListener(drawClickListenerRef.current);
        drawClickListenerRef.current = null;
      }
      gm().event.removeListener(dblClickListener);
      document.removeEventListener('keydown', enterHandler);
      map.setOptions({ draggableCursor: null });
    };
  }, [drawingMode, mapEpoch]);

  // Update drawing preview polygon + vertex markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    // Update preview polygon
    if (drawingPolygonRef.current) drawingPolygonRef.current.setMap(null);
    drawingMarkersRef.current.forEach(m => m.setMap(null));
    drawingMarkersRef.current = [];
    if (drawingVertices.length >= 2) {
      const nextColor = BUILDING_COLORS[buildings.length % BUILDING_COLORS.length];
      // Glow polygon (behind)
      const glow = new (gm().Polygon)({
        paths: drawingVertices,
        strokeColor: nextColor, strokeOpacity: 0.3, strokeWeight: 8,
        fillColor: nextColor, fillOpacity: 0.08, map, zIndex: 29,
        clickable: false
      });
      drawingMarkersRef.current.push(glow); // reuse array for cleanup
      // Main polygon, with clickable: false so clicks pass through to the map
      // (otherwise concave shapes like an L are impossible: clicks inside the
      // current preview are absorbed by the polygon and never reach the map)
      drawingPolygonRef.current = new (gm().Polygon)({
        paths: drawingVertices,
        strokeColor: nextColor, strokeOpacity: 0.9, strokeWeight: 2,
        fillColor: nextColor, fillOpacity: 0.2, map,
        zIndex: 30,
        clickable: false
      });
    }
    drawingVertices.forEach((v, i) => {
      const isFirst = i === 0;
      const nextColor = BUILDING_COLORS[buildings.length % BUILDING_COLORS.length];
      const canClose = isFirst && drawingVertices.length >= 3;
      // White circle border behind checkmark when closeable
      if (canClose) {
        const circleBg = new (gm().Marker)({
          position: v, map,
          icon: { path: gm().SymbolPath.CIRCLE, scale: 12, fillColor: nextColor, fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 3, strokeOpacity: 1 },
          zIndex: 36, clickable: false
        });
        drawingMarkersRef.current.push(circleBg);
      }
      const marker = new (gm().Marker)({
        position: v, map,
        icon: canClose ? {
          path: 'M-2.5,0 L-1,2 L2.5,-2',
          scale: 2,
          fillColor: 'transparent', fillOpacity: 0,
          strokeColor: '#ffffff', strokeWeight: 3, strokeOpacity: 1,
          anchor: new (gm().Point)(0, 0),
        } : {
          path: gm().SymbolPath.CIRCLE,
          scale: isFirst ? 10 : 5,
          fillColor: nextColor,
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: isFirst ? 2.5 : 1.5,
        },
        zIndex: 37,
        clickable: canClose
      });
      // Add pulsing circle behind first vertex when closeable
      if (canClose) {
        const pulseCircle = new (gm().Marker)({
          position: v, map,
          icon: { path: gm().SymbolPath.CIRCLE, scale: 20, fillColor: nextColor, fillOpacity: 0.3, strokeColor: nextColor, strokeWeight: 2, strokeOpacity: 0.5 },
          zIndex: 34, clickable: false
        });
        drawingMarkersRef.current.push(pulseCircle);
      }
      if (canClose) {
        marker.addListener('click', () => {
          finishDrawingFromRef();
        });
      }
      drawingMarkersRef.current.push(marker);
    });
    // Calculate panel position near last vertex
    if (drawingVertices.length >= 1 && nightOverlayRef.current && nightOverlayRef.current.getProjection()) {
      const last = drawingVertices[drawingVertices.length - 1];
      const proj = nightOverlayRef.current.getProjection();
      const px = proj.fromLatLngToContainerPixel(new (gm().LatLng)(last.lat, last.lng));
      if (px) setDrawPanelPos({ x: px.x, y: px.y });
    } else {
      setDrawPanelPos(null);
    }
  }, [drawingVertices, buildings.length, mapEpoch, overlayTick]);

  const finishDrawingFromRef = () => {
    const verts = drawingVerticesRef.current;
    if (verts.length < 3) return;
    if (buildings.length >= 5) { setDrawingMode(false); setDrawingVertices([]); drawingVerticesRef.current = []; return; }
    const newBuilding = { polygon: [...verts], height: 30, name: '', wallColor: '#e8e4dc' }; // enduit blanc par défaut (demande du 6 octobre 2026)
    setBuildings(prev => {
      newBuilding.name = `Bâtiment ${prev.length + 1}`;
      setEditingBuilding(prev.length);
      return [...prev, newBuilding];
    });
    setBuildingHeight('30');
    setBuildingName(newBuilding.name);
    drawingVerticesRef.current = [];
    setDrawingVertices([]);
    setDrawingMode(false);
    if (drawingPolygonRef.current) { drawingPolygonRef.current.setMap(null); drawingPolygonRef.current = null; }
    drawingMarkersRef.current.forEach(m => m.setMap(null));
    drawingMarkersRef.current = [];
  };

  const finishDrawing = () => {
    if (drawingVertices.length < 3) return;
    if (buildings.length >= 5) { setDrawingMode(false); setDrawingVertices([]); return; }
    const newBuilding = { polygon: [...drawingVertices], height: 30, name: `Bâtiment ${buildings.length + 1}`, wallColor: '#e8e4dc' }; // enduit blanc par défaut
    setBuildings(prev => [...prev, newBuilding]);
    setEditingBuilding(buildings.length);
    setBuildingHeight('30');
    setBuildingName(newBuilding.name);
    setDrawingVertices([]);
    setDrawingMode(false);
    if (drawingPolygonRef.current) { drawingPolygonRef.current.setMap(null); drawingPolygonRef.current = null; }
    drawingMarkersRef.current.forEach(m => m.setMap(null));
    drawingMarkersRef.current = [];
  };

  const deleteBuilding = (idx) => {
    setBuildings(prev => prev.filter((_, i) => i !== idx));
    if (editingBuilding === idx) setEditingBuilding(null);
    else if (editingBuilding > idx) setEditingBuilding(editingBuilding - 1);
  };

  // Draw building polygons + shadow + 3D extrusion on map
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !SunCalc) return;
    const eLat = adjustedPos?.lat ?? project?.lat;
    const eLng = adjustedPos?.lng ?? project?.lng;
    if (!eLat || !eLng) return;

    // Clear previous
    buildingPolygonsRef.current.forEach(p => p.setMap(null));
    buildingPolygonsRef.current = [];
    shadowPolygonsRef.current.forEach(p => p.setMap(null));
    shadowPolygonsRef.current = [];
    wallPolygonsRef.current.forEach(p => p.setMap(null));
    wallPolygonsRef.current = [];
    roofPolygonsRef.current.forEach(p => p.setMap(null));
    roofPolygonsRef.current = [];

    // Sun position for shadow calc
    const simDate = new Date(sunDate);
    simDate.setHours(Math.floor(sunHour), Math.round((sunHour % 1) * 60), 0);
    const sunPos = SunCalc.getPosition(simDate, eLat, eLng);
    const sunAlt = sunPos.altitude;
    const sunAz = sunPos.azimuth;

    // === First pass: collect shadow shapes for canvas overlay ===
    // We render shadows on a canvas using composite-out so the building
    // footprints carve holes out of the shadow layer (inverted mask).
    const shadowsData = [];
    const buildingsData = buildings.filter(b => b.polygon.length >= 3).map(b => b.polygon);

    if (sunAlt > -0.05) {
      const altDeg = sunAlt * 180 / Math.PI;
      const shadowOpacity = altDeg >= 5 ? 1 : altDeg <= -3 ? 0 : (altDeg + 3) / 8;
      if (shadowOpacity > 0) {
        buildings.forEach((bldg) => {
          const n = bldg.polygon.length;
          if (n < 3) return;
          const shadowLen = Math.min(bldg.height / Math.tan(Math.max(sunAlt, 0.01)), 2000);
          const sunBearingFromNorth = (sunAz * 180 / Math.PI + 180) % 360;
          const shadowBearing = (sunBearingFromNorth + 180) % 360;
          const shadowBearingRad = shadowBearing * Math.PI / 180;
          const dLat = (shadowLen * Math.cos(shadowBearingRad)) / 111320;
          const dLng = (shadowLen * Math.sin(shadowBearingRad)) / (111320 * Math.cos(eLat * Math.PI / 180));
          const projVerts = bldg.polygon.map(v => ({ lat: v.lat + dLat, lng: v.lng + dLng }));
          shadowsData.push({ path: projVerts, opacity: 0.3 * shadowOpacity });
          for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            shadowsData.push({
              path: [bldg.polygon[i], bldg.polygon[j], projVerts[j], projVerts[i]],
              opacity: 0.25 * shadowOpacity
            });
          }
        });
      }
    }

    // Create canvas overlay (lazy, first render only)
    if (!shadowOverlayRef.current && gm() && gm().OverlayView) {
      class ShadowCanvas extends gm().OverlayView {
        constructor() { super(); this.canvas = null; this.shadows = []; this.buildings = []; }
        onAdd() {
          this.canvas = document.createElement('canvas');
          this.canvas.style.cssText = 'position:absolute;pointer-events:none;';
          this.getPanes().overlayLayer.appendChild(this.canvas);
        }
        draw() {
          const projection = this.getProjection();
          if (!projection || !this.canvas) return;
          const m = this.getMap();
          const bounds = m && m.getBounds();
          if (!bounds) return;
          const ne = bounds.getNorthEast();
          const sw = bounds.getSouthWest();
          const nePx = projection.fromLatLngToDivPixel(ne);
          const swPx = projection.fromLatLngToDivPixel(sw);
          const left = Math.min(nePx.x, swPx.x);
          const right = Math.max(nePx.x, swPx.x);
          const top = Math.min(nePx.y, swPx.y);
          const bottom = Math.max(nePx.y, swPx.y);
          const buffer = 600;
          const cLeft = Math.floor(left - buffer);
          const cTop = Math.floor(top - buffer);
          const cW = Math.ceil(right - left) + 2 * buffer;
          const cH = Math.ceil(bottom - top) + 2 * buffer;
          if (this.canvas.width !== cW || this.canvas.height !== cH) {
            this.canvas.width = cW;
            this.canvas.height = cH;
          }
          this.canvas.style.left = cLeft + 'px';
          this.canvas.style.top = cTop + 'px';
          const ctx = this.canvas.getContext('2d');
          ctx.clearRect(0, 0, cW, cH);
          const toPx = (ll) => {
            const dp = projection.fromLatLngToDivPixel(new (gm().LatLng)(ll.lat, ll.lng));
            return { x: dp.x - cLeft, y: dp.y - cTop };
          };
          const tracePath = (path) => {
            ctx.beginPath();
            path.forEach((p, i) => {
              const x = toPx(p);
              if (i === 0) ctx.moveTo(x.x, x.y);
              else ctx.lineTo(x.x, x.y);
            });
            ctx.closePath();
          };
          // Paint shadows
          ctx.globalCompositeOperation = 'source-over';
          for (const s of this.shadows) {
            ctx.fillStyle = 'rgba(0,0,0,' + s.opacity + ')';
            tracePath(s.path);
            ctx.fill();
          }
          // Carve building footprints out of shadows (inverted mask)
          ctx.globalCompositeOperation = 'destination-out';
          ctx.fillStyle = 'rgba(0,0,0,1)';
          for (const b of this.buildings) {
            tracePath(b);
            ctx.fill();
          }
        }
        setData(shadows, buildings) {
          this.shadows = shadows;
          this.buildings = buildings;
          if (this.getProjection()) this.draw();
        }
        onRemove() {
          if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
          this.canvas = null;
        }
      }
      shadowOverlayRef.current = new ShadowCanvas();
      shadowOverlayRef.current.setMap(map);
    }
    if (shadowOverlayRef.current) {
      shadowOverlayRef.current.setData(shadowsData, buildingsData);
    }

    // === Second pass: building polygons (no shadow logic, handled by overlay) ===
    buildings.forEach((bldg, idx) => {
      const isSelected = editingBuilding === idx;
      const n = bldg.polygon.length;
      if (n < 3) return;

      // Draw building footprint: per-shape color
      const shapeColor = BUILDING_COLORS[idx % BUILDING_COLORS.length];
      // Glow behind
      const glowPoly = new (gm().Polygon)({
        paths: bldg.polygon,
        strokeColor: shapeColor, strokeOpacity: 0.4, strokeWeight: isSelected ? 10 : 6,
        fillColor: 'transparent', fillOpacity: 0, map, zIndex: 24,
      });
      buildingPolygonsRef.current.push(glowPoly);
      
      const poly = new (gm().Polygon)({
        paths: bldg.polygon,
        strokeColor: shapeColor,
        strokeOpacity: isSelected ? 1 : 0.85, strokeWeight: isSelected ? 2.5 : 1.5,
        fillColor: shapeColor,
        fillOpacity: 0.12, map, zIndex: 25,
        clickable: true
      });
      poly.addListener('click', () => {
        setEditingBuilding(idx);
        setBuildingHeight(String(bldg.height));
        setBuildingName(bldg.name);
      });
      buildingPolygonsRef.current.push(poly);
      
      // Draggable vertex markers for selected building
      if (isSelected) {
        bldg.polygon.forEach((v, vi) => {
          const vertexMarker = new (gm().Marker)({
            position: v, map, draggable: true,
            icon: {
              path: gm().SymbolPath.CIRCLE,
              scale: 6, fillColor: shapeColor, fillOpacity: 1,
              strokeColor: '#fff', strokeWeight: 2,
            },
            zIndex: 40
          });
          vertexMarker.addListener('dragend', (e) => {
            const newPos = { lat: e.latLng.lat(), lng: e.latLng.lng() };
            setBuildings(prev => prev.map((b, bi) => {
              if (bi !== idx) return b;
              const newPoly = [...b.polygon];
              newPoly[vi] = newPos;
              return { ...b, polygon: newPoly };
            }));
          });
          buildingPolygonsRef.current.push(vertexMarker);
        });
      }
    });

    // Calculate edit panel position near the selected building
    if (editingBuilding !== null && buildings[editingBuilding]) {
      const bldg = buildings[editingBuilding];
      const centroid = bldg.polygon.reduce((acc, v) => ({ lat: acc.lat + v.lat / bldg.polygon.length, lng: acc.lng + v.lng / bldg.polygon.length }), { lat: 0, lng: 0 });
      const overlay = nightOverlayRef.current;
      if (overlay && overlay.getProjection()) {
        const proj = overlay.getProjection();
        const px = proj.fromLatLngToContainerPixel(new (gm().LatLng)(centroid.lat, centroid.lng));
        if (px) setEditPanelPos({ x: px.x, y: px.y });
      }
    } else {
      setEditPanelPos(null);
    }

    return () => {
      buildingPolygonsRef.current.forEach(p => p.setMap(null));
      shadowPolygonsRef.current.forEach(p => p.setMap(null));
      wallPolygonsRef.current.forEach(p => p.setMap(null));
      roofPolygonsRef.current.forEach(p => p.setMap(null));
    };
  }, [buildings, sunHour, sunDate, adjustedPos, editingBuilding, project?.lat, project?.lng, mapEpoch, overlayTick]);

  // === Project files ===
  const [projectFiles, setProjectFiles] = useState([]);
  const [fileUrls, setFileUrls] = useState({});
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const fileInputRef = React.useRef(null);

  const totalFilesMB = React.useMemo(() => projectFiles.reduce((s, f) => s + f.size_bytes, 0) / (1024 * 1024), [projectFiles]);

  // Load files on mount / project change
  useEffect(() => {
    if (!project?.id) return;
    fileHelpers.list(project.id).then(files => {
      setProjectFiles(files);
      // Get signed URLs for all files
      Promise.all(files.map(async f => {
        const url = await fileHelpers.getUrl(f.storage_path);
        return [f.id, url];
      })).then(pairs => setFileUrls(Object.fromEntries(pairs)));
    });
  }, [project?.id]);

  const handleFileUpload = async (fileList) => {
    if (!user || !project) { console.error('No user or project'); return; }
    const files = Array.from(fileList);
    const allowedExt = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.pdf'];
    const valid = files.filter(f => {
      const ext = '.' + f.name.split('.').pop().toLowerCase();
      return allowedExt.includes(ext);
    });
    if (valid.length === 0) { console.error('No valid files'); return; }
    const newTotalMB = totalFilesMB + valid.reduce((s, f) => s + f.size, 0) / (1024 * 1024);
    if (newTotalMB > MAX_PROJECT_FILES_MB) { alert(`Limite de ${MAX_PROJECT_FILES_MB} MB par projet dépassée`); return; }
    setUploading(true);
    setUploadProgress(0);
    try {
      for (let i = 0; i < valid.length; i++) {
        const f = valid[i];
        await fileHelpers.upload(project.id, user.id, f);
        setUploadProgress(Math.round(((i + 1) / valid.length) * 100));
      }
      const updated = await fileHelpers.list(project.id);
      setProjectFiles(updated);
      const pairs = await Promise.all(updated.map(async f => {
        const url = fileUrls[f.id] || await fileHelpers.getUrl(f.storage_path);
        return [f.id, url];
      }));
      setFileUrls(Object.fromEntries(pairs));
    } catch (e) { console.error('Upload failed:', e); alert('Erreur: ' + e.message); }
    setUploading(false);
  };

  const handleFileDelete = async (fileRow) => {
    await fileHelpers.deleteFile(fileRow);
    setProjectFiles(p => p.filter(f => f.id !== fileRow.id));
    setFileUrls(u => { const n = {...u}; delete n[fileRow.id]; return n; });
  };

  useEffect(() => {
    if (!project?.lat || !project?.lng) return;
    let cancelled = false;
    (async () => {
      const result = await fetchWeather(project.lat, project.lng);
      if (cancelled) return;
      // En vue detail on garde le comportement simple: on n'affiche que les donnees disponibles
      // (fraiches ou en cache). La banniere globale reste l'affaire de la liste des projets.
      setWeather(result.data || null);
    })();
    return () => { cancelled = true; };
  }, [project?.lat, project?.lng]);

  // Auto-calculate travel time if missing or when departure changes
  const lastTravelDepsRef = React.useRef(null);
  useEffect(() => {
    const calcTravelIfNeeded = async () => {
      if (!project) return;
      if (project.lat && project.lng) {
        const depLat = project.departureLat || prefs.homeLat;
        const depLng = project.departureLng || prefs.homeLng;
        if (depLat && depLng) {
          // Skip if same deps as last calc
          const depsKey = `${depLat},${depLng},${project.lat},${project.lng}`;
          if (project.travelTime && lastTravelDepsRef.current === depsKey) return;
          lastTravelDepsRef.current = depsKey;
          try {
            const travelTime = await getTravelTime(depLat, depLng, project.lat, project.lng);
            if (travelTime) updateProject(project.id, { travelTime });
          } catch(e) { console.error('Travel time calc failed:', e); }
        }
      }
    };
    calcTravelIfNeeded();
  }, [project?.id, project?.lat, project?.lng, project?.departureLat, project?.departureLng, prefs.homeLat, prefs.homeLng]);

  const recalcTravel = async (depLat, depLng, destLat, destLng) => {
    if (!depLat || !depLng || !destLat || !destLng) return null;
    try { return await getTravelTime(depLat, depLng, destLat, destLng); } catch(e) { return null; }
  };

  // Copie l'adresse du projet dans le presse-papiers (bouton à côté de la flèche Google Maps).
  // Le repli par textarea + execCommand couvre les contextes où navigator.clipboard est absent ou refusé
  // (site installé en app, page servie sans HTTPS, permission refusée).
  const copyProjectAddress = async () => {
    const text = project?.address;
    if (!text) return;
    let ok = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch(e) {}
    if (!ok) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.opacity = '0';
      ta.style.fontSize = '16px'; // évite le zoom automatique d'iOS sur le focus
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      try { ok = document.execCommand('copy'); } catch(e) {}
      ta.remove();
    }
    if (!ok) return;
    setAddressCopied(true);
    clearTimeout(addressCopiedTimer.current);
    addressCopiedTimer.current = setTimeout(() => setAddressCopied(false), 1600);
  };
  useEffect(() => () => clearTimeout(addressCopiedTimer.current), []);
  // Changer de projet pendant la confirmation: on repart de l'icône copier.
  useEffect(() => { setAddressCopied(false); }, [projectId]);

  // Valeurs à jour pour les écouteurs des suggestions (posés une seule fois: sans ces refs, ils garderaient le projet
  // et les préférences du premier affichage).
  const projectRef = React.useRef(project); projectRef.current = project;
  const prefsRef = React.useRef(prefs); prefsRef.current = prefs;
  const typedDetachRef = React.useRef([]);
  useEffect(() => () => typedDetachRef.current.forEach(f => f()), []);

  // Adresse du projet tapée sans choisir de suggestion (Entrée ou sortie du champ): géocodée et enregistrée; introuvable,
  // le champ revient à l'adresse enregistrée au lieu d'afficher un texte qui ne l'est pas.
  // Dernier texte envoyé au géocodage (Entrée puis sortie du champ) et son résultat: le même texte n'est ignoré que pendant
  // l'appel ou tant que son résultat est encore l'adresse enregistrée (retaper une ancienne adresse ou réessayer après
  // un échec fonctionne).
  const lastTypedRef = React.useRef({ address: null, departure: null });
  const commitTypedAddress = async (text) => {
    const p = projectRef.current, pf = prefsRef.current, el = addressInputRef.current;
    if (!p || !text || text === (p.address || '')) return;
    const last = lastTypedRef.current.address;
    if (last && last.text === text && (last.result === undefined || last.result === (p.address || ''))) { if (el && document.activeElement !== el) el.value = p.address || ''; return; }
    lastTypedRef.current.address = { text, result: undefined };
    try {
      const r = await geocodeAddress(text);
      const travelTime = await recalcTravel(p.departureLat || pf.homeLat, p.departureLng || pf.homeLng, r.lat, r.lng);
      lastTypedRef.current.address = { text, result: r.formattedAddress };
      updateProject(p.id, { address: r.formattedAddress, lat: r.lat, lng: r.lng, travelTime });
      if (el && document.activeElement !== el) el.value = r.formattedAddress;
    } catch (e) {
      lastTypedRef.current.address = null;
      if (el && document.activeElement !== el) el.value = projectRef.current?.address || '';
    }
  };
  // Départ tapé sans suggestion: même principe. Vide ou égal au domicile: c'est l'onBlur du champ qui revient au domicile.
  const commitTypedDeparture = async (text) => {
    const p = projectRef.current, pf = prefsRef.current, el = departureInputRef.current;
    if (!p || !text || text === (pf.homeAddress || '') || text === (p.departureAddress || '')) return;
    const last = lastTypedRef.current.departure;
    if (last && last.text === text && (last.result === undefined || last.result === (p.departureAddress || ''))) { if (el && document.activeElement !== el) el.value = p.departureAddress || pf.homeAddress || ''; return; }
    lastTypedRef.current.departure = { text, result: undefined };
    try {
      const r = await geocodeAddress(text);
      const travelTime = await recalcTravel(r.lat, r.lng, p.lat, p.lng);
      lastTypedRef.current.departure = { text, result: r.formattedAddress };
      updateProject(p.id, { departureAddress: r.formattedAddress, departureLat: r.lat, departureLng: r.lng, travelTime });
      if (el && document.activeElement !== el) el.value = r.formattedAddress;
    } catch (e) {
      lastTypedRef.current.departure = null;
      const q = projectRef.current;
      if (el && document.activeElement !== el) el.value = (q && q.departureAddress) || prefsRef.current.homeAddress || '';
    }
  };

  // Google Places Autocomplete for project address
  useEffect(() => {
    if (addressInputRef.current && !autocompleteRef.current && window.google) {
      autocompleteRef.current = new google.maps.places.Autocomplete(addressInputRef.current, {
        types: ['establishment', 'geocode'],
        componentRestrictions: { country: 'ca' },
        fields: ['formatted_address', 'geometry']
      });
      autocompleteRef.current.addListener('place_changed', async () => {
        const place = autocompleteRef.current.getPlace();
        const p = projectRef.current, pf = prefsRef.current;
        if (place.geometry && p) {
          const lat = place.geometry.location.lat();
          const lng = place.geometry.location.lng();
          const travelTime = await recalcTravel(p.departureLat || pf.homeLat, p.departureLng || pf.homeLng, lat, lng);
          updateProject(p.id, { address: place.formatted_address, lat, lng, travelTime });
        }
      });
      typedDetachRef.current.push(typedAddressFallback(addressInputRef.current, autocompleteRef.current, commitTypedAddress));
    }
  }, [projectId]);

  // Google Places Autocomplete for departure address
  useEffect(() => {
    if (departureInputRef.current && !departureAutocompleteRef.current && window.google) {
      departureAutocompleteRef.current = new google.maps.places.Autocomplete(departureInputRef.current, {
        types: ['establishment', 'geocode'],
        componentRestrictions: { country: 'ca' },
        fields: ['formatted_address', 'geometry']
      });
      departureAutocompleteRef.current.addListener('place_changed', async () => {
        const place = departureAutocompleteRef.current.getPlace();
        const p = projectRef.current;
        if (place.geometry && p) {
          const depLat = place.geometry.location.lat();
          const depLng = place.geometry.location.lng();
          const travelTime = await recalcTravel(depLat, depLng, p.lat, p.lng);
          updateProject(p.id, { 
            departureAddress: place.formatted_address, 
            departureLat: depLat, 
            departureLng: depLng,
            travelTime 
          });
        }
      });
      typedDetachRef.current.push(typedAddressFallback(departureInputRef.current, departureAutocompleteRef.current, commitTypedDeparture));
    }
  }, [projectId]);

  // Le champ n'est plus recréé à chaque changement d'adresse (il perdait ses suggestions): on y reporte l'adresse
  // enregistrée (choix d'une suggestion, « Mettre à jour » sur la carte), sauf pendant la saisie.
  useEffect(() => {
    const el = addressInputRef.current;
    if (el && document.activeElement !== el) el.value = project?.address || '';
  }, [project?.address]);
  useEffect(() => {
    const el = departureInputRef.current;
    if (el && document.activeElement !== el) el.value = project?.departureAddress || prefs.homeAddress || '';
  }, [project?.departureAddress, prefs.homeAddress]);

  // Carte de la fiche: satellite Google (SAT) ou satellite Plans d'Apple (SAT2). SAT2 passe par la couche appleSat,
  // qui reproduit l'interface de Google: tous les dessins ci-dessous servent aux deux.
  useEffect(() => {
    const apple = mapEngine === 'apple';
    if (!mapContainerRef.current || !project?.lat || !project?.lng || (!apple && !window.google)) return;
    // Position ajustée confirmée (« Mettre à jour »): la carte reste telle quelle. Son démontage reste branché pour
    // le prochain vrai changement (SAT <-> SAT2, autre position, fermeture de la fiche).
    if (skipMapRecreateRef.current) {
      skipMapRecreateRef.current = false;
      mapBuiltForRef.current = { lat: project.lat, lng: project.lng };
      return () => {
        if (skipMapRecreateRef.current) return;
        const teardown = mapTeardownRef.current;
        mapTeardownRef.current = null;
        if (teardown) teardown();
      };
    }
    // Chaque moteur a son propre calque dans le conteneur. La carte Google reste en vie (masquée) pendant SAT2:
    // revenir sur SAT ne recharge pas une carte Google (chaque chargement est compté par Google).
    const hostFor = (kind) => {
      let h = mapContainerRef.current.querySelector(`:scope > [data-map-host="${kind}"]`);
      if (!h) {
        h = document.createElement('div');
        h.dataset.mapHost = kind;
        h.style.cssText = 'position:absolute;inset:0;';
        mapContainerRef.current.appendChild(h);
      }
      return h;
    };
    const host = hostFor(mapEngine);
    const otherHost = mapContainerRef.current.querySelector(`:scope > [data-map-host="${apple ? 'google' : 'apple'}"]`);
    host.style.display = '';
    if (otherHost) otherHost.style.display = 'none';
    // Passage SAT <-> SAT2 sur le même projet: on reprend le cadrage de la carte précédente.
    const engineChanged = mapEngineRef.current !== mapEngine;
    mapEngineRef.current = mapEngine;
    const saved = mapCameraRef.current;
    mapCameraRef.current = null;
    const cam = engineChanged && saved && saved.lat === project.lat && saved.lng === project.lng ? saved : null;
    mapBuiltForRef.current = { lat: project.lat, lng: project.lng };

    const mapOptions = {
      center: cam ? cam.center : { lat: project.lat, lng: project.lng },
      zoom: cam ? cam.zoom : (project.mapZoom || (isMobile ? 16 : 18)),
      gestureHandling: isMobile || stackMap ? 'cooperative' : 'greedy',
    };
    let map;
    const cachedGoogle = googleMapRef.current;
    if (apple) {
      map = new AppleSat.Map(host, mapOptions);
    } else if (cachedGoogle) {
      map = cachedGoogle;
      map.setOptions({ gestureHandling: mapOptions.gestureHandling });
      map.setCenter(mapOptions.center);
      map.setZoom(mapOptions.zoom);
    } else {
      map = new google.maps.Map(host, {
        ...mapOptions,
        mapTypeId: 'hybrid',
        styles: [
          { stylers: [{ saturation: 0 }] },
          { featureType: 'poi', elementType: 'labels.icon', stylers: [{ saturation: -100 }, { lightness: -20 }] },
          { featureType: 'transit', elementType: 'labels.icon', stylers: [{ saturation: -100 }, { lightness: -20 }] },
        ],
        disableDefaultUI: true,
        disableDoubleClickZoom: true,
        zoomControl: false,
        scrollwheel: false,
        mapTypeControl: false,
        clickableIcons: false,
        backgroundColor: '#181b1e',
        ...(isMobile ? { padding: { top: 0, right: 0, bottom: 100, left: 0 } } : {}),
      });
      googleMapRef.current = map;
    }
    mapInstanceRef.current = map;
    const handles = []; // écouteurs posés ici, retirés au démontage (la carte Google, elle, peut resservir)
    
    // Reveal animation: start after tiles load
    if (!mapRevealedRef.current) {
      handles.push(gm().event.addListenerOnce(map, 'tilesloaded', () => {
        if (mapRevealedRef.current) return;
        mapRevealedRef.current = true;
        setMapRevealed(true);
        // Set slider to start of range (far left)
        const st2 = (project?.lat && project?.lng && SunCalc) ? SunCalc.getTimes(new Date(), project.lat, project.lng) : null;
        const sr2 = st2?.sunrise ? st2.sunrise.getHours() + st2.sunrise.getMinutes()/60 : 6;
        const ss2 = st2?.sunset ? st2.sunset.getHours() + st2.sunset.getMinutes()/60 : 18;
        const range2 = (ss2 - sr2) / (4/6);
        const min2 = sr2 - (1/6) * range2;
        setSunHour(min2);
        setSunHourDisplay(min2);
        sunHourTargetRef.current = min2;
        
        // Animate slider to center of range
        setTimeout(() => {
          const targetH = min2 + range2 / 2;
          const sliderDur = 1000;
          const sT0 = performance.now();
          const startH = min2;
          const animSlider = (now2) => {
            const p = Math.min(1, (now2 - sT0) / sliderDur);
            // Match clip easing: cubic-bezier(0.22, 0.61, 0.36, 1)
            const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
            setSunHour(startH + (targetH - startH) * ease);
            if (p < 1) requestAnimationFrame(animSlider);
          };
          requestAnimationFrame(animSlider);
        }, 200);
      }));
    }
    // Desaturation: CSS filter on container, counter-filter on all overlay panes
    // (SAT2: la couche appleSat compense elle-même sur ses calques)
    const counterOverlay = new (gm().OverlayView)();
    counterOverlay.onAdd = function() {
      const applyCounter = () => {
        const panes = this.getPanes();
        if (!panes) return;
        Object.values(panes).forEach(pane => {
          if (pane && pane.style) pane.style.filter = 'saturate(2.0)';
        });
      };
      applyCounter();
      // Reapply periodically in case panes get recreated
      this._interval = setInterval(applyCounter, 2000);
    };
    counterOverlay.draw = function() {};
    counterOverlay.onRemove = function() { if (this._interval) clearInterval(this._interval); };
    if (!apple) counterOverlay.setMap(map);
    // Zoom uniquement via les boutons + et - de l'interface : plus aucun zoom à la molette
    // ni au trackpad (geste trop souvent déclenché par erreur). En ne captant plus l'évènement
    // wheel, le survol de la carte fait défiler la page comme partout ailleurs dans le détail.
    // Le zoom natif de la carte reste neutralisé par scrollwheel: false; le drag pour déplacer
    // la carte demeure actif.
    // No panBy: center pin is at visual center
    handles.push(map.addListener('idle', () => setMapZoom(map.getZoom()))); // pas de comparaison avec mapZoom: sa valeur ici date de la création de la carte

    // Keep center anchored during scroll-zoom (not drag)
    let isDragging = false;
    handles.push(map.addListener('dragstart', () => { isDragging = true; }));
    handles.push(map.addListener('dragend', () => { isDragging = false; }));
    handles.push(map.addListener('zoom_changed', () => {
      if (!isDragging) {
        const anchor = effectiveCenterRef.current || projectPosRef.current;
        if (anchor) map.setCenter(anchor);
      }
      // Immediately reposition sun dot to avoid drift during zoom animation
      if (sunPosMarkerRef.current && sunBearingRef.current) {
        const sb = sunBearingRef.current;
        const b = map.getBounds();
        if (b) {
          const R = Math.min(Math.abs(b.getNorthEast().lat() - b.getSouthWest().lat()), Math.abs(b.getNorthEast().lng() - b.getSouthWest().lng())) * 0.38;
          const newLat = sb.eLat + R * Math.cos(sb.bearing * Math.PI / 180);
          const newLng = sb.eLng + R * Math.sin(sb.bearing * Math.PI / 180) / Math.cos(sb.eLat * Math.PI / 180);
          sunPosMarkerRef.current.lat = newLat;
          sunPosMarkerRef.current.lng = newLng;
          sunPosMarkerRef.current.draw();
        }
      }
    }));

    // Night overlay: inserted into mapPane so it's BELOW polylines
    class NightOverlay extends gm().OverlayView {
      constructor() { super(); this.div = null; }
      onAdd() {
        this.div = document.createElement('div');
        this.div.style.position = 'absolute';
        this.div.style.top = '-5000px';
        this.div.style.left = '-5000px';
        this.div.style.width = '10000px';
        this.div.style.height = '10000px';
        this.div.style.background = 'rgba(15,20,50,0.45)';
        this.div.style.pointerEvents = 'none';
        this.div.style.opacity = '0';
        this.div.style.transition = 'opacity 0.5s ease';
        this.getPanes().mapPane.appendChild(this.div);
      }
      // Premier dessin: la projection existe (Google la donne plus tard que la création). Les dessins qui en
      // dépendent (soleil, heures, nuit, ombres des formes) se refont alors une fois.
      draw() { if (!this._ready) { this._ready = true; setOverlayTick(t => t + 1); } }
      setNight(opacity) { if (this.div) this.div.style.opacity = String(opacity); }
      onRemove() { if (this.div) { this.div.parentNode.removeChild(this.div); this.div = null; } }
    }
    if (nightOverlayRef.current) nightOverlayRef.current.setMap(null);
    nightOverlayRef.current = new NightOverlay();
    nightOverlayRef.current.setMap(map);

    // Fixed center pin: map pans behind it
    if (markerRef.current) markerRef.current.setMap(null);
    markerRef.current = null;
    // Detect map pan → update adjustedPos (exploratoire, ne modifie PAS le projet)
    const panListener = map.addListener('idle', () => {
      const c = map.getCenter();
      const pos0 = projectPosRef.current;
      if (!pos0) return;
      const dist = Math.abs(c.lat() - pos0.lat) + Math.abs(c.lng() - pos0.lng);
      if (dist > 0.00005) {
        const pos = { lat: c.lat(), lng: c.lng() };
        setAdjustedPos(pos);
        effectiveCenterRef.current = pos;
      } else {
        setAdjustedPos(null);
        effectiveCenterRef.current = null;
      }
    });

    setMapEpoch(e => e + 1);
    setActiveEngine(mapEngine);

    // Sun lines are drawn by the sunDate/adjustedPos effect.
    // No drag/zoom listener needed: yellow line, glow, current time line
    // and sun/moon dot are all drawn on the flareCanvas / as fixed-viewport
    // divs, so they remain visually pinned during map movement.

    const teardown = () => {
      sunLinesRef.current.forEach(l => l.setMap(null));
      sunLinesRef.current = [];
      if (sunPosLineRef.current) { sunPosLineRef.current.setMap(null); sunPosLineRef.current = null; }
      if (shadowLineRef.current) { shadowLineRef.current.setMap(null); shadowLineRef.current = null; }
      if (sunPosMarkerRef.current) { sunPosMarkerRef.current.setMap(null); sunPosMarkerRef.current = null; }
      sunTimePillsRef.current.forEach(el => el.remove()); sunTimePillsRef.current = [];
      if (nightOverlayRef.current) { nightOverlayRef.current.setMap(null); nightOverlayRef.current = null; }
      buildingPolygonsRef.current.forEach(p => p.setMap(null)); buildingPolygonsRef.current = [];
      shadowPolygonsRef.current.forEach(p => p.setMap(null)); shadowPolygonsRef.current = [];
      wallPolygonsRef.current.forEach(p => p.setMap(null)); wallPolygonsRef.current = [];
      roofPolygonsRef.current.forEach(p => p.setMap(null)); roofPolygonsRef.current = [];
      gm().event.removeListener(panListener);
      handles.forEach((h) => gm().event.removeListener(h));
      if (shadowOverlayRef.current) { shadowOverlayRef.current.setMap(null); shadowOverlayRef.current = null; }
      // Cadrage gardé pour la carte suivante (passage SAT <-> SAT2), étiqueté avec la position pour laquelle cette
      // carte avait été construite: après un changement d'adresse, la nouvelle carte s'ouvre sur la nouvelle adresse.
      const c = map.getCenter();
      const built = mapBuiltForRef.current;
      mapCameraRef.current = c && built ? { center: { lat: c.lat(), lng: c.lng() }, zoom: map.getZoom(), lat: built.lat, lng: built.lng } : null;
      if (apple) map.destroy(); // libère MapKit, ses écouteurs et ses calques
      else counterOverlay.setMap(null); // arrête sa minuterie; la carte Google elle-même reste pour un retour sur SAT
      if (mapInstanceRef.current === map) mapInstanceRef.current = null;
    };
    mapTeardownRef.current = teardown;
    return () => {
      // When skipping (drag-reposition), don't clean up anything: everything persists
      if (skipMapRecreateRef.current) return;
      mapTeardownRef.current = null;
      teardown();
    };
  }, [project?.lat, project?.lng, mapEngine]);

  // Première ouverture de SAT2: MapKit JS se charge; la carte SAT reste en place et utilisable d'ici là.
  useEffect(() => {
    if (mapType !== 'sat2' || mapKitReady || !AppleSat.appleSatAvailable()) return;
    let alive = true;
    AppleSat.loadMapKit()
      .then(() => { if (alive) setMapKitReady(true); })
      .catch((e) => { console.warn('[SAT2]', e.message); if (alive) setMapType('hybrid'); });
    return () => { alive = false; };
  }, [mapType, mapKitReady]);

  // SAT2 refusé par Plans (jeton, domaine, quota): retour sur SAT.
  useEffect(() => AppleSat.onAppleMapsError(() => setMapType('hybrid')), []);

  // SAT2: noms de rues dessinés par nous (le satellite d'Apple n'en a pas), d'après les rues de la vue 3D.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (mapEngine !== 'apple' || !(map instanceof AppleSat.Map) || !project?.lat || !project?.lng) return;
    let labels = null;
    let cancelled = false;
    loadScene(project.lat, project.lng).then((scene) => {
      if (cancelled || mapInstanceRef.current !== map) return;
      labels = new StreetLabels(scene);
      labels.setMap(map);
    }).catch((e) => console.warn('[SAT2] noms de rues:', e.message));
    return () => { cancelled = true; if (labels) { try { labels.setMap(null); } catch (e) { /* carte déjà démontée */ } } };
  }, [mapEpoch, mapEngine, project?.lat, project?.lng]);

  // Rotation de l'iPad: carte au-dessus des champs (dans le défilement: un doigt fait défiler la page, deux
  // doigts déplacent la carte) ou carte à droite (un doigt la déplace).
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (map && !isMobile) map.setOptions({ gestureHandling: stackMap ? 'cooperative' : 'greedy' });
  }, [stackMap, isMobile, mapEpoch]);

  // Redraw sun lines when sunDate or adjustedPos changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !project?.lat || !project?.lng || !SunCalc) return;
    const eLat = adjustedPos?.lat ?? project.lat;
    const eLng = adjustedPos?.lng ?? project.lng;
    
    sunLinesRef.current.forEach(l => l.setMap(null));
    sunLinesRef.current = [];
    
    if (!showSunLines || drawingMode) return;
    const bounds = map.getBounds();
    const getR = () => {
      if (!bounds) return 0.003;
      const latSpan = Math.abs(bounds.getNorthEast().lat() - bounds.getSouthWest().lat());
      const lngSpan = Math.abs(bounds.getNorthEast().lng() - bounds.getSouthWest().lng());
      return Math.min(latSpan, lngSpan) * 0.38 * (isMobile ? 0.74 : 1);
    };
    
    const sunTimes = SunCalc.getTimes(sunDate, eLat, eLng);
    
    // Helper: offset a point away from center by pixels (for circle cutout)
    const circleRadiusPx = 17; // 34px/2 + 3px border
    const metersPerPx = 156543.03392 * Math.cos(eLat * Math.PI / 180) / Math.pow(2, mapZoom);
    const offsetDeg = (circleRadiusPx * metersPerPx) / 111320;
    
    const drawLine = (azRad, color, opacity, weight) => {
      const bearing = (azRad * 180 / Math.PI + 180) % 360;
      const R = getR();
      const bRad = bearing * Math.PI / 180;
      const startLat = eLat + offsetDeg * Math.cos(bRad);
      const startLng = eLng + offsetDeg * Math.sin(bRad) / Math.cos(eLat * Math.PI / 180);
      const lat2 = eLat + R * Math.cos(bRad);
      const lng2 = eLng + R * Math.sin(bRad) / Math.cos(eLat * Math.PI / 180);
      const line = new (gm().Polyline)({
        path: [{ lat: startLat, lng: startLng }, { lat: lat2, lng: lng2 }],
        strokeColor: color, strokeOpacity: opacity, strokeWeight: weight, map
      });
      sunLinesRef.current.push(line);
    };

    // sr/ss lines drawn on canvas (below: halos, above: lines)
    
    // Shadow pie wedge: dark gradient opposite to sun
    const simDatePie = new Date(sunDate);
    simDatePie.setHours(Math.floor(sunHour), Math.round((sunHour % 1) * 60), 0);
    const sunPosPie = SunCalc.getPosition(simDatePie, eLat, eLng);
    const sunBearingPie = (sunPosPie.azimuth * 180 / Math.PI + 180) % 360;
    const shadowBearingPie = (sunBearingPie + 180) % 360;
    const altDegPie = sunPosPie.altitude * 180 / Math.PI;
    if (altDegPie > 0) {
      // Shadow wedge drawn on canvas overlay for smooth gradient
    }
  }, [sunDate, project?.lat, project?.lng, mapZoom, adjustedPos, showSunLines, drawingMode, sunHour, mapEpoch]);

  // Hide POI labels in drawing mode or when sun lines hidden
  const savedMapStylesRef = React.useRef(null);
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (drawingMode || !showSunLines) {
      savedMapStylesRef.current = map.get('styles') || [];
      const poiHidden = [
        ...savedMapStylesRef.current.filter(s => s.featureType !== 'poi' && s.featureType !== 'transit'),
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] }
      ];
      map.setOptions({ styles: poiHidden });
    } else {
      if (savedMapStylesRef.current !== null) {
        map.setOptions({ styles: savedMapStylesRef.current });
        savedMapStylesRef.current = null;
      }
    }
  }, [drawingMode, showSunLines, mapEpoch]);

  // Escape key closes fullscreen map
  useEffect(() => {
    if (!showMapFull) return;
    const onKey = (e) => { if (e.key === 'Escape') setShowMapFull(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showMapFull]);

  // Resize map when fullscreen toggled
  useEffect(() => {
    let t1, t2;
    if (mapInstanceRef.current && project?.lat && project?.lng) {
      // La carte peut avoir changé (SAT <-> SAT2) entre-temps: on relit la carte en place au moment voulu.
      const doResize = () => {
        const m = mapInstanceRef.current;
        if (!m) return;
        gm().event.trigger(m, 'resize');
        m.setCenter({ lat: project.lat, lng: project.lng });
      };
      t1 = setTimeout(doResize, 50);
      t2 = setTimeout(doResize, 300);
    }
    document.body.style.overflow = showMapFull ? 'hidden' : '';
    return () => { clearTimeout(t1); clearTimeout(t2); document.body.style.overflow = ''; };
  }, [showMapFull]);

  // Fetch terrain elevation profile when position changes
  const elevLat = adjustedPos?.lat ?? project?.lat ?? 0;
  const elevLng = adjustedPos?.lng ?? project?.lng ?? 0;
  const elevGridLat = parseFloat(elevLat.toFixed(3));
  const elevGridLng = parseFloat(elevLng.toFixed(3));
  React.useEffect(() => {
    if (!elevLat || !elevLng) return;
    let cancelled = false;
    getElevationProfile(elevLat, elevLng).then(profile => {
      if (!cancelled && profile) {
        terrainProfileRef.current = profile;
        setTerrainProfile(profile);
      }
    });
    return () => { cancelled = true; };
  }, [elevGridLat, elevGridLng]);

  // Separate effect for sun position line (slider): lightweight update
  // All dynamic sun elements (yellow line, glow, current time line, sun/moon
  // dot) are drawn either on the flareCanvas or as fixed-viewport divs,
  // mutated DIRECTLY via refs (no setState, no Google Maps Polyline). They
  // stay visually pinned to the viewport center pin during map drag/zoom.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !project?.lat || !project?.lng || !SunCalc) return;
    const eLat = adjustedPos?.lat ?? project.lat;
    const eLng = adjustedPos?.lng ?? project.lng;

    // Hide the sun/moon dot div while we recompute (will re-show below if needed)
    if (sunDotContainerRef.current) sunDotContainerRef.current.style.display = 'none';

    if (!showSunLines || drawingMode) {
      if (flareCanvasRef.current) { const fc = flareCanvasRef.current.getContext('2d'); fc && fc.clearRect(0, 0, flareCanvasRef.current.width, flareCanvasRef.current.height); }
      return;
    }

    const sunTimes = SunCalc.getTimes(sunDate, eLat, eLng);
    const srTime = sunTimes.sunrise ? sunTimes.sunrise.getHours() + sunTimes.sunrise.getMinutes()/60 : 6;
    const ssTime = sunTimes.sunset ? sunTimes.sunset.getHours() + sunTimes.sunset.getMinutes()/60 : 18;

    const simDate = new Date(sunDate);
    simDate.setHours(Math.floor(sunHour), Math.round((sunHour % 1) * 60), 0);
    const sunPos = SunCalc.getPosition(simDate, eLat, eLng);
    const bearing = (sunPos.azimuth * 180 / Math.PI + 180) % 360;
    sunBearingRef.current = { bearing, eLat, eLng };

    const isDay = sunHour >= srTime && sunHour <= ssTime;
    const isGoldenBefore = sunHour >= (srTime - 1) && sunHour < srTime;
    const isGoldenAfter = sunHour > ssTime && sunHour <= (ssTime + 1);
    const isNight = !isDay && !isGoldenBefore && !isGoldenAfter;
    // Moon mode: as soon as sun passes ss or sr lines
    const isMoonMode = sunHour > ssTime || sunHour < srTime;
    const lineColor = isMoonMode ? '#c8d8f0' : '#ffe26b';
    const lineOpacity = isMoonMode ? 0.7 : (isGoldenBefore || isGoldenAfter) ? 0.8 : 1;

    // Terrain shadow check
    const sunAltDeg = sunPos.altitude * 180 / Math.PI;
    const inTerrainShadow = isTerrainShadow(terrainProfileRef.current, bearing, sunAltDeg);
    setTerrainShadow(inTerrainShadow);

    // Lens flare + shadow wedge: project to screen
    const overlay = nightOverlayRef.current;
    if (overlay && overlay.getProjection() && flareCanvasRef.current) {
      const proj = overlay.getProjection();
      const centerPx = proj.fromLatLngToContainerPixel(new (gm().LatLng)(eLat, eLng));
      if (centerPx) {
        const container = mapContainerRef.current;
        const w = container ? container.offsetWidth : 400;
        const h = container ? container.offsetHeight : 400;
        const canvas = flareCanvasRef.current;
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, w, h);
        // Clean up previous time pills
        sunTimePillsRef.current.forEach(el => el.remove());
        sunTimePillsRef.current = [];

        // Compute line length in pixels: used by sr/ss white lines AND by
        // the yellow sun line + current time line + sun/moon dot below.
        // Same formula as before, sorti du block sr/ss pour partage.
        const rDeg = (() => {
          const b = map.getBounds();
          if (!b) return 0.003;
          const latS = Math.abs(b.getNorthEast().lat() - b.getSouthWest().lat());
          const lngS = Math.abs(b.getNorthEast().lng() - b.getSouthWest().lng());
          return Math.min(latS, lngS) * 0.38 * (isMobile ? 0.74 : 1);
        })();
        const endPtR = proj.fromLatLngToContainerPixel(new (gm().LatLng)(eLat + rDeg, eLng));
        const wLinePx = Math.abs(endPtR.y - centerPx.y);
        const circOff = 17;

        // Sun position at current sunHour, in screen-space pixels
        const sunScrAngle = ((sunPos.azimuth * 180 / Math.PI + 180) % 360 - 90) * Math.PI / 180;
        const sunPx = {
          x: centerPx.x + Math.cos(sunScrAngle) * wLinePx,
          y: centerPx.y + Math.sin(sunScrAngle) * wLinePx
        };

        // Sunrise & Sunset line halos: drawn first (behind white lines)
        if (sunTimes.sunrise && sunTimes.sunset) {
          const srAzH = SunCalc.getPosition(sunTimes.sunrise, eLat, eLng).azimuth;
          const ssAzH = SunCalc.getPosition(sunTimes.sunset, eLat, eLng).azimuth;
          const srScrH = ((srAzH * 180 / Math.PI + 180) % 360 - 90) * Math.PI / 180;
          const ssScrH = ((ssAzH * 180 / Math.PI + 180) % 360 - 90) * Math.PI / 180;
          const haloLen = Math.max(w, h) * 1.5;
          const rDegH = (() => {
            const b = map.getBounds();
            if (!b) return 0.003;
            const latS = Math.abs(b.getNorthEast().lat() - b.getSouthWest().lat());
            const lngS = Math.abs(b.getNorthEast().lng() - b.getSouthWest().lng());
            return Math.min(latS, lngS) * 0.38 * (isMobile ? 0.74 : 1);
          })();
          const endPtH = proj.fromLatLngToContainerPixel(new (gm().LatLng)(eLat + rDegH, eLng));
          const centerPtH = proj.fromLatLngToContainerPixel(new (gm().LatLng)(eLat, eLng));
          const lineLenPx = Math.abs(endPtH.y - centerPtH.y);

          const drawLineHalo = (lineAngle, cr, cg, cb) => {
            const dist = lineLenPx * 0.45;
            const gx = centerPx.x + Math.cos(lineAngle) * dist;
            const gy = centerPx.y + Math.sin(lineAngle) * dist;
            const radius = isMobile ? 221 : 300;
            
            ctx.save();
            ctx.globalCompositeOperation = 'overlay';
            ctx.beginPath();
            ctx.moveTo(centerPx.x, centerPx.y);
            ctx.arc(centerPx.x, centerPx.y, haloLen, srScrH, ssScrH);
            ctx.closePath();
            ctx.clip();

            const hGrad = ctx.createRadialGradient(gx, gy, 0, gx, gy, radius);
            hGrad.addColorStop(0, 'rgba('+cr+','+cg+','+cb+',0.75)');
            hGrad.addColorStop(0.2, 'rgba('+cr+','+cg+','+cb+',0.45)');
            hGrad.addColorStop(0.5, 'rgba('+cr+','+cg+','+cb+',0.15)');
            hGrad.addColorStop(1, 'rgba('+cr+','+cg+','+cb+',0)');
            ctx.fillStyle = hGrad;
            ctx.fillRect(0, 0, w, h);
            ctx.restore();
          };
          drawLineHalo(srScrH, 172, 156, 77);
          drawLineHalo(ssScrH, 30, 47, 63);
        }
        
        // Shadow wedge: smooth radial gradient clamped to sunrise/sunset
        const altDeg = sunPos.altitude * 180 / Math.PI;
        if (altDeg > 0 && !isNight) {
          const sunBearingDeg = (sunPos.azimuth * 180 / Math.PI + 180) % 360;
          // Sunrise/sunset bearings
          const srAzRad = sunTimes.sunrise ? SunCalc.getPosition(sunTimes.sunrise, eLat, eLng).azimuth : 0;
          const ssAzRad = sunTimes.sunset ? SunCalc.getPosition(sunTimes.sunset, eLat, eLng).azimuth : 0;
          // Convert to screen angles (bearing 0=north=up, canvas 0=right, so rotate -90)
          const srScreenAngle = ((srAzRad * 180 / Math.PI + 180) % 360 - 90) * Math.PI / 180;
          const ssScreenAngle = ((ssAzRad * 180 / Math.PI + 180) % 360 - 90) * Math.PI / 180;
          const shadowScreenAngle = (((sunBearingDeg + 180) % 360) - 90) * Math.PI / 180;
          
          // Wedge half-angle
          const wedgeHalf = Math.max(10, 30 - altDeg * 0.4) * Math.PI / 180;
          // Length scales with altitude
          const shadowLen = altDeg < 10 ? 0.8 : altDeg < 30 ? 0.8 - (altDeg - 10) * 0.02 : altDeg < 60 ? 0.4 - (altDeg - 30) * 0.005 : 0.25;
          const maxR = Math.max(w, h) * shadowLen;
          const circleR = 17;
          
          // Normalize angles to find distance from shadow edges to sr/ss lines
          const normAngle = (a) => { let v = a % (2*Math.PI); if (v < 0) v += 2*Math.PI; return v; };
          const angleDist = (a, b) => { let d = normAngle(a - b); return d > Math.PI ? 2*Math.PI - d : d; };
          
          // Distance from shadow edge to sr and ss lines
          const distToSr = angleDist(shadowScreenAngle, srScreenAngle);
          const distToSs = angleDist(shadowScreenAngle, ssScreenAngle);
          
          // Clamp wedge so it doesn't pass sr/ss lines (with 5° margin)
          const margin = 5 * Math.PI / 180;
          const leftEdge = shadowScreenAngle - wedgeHalf;
          const rightEdge = shadowScreenAngle + wedgeHalf;
          const distLeftToSr = angleDist(leftEdge, srScreenAngle);
          const distLeftToSs = angleDist(leftEdge, ssScreenAngle);
          const distRightToSr = angleDist(rightEdge, srScreenAngle);
          const distRightToSs = angleDist(rightEdge, ssScreenAngle);
          
          // Compute how close shadow center is to sr/ss: fade opacity
          const minDist = Math.min(distToSr, distToSs);
          const fadeZone = 45 * Math.PI / 180; // fade over 45 degrees: very gradual
          const edgeFade = minDist < fadeZone ? Math.pow(minDist / fadeZone, 0.7) : 1;
          const baseOpacity = 0.5 * edgeFade;
          
          // Clip to night-side arc (between sr and ss on shadow side)
          ctx.save();
          // First clip: sr to ss on the shadow side
          ctx.beginPath();
          ctx.moveTo(centerPx.x, centerPx.y);
          // Draw arc from sr line to ss line going through shadow direction (the long way around on shadow side)
          let srN = normAngle(srScreenAngle);
          let ssN = normAngle(ssScreenAngle);
          // The shadow side is the arc from ss → sr going the other way (through shadow)
          ctx.arc(centerPx.x, centerPx.y, maxR * 1.5, ssScreenAngle, srScreenAngle);
          ctx.closePath();
          ctx.clip();
          
          // Now draw the wedge within the clipped region
          ctx.beginPath();
          ctx.moveTo(centerPx.x, centerPx.y);
          ctx.arc(centerPx.x, centerPx.y, maxR, shadowScreenAngle - wedgeHalf, shadowScreenAngle + wedgeHalf);
          ctx.closePath();
          ctx.clip();
          
          // Smooth radial gradient: soft and blurry
          const grad = ctx.createRadialGradient(centerPx.x, centerPx.y, circleR, centerPx.x, centerPx.y, maxR);
          grad.addColorStop(0, `rgba(0,0,0,${0.40 * edgeFade})`);
          grad.addColorStop(0.1, `rgba(0,0,0,${0.28 * edgeFade})`);
          grad.addColorStop(0.3, `rgba(0,0,0,${0.12 * edgeFade})`);
          grad.addColorStop(0.6, `rgba(0,0,0,${0.04 * edgeFade})`);              grad.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, w, h);
          ctx.restore();
          
          // Soft feathered edge (also clipped)
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(centerPx.x, centerPx.y);
          ctx.arc(centerPx.x, centerPx.y, maxR * 1.5, ssScreenAngle, srScreenAngle);
          ctx.closePath();
          ctx.clip();
          ctx.beginPath();
          ctx.moveTo(centerPx.x, centerPx.y);
          ctx.arc(centerPx.x, centerPx.y, maxR * 1.3, shadowScreenAngle - wedgeHalf * 1.8, shadowScreenAngle + wedgeHalf * 1.8);
          ctx.closePath();
          ctx.clip();
          const grad2 = ctx.createRadialGradient(centerPx.x, centerPx.y, circleR, centerPx.x, centerPx.y, maxR * 0.6);
          grad2.addColorStop(0, `rgba(0,0,0,${0.12 * edgeFade})`);
          grad2.addColorStop(0.3, `rgba(0,0,0,${0.05 * edgeFade})`);
          grad2.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = grad2;
          ctx.fillRect(0, 0, w, h);
          ctx.restore();
        }
        
        // White sr/ss lines: on top of shadow + halos
        // (uses wLinePx + circOff already computed at top of block)
        if (sunTimes.sunrise && sunTimes.sunset) {
          const srAzW = SunCalc.getPosition(sunTimes.sunrise, eLat, eLng).azimuth;
          const ssAzW = SunCalc.getPosition(sunTimes.sunset, eLat, eLng).azimuth;
          const srScrW = ((srAzW * 180 / Math.PI + 180) % 360 - 90) * Math.PI / 180;
          const ssScrW = ((ssAzW * 180 / Math.PI + 180) % 360 - 90) * Math.PI / 180;
          const drawCanvasLine = (scrAngle) => {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(centerPx.x + Math.cos(scrAngle) * circOff, centerPx.y + Math.sin(scrAngle) * circOff);
            ctx.lineTo(centerPx.x + Math.cos(scrAngle) * wLinePx, centerPx.y + Math.sin(scrAngle) * wLinePx);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2.5;
            ctx.stroke();
            ctx.restore();
          };
          drawCanvasLine(srScrW);
          drawCanvasLine(ssScrW);

          // SR/SS time pills at line endpoints (drawn as DOM overlays for sharp text)
          const formatHM = (d) => { const h = d.getHours(); const m = String(d.getMinutes()).padStart(2, '0'); return `${h}H${m}`; };
          const drawTimePill = (scrAngle, timeStr, nudgeX, nudgeY) => {
            const ex = centerPx.x + Math.cos(scrAngle) * wLinePx;
            const ey = centerPx.y + Math.sin(scrAngle) * wLinePx;
            const pill = document.createElement('div');
            pill.className = 'font-bebas-regular';
            pill.textContent = timeStr;
            // Pill touches line endpoint at its inner round edge
            const pillHalfW = 30;
            const offX = Math.cos(scrAngle) * pillHalfW + (nudgeX || 0);
            const offY = Math.sin(scrAngle) * pillHalfW + (nudgeY || 0);
            pill.style.cssText = `position:absolute;left:${ex + offX}px;top:${ey + offY}px;transform:translate(-50%,-50%);background:rgba(0,0,0,0.25);color:#fff;font-size:17px;padding:4px 10px 2px;border-radius:12px;pointer-events:none;white-space:nowrap;letter-spacing:0.04em;line-height:1;z-index:4`;
            canvas.parentElement.appendChild(pill);
            sunTimePillsRef.current.push(pill);
          };
          if (sunTimes.sunrise) drawTimePill(srScrW, formatHM(sunTimes.sunrise), -3, -4);
          if (sunTimes.sunset) drawTimePill(ssScrW, formatHM(sunTimes.sunset), 2, -3);
        }

        // === Dynamic sun overlays: drawn on the SAME canvas, fixed to viewport ===
        // Yellow line glow (or moon glow)
        ctx.save();
        ctx.lineCap = 'round';
        if (!isMoonMode) {
          ctx.strokeStyle = '#ffe26b';
          ctx.globalAlpha = isMobile ? 0.017 : 0.15;
          ctx.lineWidth = 36;
        } else {
          ctx.strokeStyle = '#c8d8f0';
          ctx.globalAlpha = isMobile ? 0.05 : 0.1;
          ctx.lineWidth = 24;
        }
        ctx.beginPath();
        ctx.moveTo(centerPx.x + Math.cos(sunScrAngle) * circOff, centerPx.y + Math.sin(sunScrAngle) * circOff);
        ctx.lineTo(sunPx.x, sunPx.y);
        ctx.stroke();
        ctx.restore();

        // Yellow line (or blue at night): main sun position line at current sunHour
        ctx.save();
        ctx.strokeStyle = lineColor;
        ctx.globalAlpha = lineOpacity;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(centerPx.x + Math.cos(sunScrAngle) * circOff, centerPx.y + Math.sin(sunScrAngle) * circOff);
        ctx.lineTo(sunPx.x, sunPx.y);
        ctx.stroke();
        ctx.restore();

        // White line for current real-world time (only if sun is up or twilight)
        {
          const now = new Date();
          const nowH = now.getHours() + now.getMinutes()/60;
          if (nowH >= (srTime - 1) && nowH <= (ssTime + 1)) {
            const sunPosNow = SunCalc.getPosition(now, eLat, eLng);
            const nowScrAngle = ((sunPosNow.azimuth * 180 / Math.PI + 180) % 360 - 90) * Math.PI / 180;
            ctx.save();
            ctx.strokeStyle = '#ffffff';
            ctx.globalAlpha = 0.35;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(centerPx.x + Math.cos(nowScrAngle) * circOff, centerPx.y + Math.sin(nowScrAngle) * circOff);
            ctx.lineTo(centerPx.x + Math.cos(nowScrAngle) * wLinePx, centerPx.y + Math.sin(nowScrAngle) * wLinePx);
            ctx.stroke();
            ctx.restore();
          }
        }

        // === Sun/Moon dot: positioned in pixels, fixed to viewport ===
        // Mutates refs.current.style directly, no React re-render.
        if (sunDotContainerRef.current && sunDotInnerRef.current && sunDotHaloRef.current) {
          const dotContainer = sunDotContainerRef.current;
          const dotInner = sunDotInnerRef.current;
          const dotHalo = sunDotHaloRef.current;
          const moonSz = 24, sunSz = 18, haloSz = 70;
          const totalSz = isMoonMode ? haloSz : sunSz;
          const innerOffset = isMoonMode ? (haloSz - moonSz) / 2 : 0;
          const innerSz = isMoonMode ? moonSz : sunSz;
          const newLeft = sunPx.x - totalSz / 2;
          const newTop = sunPx.y - totalSz / 2;
          const prevLeft = parseFloat(dotContainer.style.left);
          const prevTop = parseFloat(dotContainer.style.top);
          dotContainer.style.display = 'block';
          dotContainer.style.left = newLeft + 'px';
          dotContainer.style.top = newTop + 'px';
          dotContainer.style.width = totalSz + 'px';
          dotContainer.style.height = totalSz + 'px';
          if (isMoonMode) {
            dotHalo.style.display = 'block';
            dotHalo.style.left = '0px';
            dotHalo.style.top = '0px';
            dotHalo.style.width = haloSz + 'px';
            dotHalo.style.height = haloSz + 'px';
            dotHalo.style.background = 'radial-gradient(circle, rgba(230,225,210,0.25) 0%, rgba(210,205,190,0.12) 35%, rgba(190,185,170,0.04) 60%, transparent 75%)';
            dotInner.style.width = innerSz + 'px';
            dotInner.style.height = innerSz + 'px';
            dotInner.style.left = innerOffset + 'px';
            dotInner.style.top = innerOffset + 'px';
            dotInner.style.background = 'radial-gradient(circle at 35% 30%, #faf6ee 0%, #f0e8d8 20%, #ddd5c5 45%, #c8bfaf 70%, #b5ad9d 100%)';
            dotInner.style.boxShadow = '0 0 6px 2px rgba(245,240,225,0.7), inset -4px -3px 6px rgba(0,0,0,0.2), inset 2px 2px 4px rgba(255,255,255,0.35), inset -1px 1px 2px rgba(0,0,0,0.1)';
            dotInner.style.border = '1px solid rgba(255,255,255,0.4)';
          } else {
            dotHalo.style.display = 'none';
            dotInner.style.width = innerSz + 'px';
            dotInner.style.height = innerSz + 'px';
            dotInner.style.left = '0px';
            dotInner.style.top = '0px';
            dotInner.style.background = 'radial-gradient(circle, #ffe26b 50%, rgba(255,226,107,0.3) 100%)';
            dotInner.style.boxShadow = '0 0 6px 2px rgba(255,226,107,0.9), 0 0 14px 4px rgba(255,226,107,0.5), 0 0 3px 1px rgba(255,255,255,0.8)';
            dotInner.style.border = '2px solid rgba(255,255,255,0.6)';
          }
          // Motion blur: applied instantly, cleared instantly by JS.
          // No CSS transition: the blur tracks the dot position frame by
          // frame (visible while moving, gone at rest), no lag, no smear.
          if (!isNaN(prevLeft) && !isNaN(prevTop)) {
            const dx = newLeft - prevLeft;
            const dy = newTop - prevTop;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 1) {
              dotInner.style.filter = 'blur(' + Math.min(dist * 0.4, 6) + 'px)';
              requestAnimationFrame(() => {
                if (sunDotInnerRef.current) sunDotInnerRef.current.style.filter = 'blur(0px)';
              });
            } else {
              dotInner.style.filter = 'blur(0px)';
            }
          } else {
            dotInner.style.filter = 'blur(0px)';
          }
        }

        // Lens flare
        drawLensFlare(sunPx.x, sunPx.y, w, h, sunPos.altitude);
      }
    }
  }, [sunHour, project?.lat, project?.lng, mapType, mapZoom, sunDate, adjustedPos, showSunLines, drawingMode, mapEpoch, overlayTick]);

  // Night overlay toggle
  useEffect(() => {
    if (nightOverlayRef.current) nightOverlayRef.current.setNight(nightOpacity);
  }, [nightOpacity, mapEpoch, overlayTick]);

  // Current time white line is now drawn on the flareCanvas in the
  // sun-position-line effect above (fixed to viewport, no Google Maps Polyline).
  const currentTimeLineRef = React.useRef(null);

  if (!project) return null;
  const sun = weather?.daily?.[0];
  const departAM = calcDeparture(sun?.sunrise, project.travelTime?.durationSeconds);
  const departPM = calcDeparture(sun?.sunset, project.travelTime?.durationSeconds);
  // Heure du shooting entrée: un seul départ (heure - trajet) remplace les deux départs au soleil.
  const departShoot = project.shootTime ? calcDepartureFromShootTime(project.shootTime, project.travelTime?.durationSeconds) : null;

  const colorActive = '#FAF9F7';
  const colorInactive = '#404A48';
  const colorCharcoal = '#8B9B99';
  const colorRed = '#d83152';

  const handleDelete = () => {
    if (confirm) { deleteProject(project.id); onClose(); }
    else { setConfirm(true); setConfirmDone(false); setTimeout(() => setConfirm(false), 3000); }
  };
  const handleDone = () => {
    if (confirmDone) { advanceProject(project.id); onClose(); }
    else { setConfirmDone(true); setConfirm(false); setTimeout(() => setConfirmDone(false), 3000); }
  };

  // Hourly weather helper
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

  // Group hourly by day for separators
  const renderHourlyWeather = () => {
    if (!project?.lat || !project?.lng) {
      return null;
    }
    if (!weather?.hourly?.length) {
      return <div className="flex gap-2 py-4">{[...Array(12)].map((_,i) => <div key={i} className="flex flex-col items-center gap-2 min-w-[48px]"><div className="w-12 h-4 bg-cream-dark rounded animate-pulse"/><div className="w-8 h-8 bg-cream-dark rounded-full animate-pulse"/></div>)}</div>;
    }

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const filtered = weather.hourly.filter(h => new Date(h.time) >= oneHourAgo).slice(0, 72);
    
    // Get sunrise/sunset for each day from daily data
    const dailyMap = {};
    if (weather?.daily) {
      weather.daily.forEach(d => {
        const dateStr = new Date(d.sunrise).toDateString();
        dailyMap[dateStr] = { sunrise: d.sunrise, sunset: d.sunset };
      });
    }

    // Group by day
    const days = [];
    let currentDay = null;
    filtered.forEach(h => {
      const hDate = new Date(h.time);
      const dateStr = hDate.toDateString();
      if (dateStr !== currentDay) {
        days.push({ date: hDate, dateStr, hours: [], sun: dailyMap[dateStr] || null });
        currentDay = dateStr;
      }
      days[days.length - 1].hours.push(h);
    });

    // Bloc entier non sélectionnable: sur iPad, le dégradé du bord droit (absent au téléphone) n'était pas protégé comme la
    // bande, et iOS le sélectionnait (poignées bleues et menu Copier) quand le doigt partait du bord pour glisser à gauche.
    return (
      <div className="relative" style={{ WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}>
        <div className="flex gap-0 pt-0 pb-2 overflow-x-auto hour-scroll items-start">
          {days.map((day, di) => {
            const sunriseH = day.sun?.sunrise ? new Date(day.sun.sunrise).getHours() : null;
            const sunsetH = day.sun?.sunset ? new Date(day.sun.sunset).getHours() : null;
            const sunriseM = day.sun?.sunrise ? new Date(day.sun.sunrise).getMinutes() : null;
            const sunsetM = day.sun?.sunset ? new Date(day.sun.sunset).getMinutes() : null;
            
            return (
              <React.Fragment key={day.dateStr}>
                {/* Day separator - vertical line between days */}
                {di > 0 && (
                  <div style={{ width: '1px', background: 'rgba(255,255,255,0.15)', alignSelf: 'stretch', flexShrink: 0, margin: '0 2px', marginBottom: '-8px' }}/>
                )}
                {/* Day header */}
                <div className="flex flex-col flex-shrink-0">
                  <div className="px-2" style={{ paddingBottom: '0', marginBottom: '-9px' }}>
                    <span className="font-bebas-book" style={{ letterSpacing: '0.04em', fontSize: '19px', whiteSpace: 'nowrap', color: '#8B9B99' }}>
                      {['DIMANCHE','LUNDI','MARDI','MERCREDI','JEUDI','VENDREDI','SAMEDI'][day.date.getDay()]} {day.date.getDate()} {['JAN','FÉV','MAR','AVR','MAI','JUN','JUL','AOÛ','SEP','OCT','NOV','DÉC'][day.date.getMonth()]}.
                    </span>
                  </div>
                  {/* Hours row */}
                  <div className="flex gap-0">
                    {day.hours.map(h => {
                      const hDate = new Date(h.time);
                      const hr = hDate.getHours();
                      const min = hDate.getMinutes();
                      const isSunrise = sunriseH === hr;
                      const isSunset = sunsetH === hr;
                      const isNight = sunriseH !== null && sunsetH !== null && (hr < sunriseH || hr >= sunsetH);
                      const icon = getIconFromCloudcover(h.cloudcover, h.icon, isNight, h.sunFraction, h.cloudLow, h.smoke);
                      // Soleil direct (lumiere qui filtre reellement): % + teinte calee sur l'echelle des icones de voile.
                      const sunPct = h.sunFraction != null ? Math.round(h.sunFraction * 100) : null;
                      const sunColor = sunPct == null ? '#6f7d7b' : sunPct >= 60 ? '#E9D27A' : sunPct >= 45 ? '#E4CB78' : sunPct >= 32 ? '#DBCD92' : sunPct >= 20 ? '#CFC8A4' : sunPct >= 10 ? '#C3BDAA' : '#A7A99C';
                      // Probabilité de pluie, juste au-dessus des millimètres: turquoise de la pluie (gouttes de l'icône, millimètres);
                      // 0 % et donnée absente en gris.
                      // Goutte de Lucide remontée d'un pixel de plus que ses voisines: sa masse est en bas.
                      const rainPct = h.precipProb != null ? Math.round(h.precipProb) : null;
                      const rainColor = rainPct ? '#7dd3c6' : '#6f7d7b';

                      // Format sunrise/sunset time
                      let timeLabel = `${hr}H`;
                      if (isSunrise && sunriseM !== null) {
                        const formattedSR = formatTime(day.sun.sunrise).replace(':','H');
                        timeLabel = formattedSR;
                      } else if (isSunset && sunsetM !== null) {
                        const formattedSS = formatTime(day.sun.sunset).replace(':','H');
                        timeLabel = formattedSS;
                      }

                      return (
                        <div key={h.time} className={`flex flex-col items-center gap-0 min-w-[56px] px-0 py-1 ${isNight ? 'bg-charcoal/5' : ''}`} style={!isNight && h.smoke ? { background: SMOKE_TINT[h.smoke] } : undefined}>
                          {/* Sunrise/sunset chevron above time */}
                          {isSunrise && <svg width="18" height="10" viewBox="0 0 18 10" style={{ marginBottom: '8px' }}><polyline points="1,9 9,2 17,9" fill="none" stroke="#404A48" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                          {isSunset && <svg width="18" height="10" viewBox="0 0 18 10" style={{ marginBottom: '8px' }}><polyline points="1,1 9,8 17,1" fill="none" stroke="#404A48" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                          {!(isSunrise || isSunset) && <div style={{ height: '10px', marginBottom: '8px' }}/>}
                          <span className="font-bebas-bold leading-none" style={{ letterSpacing: '0.04em', 
                            fontSize: (isSunrise || isSunset) ? '20px' : '18px',
                            color: (isSunrise || isSunset) ? '#ffffff' : undefined
                          }}>
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
                          <span className="font-bebas-bold text-base leading-none text-charcoal-muted" style={{ letterSpacing: '0.04em', marginTop: '7px' }}>{h.temp}°</span>
                          <span className="font-bebas-bold text-sm leading-none text-charcoal-muted" style={{ marginTop: '7px' }}>{h.wind} <span className="text-xs">{t('kmh')}</span></span>
                          <span className="font-bebas-bold text-base leading-none" style={{ letterSpacing: '0.04em', marginTop: '7px', display: 'inline-flex', alignItems: 'center', gap: '3px', color: rainColor }}>
                            <svg width="10" height="10" viewBox="0 0 24 24" style={{ flexShrink: 0, position: 'relative', top: '-2.5px' }}><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" fill={rainColor}/></svg>
                            {rainPct != null ? `${rainPct}%` : '--'}
                          </span>
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
        {!isMobile && <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-cream to-transparent pointer-events-none"/>}
      </div>
    );
  };

  return (
    <div className="pt-6 animate-fade-in" style={isMobile ? { paddingTop: 'calc(24px + 25px)', paddingBottom: 'calc(130px + env(safe-area-inset-bottom))' } : { paddingTop: 'calc(75px + env(safe-area-inset-top))', paddingBottom: '32px' }}>
      {/* Bande météo + infos: même layout que l'accueil */}
      <div className={`border-b border-adaptive py-4 ${isMobile ? 'px-4' : 'px-8'} overflow-hidden`}>
        <button onClick={onClose} className="text-charcoal-muted hover:text-charcoal transition-colors mb-4" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div style={{ marginBottom: isMobile ? '8px' : '5px' }}>
          <h3 className="font-bebas-book text-charcoal flex items-center gap-2" style={{ letterSpacing: '0.04em', fontSize: isMobile ? '24px' : '35px', lineHeight: '1.1', marginBottom: '0' }}>
            {editingName ? (
              <input 
                autoFocus
                defaultValue={project.name}
                className="bg-transparent outline-none font-bebas-book text-charcoal"
                style={{ letterSpacing: '0.04em', fontSize: isMobile ? '24px' : '35px', width: '80vw', maxWidth: '1200px' }}
                onBlur={e => { const v = e.target.value.trim(); if (v && v !== project.name) updateProject(project.id, { name: v }); setEditingName(false); }}
                onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditingName(false); }}
              />
            ) : (
              <span onClick={() => setEditingName(true)} className="cursor-pointer hover:opacity-70 transition-opacity">{project.name}</span>
            )} {project.isContest && <StarIcon/>}
          </h3>
        </div>
        {isMobile ? (
          /* ===== MOBILE: vertical stack ===== */
          <div>
            <div className="flex items-stretch font-bebas-bold uppercase" style={{ letterSpacing: '0.04em', fontSize: '17px', lineHeight: '1', marginTop: '8px', padding: '4px 0' }}>
              <div className="flex flex-col justify-center pl-2" style={{ borderLeft: '1px solid rgba(139,155,153,0.2)' }}>
                {Object.values(MandateType).filter(m => project.mandates?.includes(m)).map(m => {
                  return <React.Fragment key={m}>{renderMandate(m, colorActive)}</React.Fragment>;
                })}
              </div>
              <div className="flex flex-col justify-center pl-2 ml-3" style={{ borderLeft: '1px solid rgba(139,155,153,0.2)' }}>
                <span style={{ color: colorInactive }}>{t('sun')}</span>
                <span style={{ color: project.orientation?.includes('AM') ? colorActive : colorInactive }}>
                  AM {sun ? formatTime(sun.sunrise) : '-'}
                </span>
                <span style={{ color: project.orientation?.includes('PM') ? colorActive : colorInactive }}>
                  PM {sun ? formatTime(sun.sunset) : '-'}
                </span>
              </div>
              <div className="flex flex-col justify-center pl-2 ml-3" style={{ borderLeft: '1px solid rgba(139,155,153,0.2)' }}>
                <span style={{ color: colorInactive }}>{t('travel')}</span>
                <span style={{ color: project.travelTime?.durationSeconds ? colorActive : colorInactive }}>{project.travelTime?.durationSeconds ? formatDuration(project.travelTime.durationSeconds) : '-'}</span>
                {project.travelTime?.distanceMeters > 0 ? <span style={{ color: colorCharcoal, letterSpacing: "0.1em", marginTop: "-3px", fontSize: "inherit" }}>{Math.round(project.travelTime.distanceMeters / 1000)} KM</span> : <span style={{ color: 'transparent' }}>&nbsp;</span>}
              </div>
              <div className="flex flex-col justify-center pl-2 ml-3" style={{ borderLeft: '1px solid rgba(139,155,153,0.2)' }}>
                <span style={{ color: colorInactive }}>{t('depart')}</span>
                {project.shootTime
                  ? <span style={{ color: departShoot ? colorActive : colorInactive }}>{departShoot ? formatTime(departShoot).replace(':','H') : '-'}</span>
                  : <>
                  <span style={{ color: (project.orientation?.includes('AM') && departAM) ? colorActive : colorInactive }}>{departAM ? formatTime(departAM).replace(':','H') : '-'}</span>
                  <span style={{ color: (project.orientation?.includes('PM') && departPM) ? colorActive : colorInactive }}>{departPM ? formatTime(departPM).replace(':','H') : '-'}</span>
                  </>}
              </div>
              <div className="flex flex-col justify-center pl-2 ml-3" style={{ borderLeft: '1px solid rgba(139,155,153,0.2)' }}>
                <span style={{ color: colorInactive }}>{t('created')}</span>
                <span style={{ color: colorActive }}>{formatDateShort(project.createdAt)}</span>
                <span style={{ color: colorCharcoal }}>{daysSince(project.createdAt)} {daysSince(project.createdAt) <= 1 ? t('day') : t('days')}</span>
              </div>
              {project.shotAt && <div className="flex flex-col justify-center pl-2 ml-3" style={{ borderLeft: '1px solid rgba(139,155,153,0.2)' }}>
                <span style={{ color: colorInactive }}>{t('edited')}</span>
                <span style={{ color: colorActive }}>{formatDateShort(project.shotAt)}</span>
                <span style={{ color: colorCharcoal }}>{daysSince(project.shotAt)} {daysSince(project.shotAt) <= 1 ? t('day') : t('days')}</span>
              </div>}
            </div>
            <div className="border-b border-adaptive" style={{ marginTop: '12px', marginLeft: '-16px', marginRight: '-16px' }}/>
            <div style={{ overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', marginTop: '12px', marginLeft: '-16px', marginRight: '-16px', paddingLeft: '16px', paddingRight: '16px' }}>
              {project.lat && project.lng ? <div style={{ zoom: 1.15 }}><WeatherRow daily={weather?.daily} hourly={weather?.hourly} maxDays={10} orientation={project.orientation}/></div> : <p className="text-charcoal-muted text-sm italic py-2">{t('weatherUnavailable')}</p>}
            </div>
          </div>
        ) : (
          /* ===== DESKTOP: original horizontal ===== */
          /* Quand la place manque (iPad en portrait, fenêtre étroite), les colonnes passent sous les jours au lieu
             de les chevaucher; l'écart de 16 px entre les deux blocs est un gap pour que la 2e ligne parte du bord. */
          <div className="flex items-center" style={{ width: '100%', flexWrap: 'wrap', columnGap: '16px', rowGap: '18px' }}>
            {/* Pendant le chargement, le squelette (plus large que les 10 jours) est rogné à leur largeur (10 x 48 px x 1,15):
                sans ça, les colonnes passaient sous les jours puis remontaient d'un coup à l'arrivée de la météo. */}
            <div className="min-w-0" style={project.lat && project.lng && !weather?.daily?.length ? { width: '552px', overflow: 'hidden' } : undefined}>
              {project.lat && project.lng ? <div style={{ zoom: 1.15 }}><WeatherRow daily={weather?.daily} hourly={weather?.hourly} maxDays={10} orientation={project.orientation}/></div> : <p className="text-charcoal-muted text-sm italic py-2">{t('weatherUnavailable')}</p>}
            </div>
            <div className="flex items-stretch flex-shrink-0 font-bebas-bold uppercase" style={{ letterSpacing: '0.04em', fontSize: '22px', minHeight: '110px', lineHeight: '1', marginBottom: '-16px' }}>
              <div className="flex flex-col justify-center pl-2 border-l border-adaptive">
                {Object.values(MandateType).filter(m => project.mandates?.includes(m)).map(m => {
                  return <React.Fragment key={m}>{renderMandate(m, colorActive)}</React.Fragment>;
                })}
              </div>
              <div className="flex flex-col justify-center pl-2 ml-4 border-l border-adaptive">
                <span style={{ color: colorInactive }}>{t('sun')}</span>
                <span style={{ color: project.orientation?.includes('AM') ? colorActive : colorInactive }}>
                  AM {sun ? formatTime(sun.sunrise) : '--:--'}
                </span>
                <span style={{ color: project.orientation?.includes('PM') ? colorActive : colorInactive }}>
                  PM {sun ? formatTime(sun.sunset) : '--:--'}
                </span>
              </div>
              <div className="flex flex-col justify-center pl-2 ml-4 border-l border-adaptive">
                <span style={{ color: colorInactive }}>{t('travel')}</span>
                <span style={{ color: project.travelTime?.durationSeconds ? colorActive : colorInactive }}>{project.travelTime?.durationSeconds ? formatDuration(project.travelTime.durationSeconds) : '-'}</span>
                {project.travelTime?.distanceMeters > 0 ? <span style={{ color: colorCharcoal, letterSpacing: '0.1em', marginTop: '-5px' }} className="text-lg">{Math.round(project.travelTime.distanceMeters / 1000)} KM</span> : <span style={{ color: 'transparent' }}>&nbsp;</span>}
              </div>
              <div className="flex flex-col justify-center pl-2 ml-4 border-l border-adaptive">
                <span style={{ color: colorInactive }}>{t('depart')}</span>
                {project.shootTime
                  ? <span style={{ color: departShoot ? colorActive : colorInactive }}>{departShoot ? formatTime(departShoot).replace(':','H') : '-'}</span>
                  : <>
                  <span style={{ color: (project.orientation?.includes('AM') && departAM) ? colorActive : colorInactive }}>{departAM ? formatTime(departAM).replace(':','H') : '-'}</span>
                  <span style={{ color: (project.orientation?.includes('PM') && departPM) ? colorActive : colorInactive }}>{departPM ? formatTime(departPM).replace(':','H') : '-'}</span>
                  </>}
              </div>
              <div className="flex flex-col justify-center text-left pl-2 ml-4 border-l border-adaptive">
                <span style={{ color: colorInactive }}>{t('created')}</span>
                <span style={{ color: colorActive, cursor: 'pointer', textDecoration: editingCreatedDate ? 'underline' : 'none', textDecorationColor: 'rgba(255,255,255,0.3)', textUnderlineOffset: '3px' }} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setDetailPickerPos({ top: r.bottom + 4, left: r.left }); originalDateRef.current = project.createdAt; setEditingCreatedDate(p => !p); setEditingShotDate(false); }}>
                  {formatDateShort(project.createdAt)}
                </span>
                <span style={{ color: colorCharcoal }}>{daysSince(project.createdAt)} {daysSince(project.createdAt) <= 1 ? t('day') : t('days')}</span>
              </div>
              {project.shotAt && <div className="flex flex-col justify-center text-left pl-2 ml-4 border-l border-adaptive">
                <span style={{ color: colorInactive }}>{t('edited')}</span>
                <span style={{ color: colorActive, cursor: 'pointer', textDecoration: editingShotDate ? 'underline' : 'none', textDecorationColor: 'rgba(255,255,255,0.3)', textUnderlineOffset: '3px' }} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setDetailPickerPos({ top: r.bottom + 4, left: r.left }); originalDateRef.current = project.shotAt; setEditingShotDate(p => !p); setEditingCreatedDate(false); }}>
                  {formatDateShort(project.shotAt)}
                </span>
                <span style={{ color: colorCharcoal }}>{daysSince(project.shotAt)} {daysSince(project.shotAt) <= 1 ? t('day') : t('days')}</span>
              </div>}
            </div>
          </div>
        )}
        {(editingCreatedDate || editingShotDate) && ReactDOM.createPortal(
          <React.Fragment>
            <div onClick={() => { if (editingCreatedDate && originalDateRef.current) updateProject(project.id, { createdAt: originalDateRef.current }); if (editingShotDate && originalDateRef.current) updateProject(project.id, { shotAt: originalDateRef.current }); setEditingCreatedDate(false); setEditingShotDate(false); }} style={{ position: 'fixed', inset: 0, zIndex: 9998 }}/>
            <div style={{ position: 'fixed', top: detailPickerPos.top, left: detailPickerPos.left, zIndex: 9999 }}>
              {editingCreatedDate && <DateWheelPicker dropDown title={t('createdDate')} date={new Date(project.createdAt)} onChange={d => { updateProject(project.id, { createdAt: d.toISOString() }); }} onCancel={d => { updateProject(project.id, { createdAt: d.toISOString() }); }} onClose={() => setEditingCreatedDate(false)} />}
              {editingShotDate && project.shotAt && <DateWheelPicker dropDown title={t('editedDate')} date={new Date(project.shotAt)} onChange={d => { updateProject(project.id, { shotAt: d.toISOString() }); }} onCancel={d => { updateProject(project.id, { shotAt: d.toISOString() }); }} onClose={() => setEditingShotDate(false)} />}
            </div>
          </React.Fragment>,
          document.body
        )}
      </div>

      {/* Météo horaire: redesigned. Sur iPad, section entière non sélectionnable: ses marges de 48 px et son titre
          bordent la bande, là où le doigt se pose pour la faire défiler (au téléphone, la bande va jusqu'au bord). */}
      {(!isMobile || (project?.lat && project?.lng)) && <div className={`${isMobile ? 'pl-4 pr-0' : 'px-8 md:px-12'} border-b border-adaptive`} style={isMobile ? undefined : { WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}>
        <div className="pt-3 pb-1">
          <span className="font-bebas-book text-charcoal-muted" style={{ letterSpacing: '0.04em', fontSize: '22px' }}>{t('hourlyWeather')}</span>
        </div>
        {renderHourlyWeather()}
      </div>}

      {/* Édition + Carte: layout with map bottom-right */}
      <div className={`${isMobile ? 'px-4' : 'px-8 md:px-12'} pt-6`} style={{ position: 'relative' }}>
        <div className={`flex gap-8 ${isMobile || stackMap ? 'flex-col' : 'flex-nowrap'} items-start`} style={isMobile ? {} : {}}>

          {/* Colonne gauche: Édition */}
          <div style={isMobile ? {} : stackMap ? { width: '100%', maxWidth: '700px' } : { width: '700px', flexShrink: 0 }} className={`${isMobile ? 'w-full' : ''} space-y-5`}>
            {/* Address inputs with box style like modal */}
            <div>
              <label className="font-bebas-book text-charcoal-muted" style={{ letterSpacing: '0.04em', fontSize: '22px' }}>{t('projectAddress')}</label>
              <div style={{ border: '1px solid rgba(255,255,255,0.15)', padding: '8px 12px', marginTop: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input ref={addressInputRef} type="text" defaultValue={project.address || ''} placeholder={t('enterAddress')} className="w-full bg-transparent text-charcoal" style={{ fontSize: '15px', outline: 'none', border: 'none', color: 'rgba(255,255,255,0.85)', flex: 1, fontFamily: "'Avenir', sans-serif", fontWeight: 300 }}/>
                {project.address && <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); copyProjectAddress(); }} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', padding: '2px 2px 2px 8px', borderLeft: '1px solid rgba(255,255,255,0.15)', background: 'none', cursor: 'pointer' }} title={addressCopied ? t('addressCopied') : t('copyAddress')} aria-label={addressCopied ? t('addressCopied') : t('copyAddress')}><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#7dd3c6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{addressCopied ? <polyline points="20 6 9 17 4 12"/> : <g><rect x="8" y="8" width="14" height="14" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></g>}</svg></button>}
                {project.address && <a href={`https://earth.google.com/web/search/${encodeURIComponent(project.address)}`} target="_blank" rel="noopener noreferrer" onClick={rtOpenMap} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', padding: '2px 2px 2px 8px', borderLeft: '1px solid rgba(255,255,255,0.15)' }} title="Google Earth" aria-label="Google Earth"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#7dd3c6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" x2="22" y1="12" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></a>}
                {project.address && <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(project.address)}`} target="_blank" rel="noopener noreferrer" onClick={(e) => { e.preventDefault(); e.stopPropagation(); const tmp = document.createElement('a'); tmp.href = e.currentTarget.href; tmp.target = '_blank'; tmp.rel = 'noopener noreferrer'; document.body.appendChild(tmp); tmp.click(); tmp.remove(); }} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', padding: '2px 2px 2px 8px', borderLeft: '1px solid rgba(255,255,255,0.15)' }} title="Itinéraire"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#7dd3c6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg></a>}
              </div>
            </div>
            <div>
              <label className="font-bebas-book text-charcoal-muted" style={{ letterSpacing: '0.04em', fontSize: '22px' }}>{t('departureAddress')}</label>
              <div style={{ border: '1px solid rgba(255,255,255,0.15)', padding: '8px 12px', marginTop: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input ref={departureInputRef} type="text" defaultValue={project.departureAddress || prefs.homeAddress || ''} placeholder={t('departureHint')} className="w-full bg-transparent text-charcoal" style={{ fontSize: '15px', outline: 'none', border: 'none', color: 'rgba(255,255,255,0.85)', flex: 1, fontFamily: "'Avenir', sans-serif", fontWeight: 300 }}
                  onBlur={(e) => {
                    const val = e.target.value.trim();
                    if (!val || val === prefs.homeAddress) {
                      updateProject(project.id, { departureAddress: null, departureLat: null, departureLng: null });
                      e.target.value = prefs.homeAddress || '';
                    }
                  }}
                />
                {(project.departureAddress || prefs.homeAddress) && <a href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(project.departureAddress || prefs.homeAddress || '')}&destination=${encodeURIComponent(project.address || '')}`} target="_blank" rel="noopener noreferrer" onClick={(e) => { e.preventDefault(); e.stopPropagation(); const tmp = document.createElement('a'); tmp.href = e.currentTarget.href; tmp.target = '_blank'; tmp.rel = 'noopener noreferrer'; document.body.appendChild(tmp); tmp.click(); tmp.remove(); }} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', padding: '2px 2px 2px 8px', borderLeft: '1px solid rgba(255,255,255,0.15)' }} title="Itinéraire"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#7dd3c6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg></a>}
              </div>
            </div>
            <div className="py-5 border-b border-adaptive">
              <label className="font-bebas-book text-charcoal-muted" style={{ letterSpacing: '0.04em', fontSize: '22px' }}>MANDAT</label>
              <div className="flex gap-4 flex-wrap mt-1">
                {Object.values(MandateType).map(m => <button key={m} onClick={() => updateProject(project.id, { mandates: toggleMandate(project.mandates, m) })} className="font-bebas-bold" style={{ letterSpacing: '0.04em', fontSize: '22px', color: project.mandates?.includes(m) ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)' }}>{m === 'DRONE+C' ? (project.mandates?.includes(m) ? <span>DRONE.<span style={{color:'#d83152'}}>C</span></span> : 'DRONE.C') : m}</button>)}
              </div>
            </div>
            <div className="py-5 border-b border-adaptive">
              <label className="font-bebas-book text-charcoal-muted" style={{ letterSpacing: '0.04em', fontSize: '22px' }}>ORIENTATION</label>
              <div className="flex gap-5 mt-1">
                {['AM','PM'].map(o => <button key={o} onClick={() => updateProject(project.id, { orientation: project.orientation?.includes(o) ? project.orientation.filter(x => x !== o) : [...(project.orientation||[]), o] })} className="font-bebas-bold" style={{ letterSpacing: '0.04em', fontSize: '22px', color: project.orientation?.includes(o) ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)' }}>{o}</button>)}
              </div>
            </div>
            {/* Heure du shooting (début sur place, ex. un intérieur avant l'extérieur): le départ devient cette heure moins le
                trajet. Vide = départ calculé au soleil, comme avant. */}
            <div className="py-5 border-b border-adaptive">
              <label className="font-bebas-book text-charcoal-muted" style={{ letterSpacing: '0.04em', fontSize: '22px' }}>{t('shootTime')}</label>
              <div className="flex gap-5 mt-1">
                <button onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setShootTimePos(p => p ? null : { top: r.bottom + 4, left: r.left }); }} className="font-bebas-bold" style={{ letterSpacing: '0.04em', fontSize: '22px', color: project.shootTime ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>{project.shootTime ? project.shootTime.replace(':', 'H') : '--H--'}</button>
              </div>
              {shootTimePos && ReactDOM.createPortal(
                <React.Fragment>
                  <div onClick={() => setShootTimePos(null)} style={{ position: 'fixed', inset: 0, zIndex: 9998 }}/>
                  <div style={{ position: 'fixed', top: shootTimePos.top, left: shootTimePos.left, zIndex: 9999 }}>
                    <TimeWheelPicker title={t('shootTime')} value={project.shootTime} onChange={(v) => updateProject(project.id, { shootTime: v })} onClear={() => updateProject(project.id, { shootTime: null })} onClose={() => setShootTimePos(null)}/>
                  </div>
                </React.Fragment>,
                document.body
              )}
            </div>
            <div className="py-5 border-b border-adaptive">
              <FolderCombo key={project.id} value={project.clientFolder || ''} onChange={(v) => updateProject(project.id, { clientFolder: (v && v.trim()) || null })}/>
            </div>

            <div>
              <label className="font-bebas-book text-charcoal-muted" style={{ letterSpacing: '0.04em', fontSize: '22px' }}>{t('notes')}</label>
              {/* Mini toolbar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginTop: '4px', marginBottom: '0px' }}>
                <button onClick={() => { const el = document.getElementById('notes-editor-' + project.id); if (el) { el.focus(); document.execCommand('bold', false, null); } }} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '4px', color: 'rgba(255,255,255,0.6)', width: '30px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold', fontFamily: 'inherit' }} title="Gras (⌘B)">B</button>
                <button onClick={() => { const el = document.getElementById('notes-editor-' + project.id); if (el) { el.focus(); document.execCommand('fontSize', false, '2'); } }} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '4px', color: 'rgba(255,255,255,0.6)', width: '30px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit' }} title="Réduire texte">A−</button>
                <button onClick={() => { const el = document.getElementById('notes-editor-' + project.id); if (el) { el.focus(); document.execCommand('fontSize', false, '5'); } }} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '4px', color: 'rgba(255,255,255,0.6)', width: '30px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '15px', fontFamily: 'inherit' }} title="Agrandir texte">A+</button>
              </div>
              <div style={{ border: '1px solid rgba(255,255,255,0.15)', padding: '8px 12px', marginTop: '0px' }}>
                <div
                  id={'notes-editor-' + project.id}
                  contentEditable
                  suppressContentEditableWarning
                  ref={(el) => {
                    if (el && !el.dataset.init) {
                      let notes = project.notes || '';
                      let mustSave = false;
                      // Auto-prepend project address label if not already present
                      const addr = project.address;
                      if (addr && !notes.includes(addr)) {
                        const addrBlock = `<b>Adresse du projet:</b><br>${addr}`;
                        notes = notes ? `${addrBlock}<br><br>${notes}` : addrBlock;
                        mustSave = true;
                      }
                      el.innerHTML = notes;
                      // Rend cliquables les numéros de téléphone déjà saisis.
                      if (linkifyPhonesInEditor(el)) mustSave = true;
                      if (mustSave) updateProject(project.id, { notes: el.innerHTML });
                      el.dataset.init = '1';
                    }
                  }}
                  onInput={(e) => {
                    updateProject(project.id, { notes: e.currentTarget.innerHTML === '<br>' ? '' : e.currentTarget.innerHTML });
                  }}
                  onPaste={(e) => {
                    // Toujours coller en texte brut: on retire la couleur/le formatage de la source
                    // pour que le texte reste lisible (blanc) sur le fond foncé.
                    e.preventDefault();
                    const raw = (e.clipboardData || window.clipboardData).getData('text/plain');
                    const text = raw.trim();
                    if (/^https?:\/\/\S+$/.test(text)) {
                      document.execCommand('insertHTML', false, `<a href="${text}" target="_blank" style="color:#60a5fa;text-decoration:underline">${text}</a>&nbsp;`);
                    } else {
                      document.execCommand('insertText', false, raw);
                    }
                  }}
                  onClick={(e) => {
                    const a = e.target.closest('a');
                    if (a && a.href) {
                      e.preventDefault();
                      const href = a.getAttribute('href') || a.href;
                      // Numéro de téléphone ou courriel: ouvrir l'app native (appel / mail).
                      if (/^(tel:|mailto:)/i.test(href)) {
                        window.location.href = href;
                        return;
                      }
                      const tmp = document.createElement('a');
                      tmp.href = a.href;
                      tmp.target = '_blank';
                      tmp.rel = 'noopener noreferrer';
                      document.body.appendChild(tmp);
                      tmp.click();
                      tmp.remove();
                    }
                  }}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
                      e.preventDefault();
                      document.execCommand('bold', false, null);
                    }
                  }}
                  onBlur={(e) => {
                    // Quand on quitte le champ, rend cliquables les numéros nouvellement saisis.
                    const el = e.currentTarget;
                    if (linkifyPhonesInEditor(el)) {
                      updateProject(project.id, { notes: el.innerHTML === '<br>' ? '' : el.innerHTML });
                    }
                  }}
                  className="w-full bg-transparent text-charcoal"
                  style={{ fontSize: '15px', outline: 'none', border: 'none', color: 'rgba(255,255,255,0.85)', minHeight: '120px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: '1.5', cursor: 'text', fontFamily: "'Avenir', sans-serif", fontWeight: 300, WebkitUserSelect: 'text', userSelect: 'text', WebkitTouchCallout: 'default' }}
                  data-placeholder={t('notesPlaceholder')}
                />
              </div>
            </div>
          </div>

          {/* Colonne droite: Carte Google Maps interactive, square, bottom-right. Sans place à droite (iPad en
              portrait, fenêtre étroite), elle passe au-dessus des champs sur toute la largeur, comme sur téléphone. */}
          <div className={`${isMobile || stackMap ? 'w-full' : ''} flex flex-col`} data-no-pull={!isMobile && !stackMap ? '' : undefined} style={stackMap ? { height: '640px', order: -1 } : { minHeight: isMobile ? '450px' : undefined, height: isMobile ? undefined : '800px', order: isMobile ? -1 : 0, flex: isMobile ? undefined : '1 0 auto', position: isMobile ? undefined : 'sticky', top: isMobile ? undefined : '20px', alignSelf: isMobile ? undefined : 'flex-start' }}>
            {project.lat && project.lng ? (
              <>
              {showMapFull && <div onClick={() => setShowMapFull(false)} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(30,30,30,0.88)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}/>}
              <div style={{
                ...(showMapFull ? { position: 'fixed', top: 'env(safe-area-inset-top, 50px)', left: 0, width: '100vw', height: 'calc(100vh - env(safe-area-inset-top, 50px))', zIndex: 51, overflow: 'hidden' } : { position: 'relative', overflow: 'hidden', flex: 1 }),
                clipPath: mapRevealed || showMapFull ? 'inset(0 0% 0 0)' : 'inset(0 100% 0 0)',
                WebkitClipPath: mapRevealed || showMapFull ? 'inset(0 0% 0 0)' : 'inset(0 100% 0 0)',
                transition: 'clip-path 1.2s cubic-bezier(0.25, 0.1, 0.25, 1), -webkit-clip-path 1.2s cubic-bezier(0.25, 0.1, 0.25, 1)'
              }}>
                {/* Sun time slider - new design */}
                {(() => {
                  // Slider scale: 75% on mobile
                  const S = isMobile ? 0.75 : 1;
                  const filetTop = Math.round(88 * S);
                  const blurH = Math.round(130 * S);
                  const gradH = Math.round(140 * S);
                  const glowSize = Math.round(250 * S);
                  const hourSize = Math.round(24 * S);
                  const dateSize = Math.round(20 * S);
                  const triW = Math.round(12 * S);
                  const triH = Math.round(8 * S);
                  // Compute sun times for glow color and triangles
                  const eLat = adjustedPos?.lat ?? project?.lat;
                  const eLng = adjustedPos?.lng ?? project?.lng;
                  const st = (eLat && eLng && SunCalc) ? SunCalc.getTimes(sunDate, eLat, eLng) : null;
                  const srTime = st?.sunrise ? st.sunrise.getHours() + st.sunrise.getMinutes()/60 : 6;
                  const ssTime = st?.sunset ? st.sunset.getHours() + st.sunset.getMinutes()/60 : 18;
                  sunTimesSnapRef.current = { sr: srTime, ss: ssTime };
                  
                  // Dynamic slider range: sunrise at 20%, sunset at 80%.
                  // sliderRange = (ssTime - srTime) / 0.6 makes the day
                  // span 60% of the slider; sliderMin offsets so srTime
                  // falls exactly at 20% (and ssTime at 80%).
                  const sliderRange = (ssTime - srTime) / 0.6;
                  const sliderMin = srTime - 0.2 * sliderRange;
                  const sliderMax = sliderMin + sliderRange;

                  // Pre-compute terrain shadow segments across sunrise→sunset
                  const shadowSegments = (() => {
                    const profile = terrainProfileRef.current;
                    if (!profile || !eLat || !eLng || !SunCalc) return [];
                    const segments = [];
                    let inShadow = false;
                    let segStart = 0;
                    const step = 0.05; // ~3 min steps for precision
                    const baseDate = new Date(sunDate.getFullYear(), sunDate.getMonth(), sunDate.getDate());
                    const baseMs = baseDate.getTime();
                    for (let h = srTime; h <= ssTime + step; h += step) {
                      const hClamped = Math.min(h, ssTime);
                      const d = new Date(baseMs + hClamped * 3600000);
                      const sp = SunCalc.getPosition(d, eLat, eLng);
                      const bearing = (sp.azimuth * 180 / Math.PI + 180) % 360;
                      const altDeg = sp.altitude * 180 / Math.PI;
                      const shadow = isTerrainShadow(profile, bearing, altDeg);
                      if (shadow && !inShadow) { segStart = h; inShadow = true; }
                      else if (!shadow && inShadow) {
                        const startPct = ((segStart - sliderMin) / sliderRange) * 100;
                        const endPct = ((h - sliderMin) / sliderRange) * 100;
                        segments.push({ startPct, endPct });
                        inShadow = false;
                      }
                    }
                    if (inShadow) {
                      const startPct = ((segStart - sliderMin) / sliderRange) * 100;
                      const endPct = ((ssTime - sliderMin) / sliderRange) * 100;
                      segments.push({ startPct, endPct });
                    }
                    return segments;
                  })();

                  // Glow color logic: smooth morphing
                  const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
                  const hexLerp = (hex1, hex2, t) => {
                    const r1 = parseInt(hex1.slice(1,3),16), g1 = parseInt(hex1.slice(3,5),16), b1 = parseInt(hex1.slice(5,7),16);
                    const r2 = parseInt(hex2.slice(1,3),16), g2 = parseInt(hex2.slice(3,5),16), b2 = parseInt(hex2.slice(5,7),16);
                    const r = Math.round(lerp(r1,r2,t)), g = Math.round(lerp(g1,g2,t)), b = Math.round(lerp(b1,b2,t));
                    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
                  };
                  const DARK = '#003089', BLUE = '#1a66f3', ORANGE = '#ffc600', DAY = '#FFF3ba';
                  let glowColor = DAY;
                  // Relative to sunrise/sunset:
                  // sr-1h → sr-15min: blue | sr-15min → sr+15min: orange | then day
                  // ss-1h → ss+15min: orange | ss+15min → ss+1h: blue | then dark
                  const m = 0.25; // 15min morph
                  if (sunHourDisplay < srTime - 1 - m) {
                    glowColor = DARK;
                  } else if (sunHourDisplay < srTime - 1) {
                    glowColor = hexLerp(DARK, BLUE, (sunHourDisplay - (srTime - 1 - m)) / m);
                  } else if (sunHourDisplay < srTime - 0.25) {
                    glowColor = BLUE;
                  } else if (sunHourDisplay < srTime - 0.25 + m) {
                    glowColor = hexLerp(BLUE, ORANGE, (sunHourDisplay - (srTime - 0.25)) / m);
                  } else if (sunHourDisplay <= srTime + 0.25) {
                    glowColor = ORANGE;
                  } else if (sunHourDisplay < srTime + 0.25 + m) {
                    glowColor = hexLerp(ORANGE, DAY, (sunHourDisplay - (srTime + 0.25)) / m);
                  } else if (sunHourDisplay < ssTime - 1 - m) {
                    glowColor = DAY;
                  } else if (sunHourDisplay < ssTime - 1) {
                    glowColor = hexLerp(DAY, ORANGE, (sunHourDisplay - (ssTime - 1 - m)) / m);
                  } else if (sunHourDisplay <= ssTime + 0.25) {
                    glowColor = ORANGE;
                  } else if (sunHourDisplay < ssTime + 0.25 + m) {
                    glowColor = hexLerp(ORANGE, BLUE, (sunHourDisplay - (ssTime + 0.25)) / m);
                  } else if (sunHourDisplay < ssTime + 1) {
                    glowColor = BLUE;
                  } else if (sunHourDisplay < ssTime + 1 + m) {
                    glowColor = hexLerp(BLUE, DARK, (sunHourDisplay - (ssTime + 1)) / m);
                  } else {
                    glowColor = DARK;
                  }
                  
                  const thumbLeft = `${((sunHourDisplay - sliderMin) / sliderRange) * 100}%`;
                  // Lines stay at fixed 20% / 80%: the slider range
                  // computed above already maps srTime exactly to 20% and
                  // ssTime to 80%.
                  const srLeft = '20%';
                  const ssLeft = '80%';
                  
                  return (
                    <>
                    {/* Background blur + darken gradient */}
                    <div style={{ 
                      position: 'absolute', top: 0, left: 0, right: 0, height: `${blurH}px`, zIndex: 10,
                      background: 'linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.15) 75%, transparent 100%)',
                      backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
                      maskImage: 'linear-gradient(to bottom, black 0%, black 40%, transparent 100%)',
                      WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 40%, transparent 100%)',
                      pointerEvents: 'none'
                    }}/>
                    {/* Dark gradient overlay */}
                    <div style={{ 
                      position: 'absolute', top: 0, left: 0, right: 0, height: `${gradH}px`, zIndex: 10,
                      background: 'linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.4) 70%, transparent 100%)',
                      pointerEvents: 'none'
                    }}/>
                    {/* Weather particles overlay */}
                    {!isMobile && <canvas ref={weatherCanvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: `${gradH}px`, pointerEvents: 'none', zIndex: 11, opacity: 0.7,
                      maskImage: 'linear-gradient(to bottom, black 0%, black 50%, transparent 100%)',
                      WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 50%, transparent 100%)' }}/>}
                    {/* Full-width filet at 172px */}
                    <div style={{ position: 'absolute', top: `${filetTop}px`, left: 0, right: 0, height: '1px', background: 'rgba(255,255,255,0.5)', zIndex: 12 }}/>
                    {/* Vignette - dark base, softer, skip top */}
                    <div style={{
                      position: 'absolute', inset: 0, zIndex: 4, pointerEvents: 'none',
                      background: 'radial-gradient(ellipse 75% 70% at 50% 55%, transparent 35%, rgba(0,0,0,0.20) 50%, rgba(0,0,0,0.45) 70%, rgba(0,0,0,0.65) 90%, rgba(0,0,0,0.80) 100%)',
                      mixBlendMode: 'multiply',
                      maskImage: 'linear-gradient(to bottom, transparent 0%, black 15%)',
                      WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 15%)'
                    }}/>
                    {/* Blue night tint */}
                    {(() => {
                      const h = sunHourDisplay;
                      let nightAmt = 0;
                      if (h < srTime - 0.25) nightAmt = 1;
                      else if (h < srTime) nightAmt = (srTime - h) / 0.25;
                      else if (h > ssTime + 0.25) nightAmt = 1;
                      else if (h > ssTime) nightAmt = (h - ssTime) / 0.25;
                      else nightAmt = 0;
                      if (nightAmt <= 0) return null;
                      return <div style={{
                        position: 'absolute', inset: 0, zIndex: 3, pointerEvents: 'none',
                        background: `rgba(10, 20, 60, ${0.25 * nightAmt})`
                      }}/>;
                    })()}
                    {/* Slider content layer */}
                    <div style={{ 
                      position: 'absolute', top: 0, left: 0, right: 0, height: `${filetTop}px`, zIndex: 11,
                      pointerEvents: 'none'
                    }}>
                      
                      {/* Slider track area: centered vertically in 172px zone */}
                      {isMobile && <div
                        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'auto', zIndex: 3, touchAction: 'none', padding: '0 16px' }}
                        onTouchStart={e => {
                          e.preventDefault();
                          const rect = e.currentTarget.getBoundingClientRect();
                          const pad = 16;
                          const pct = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left - pad) / (rect.width - pad * 2)));
                          setSunHour(magneticSunHour(sliderMin + pct * sliderRange));
                        }}
                        onTouchMove={e => {
                          e.preventDefault();
                          const rect = e.currentTarget.getBoundingClientRect();
                          const pad = 16;
                          const pct = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left - pad) / (rect.width - pad * 2)));
                          setSunHour(magneticSunHour(sliderMin + pct * sliderRange));
                        }}
                      />}
                      {/* z:1 (back): glow + wisps */}
                      <div style={{
                        position: 'absolute',
                        top: '50%',
                        left: thumbLeft,
                        transform: 'translate(-50%, -50%)',
                        width: `${glowSize}px`, height: `${glowSize}px`,
                        borderRadius: '50%',
                        background: `radial-gradient(circle, ${glowColor} 0%, ${glowColor} 24%, ${glowColor}80 45%, transparent 70%)`,
                        opacity: 0.3,
                        pointerEvents: 'none',
                        filter: 'blur(15px)',
                        zIndex: 1
                      }}/>
                      {/* Météo de l'heure du curseur à droite de la pastille: icône au-dessus, nuages et soleil direct en dessous
                          (ce que la 3D et les ombres simulent); même dessin que les cases de la météo horaire. */}
                      {sceneWeatherRow && (() => {
                        const h = sceneWeatherRow, tt = new Date(sceneTimeMs);
                        const night = !!(st?.sunrise && st?.sunset && (tt < st.sunrise || tt >= st.sunset));
                        const icon = getIconFromCloudcover(h.cloudcover, h.icon, night, h.sunFraction, h.cloudLow, h.smoke);
                        const sunPct = h.sunFraction != null ? Math.round(h.sunFraction * 100) : null;
                        const sunColor = sunPct == null ? '#6f7d7b' : sunPct >= 60 ? '#E9D27A' : sunPct >= 45 ? '#E4CB78' : sunPct >= 32 ? '#DBCD92' : sunPct >= 20 ? '#CFC8A4' : sunPct >= 10 ? '#C3BDAA' : '#A7A99C';
                        const pct = { fontSize: `${Math.round(16 * S)}px`, lineHeight: '1', letterSpacing: '0.04em', display: 'inline-flex', alignItems: 'center', gap: '4px' };
                        return (
                          <div style={{ position: 'absolute', top: '50%', left: thumbLeft, transform: 'translateY(-50%)', marginLeft: `${Math.round(26 * S)}px`, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: `${Math.round(7 * S)}px`, pointerEvents: 'none', zIndex: 5, whiteSpace: 'nowrap' }}>
                            <WeatherIcon type={icon} className={`w-10 h-10 ${night ? 'opacity-50' : ''}`}/>
                            <span className="font-bebas-bold" style={{ ...pct, color: '#ffffff' }}>
                              <svg width="12" height="12" viewBox="0 0 32 32" style={{ flexShrink: 0, position: 'relative', top: '-1.5px' }}><g fill="#8A9794"><circle cx="12" cy="18" r="6"/><circle cx="20" cy="16" r="7"/><rect x="8" y="18" width="15" height="6" rx="3"/></g></svg>
                              {h.cloudcover != null ? `${h.cloudcover}%` : '--'}
                            </span>
                            <span className="font-bebas-bold" style={{ ...pct, color: sunColor }}>
                              <svg width="11" height="11" viewBox="0 0 32 32" style={{ flexShrink: 0, position: 'relative', top: '-1.5px' }}><circle cx="16" cy="16" r="8" fill={sunColor}/></svg>
                              {sunPct != null ? `${sunPct}%` : '--'}
                            </span>
                          </div>
                        );
                      })()}
                      {!isMobile && <div style={{ position: 'absolute', top: '50%', left: thumbLeft, width: `${Math.round(300*S)}px`, height: `${Math.round(120*S)}px`, transform: 'translate(-50%, -50%)', pointerEvents: 'none', overflow: 'visible', zIndex: 1 }}>
                        <div style={{ position: 'absolute', top: '50%', left: '20%', width: '120px', height: '40px', borderRadius: '50%', background: `radial-gradient(ellipse, ${glowColor}30 0%, ${glowColor}10 50%, transparent 75%)`, filter: 'blur(12px)', animation: 'vaporDrift1 8s ease-in-out infinite', opacity: 0.6 }}/>
                        <div style={{ position: 'absolute', top: '50%', left: '60%', width: '90px', height: '35px', borderRadius: '50%', background: `radial-gradient(ellipse, ${glowColor}25 0%, ${glowColor}0c 50%, transparent 75%)`, filter: 'blur(10px)', animation: 'vaporDrift2 11s ease-in-out infinite', animationDelay: '-3s', opacity: 0.5 }}/>
                        <div style={{ position: 'absolute', top: '50%', left: '40%', width: '150px', height: '50px', borderRadius: '50%', background: `radial-gradient(ellipse, ${glowColor}20 0%, ${glowColor}08 50%, transparent 75%)`, filter: 'blur(14px)', animation: 'vaporDrift3 14s ease-in-out infinite', animationDelay: '-7s', opacity: 0.45 }}/>
                        <div style={{ position: 'absolute', top: '50%', left: '10%', width: '100px', height: '30px', borderRadius: '50%', background: `radial-gradient(ellipse, ${glowColor}28 0%, ${glowColor}0a 50%, transparent 75%)`, filter: 'blur(8px)', animation: 'vaporDrift1 6s ease-in-out infinite', animationDelay: '-2s', opacity: 0.4 }}/>
                        <div style={{ position: 'absolute', top: '50%', left: '70%', width: '130px', height: '45px', borderRadius: '50%', background: `radial-gradient(ellipse, ${glowColor}1a 0%, ${glowColor}08 50%, transparent 75%)`, filter: 'blur(16px)', animation: 'vaporDrift2 16s ease-in-out infinite', animationDelay: '-5s', opacity: 0.35 }}/>
                      </div>}
                      {/* z:4 (front): slider thumb */}
                      <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, transform: 'translateY(-50%)', zIndex: 4, padding: isMobile ? '0 16px' : 0 }}>
                        <input
                          type="range"
                          min={sliderMin} max={sliderMax} step="0.05"
                          value={sunHour}
                          onChange={e => setSunHour(magneticSunHour(parseFloat(e.target.value)))}
                          style={{
                            width: '100%', appearance: 'none', WebkitAppearance: 'none',
                            background: 'transparent', position: 'relative', zIndex: 2,
                            outline: 'none', cursor: 'pointer',
                            pointerEvents: isMobile ? 'none' : 'auto'
                          }}
                        />
                      </div>
                      {/* Time + date display below filet */}
                      <div style={{
                        position: 'absolute',
                        top: `${filetTop}px`,
                        marginTop: `${Math.round(10 * S)}px`,
                        left: `${((sunHourDisplay - sliderMin) / sliderRange) * 100}%`,
                        transform: 'translateX(-50%)',
                        pointerEvents: 'auto',
                        zIndex: 13,
                        display: 'flex', alignItems: 'baseline', gap: `${Math.round(8 * S)}px`,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap'
                      }} onClick={() => setShowDatePicker(p => !p)}>
                        <span className="font-bebas-bold" style={{ 
                          fontSize: `${hourSize}px`, color: '#ffffff', letterSpacing: '0.04em',
                          lineHeight: '1'
                        }}>
                          {`${Math.floor(sunHourDisplay)}H${String(Math.round((sunHourDisplay % 1) * 60)).padStart(2, '0')}`}
                        </span>
                        <span className="font-bebas-regular" style={{ 
                          fontSize: `${dateSize}px`, color: '#ffffff', letterSpacing: '0.04em',
                          lineHeight: '1'
                        }}>
                          {t('monthAbbrev')[sunDate.getMonth()]} {sunDate.getDate()}
                        </span>
                      </div>
                      {/* Terrain shadow alert: text top-left + red band on filet */}
                      {shadowSegments.length > 0 && showSunLines && <>
                        {/* Label top-left: only when slider is in shadow zone */}
                        {terrainShadow && <div style={{
                          position: 'absolute', top: `${Math.round(8 * S)}px`, left: 0, right: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: `${Math.round(6 * S)}px`,
                          pointerEvents: 'none', zIndex: 13, animation: 'fadeIn 1.5s ease'
                        }}>
                          <svg width={isMobile ? 16 : 18} height={isMobile ? 16 : 18} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                            <path d="M4 20L10 8l4 6 2-3 4 9H4z"/>
                          </svg>
                          <span className="font-bebas-book" style={{ fontSize: `${isMobile ? 12 : 14}px`, color: '#ffffff', letterSpacing: '0.15em', lineHeight: '1', marginTop: '7px' }}>
                            OMBRE TERRAIN POSSIBLE
                          </span>
                        </div>}
                        {/* Red band(s) on filet line: clamped between sunrise (20%) and sunset (80%) */}
                        {shadowSegments.map((seg, i) => {
                          const clampStart = Math.max(seg.startPct, 20);
                          const clampEnd = Math.min(seg.endPct, 80);
                          if (clampEnd <= clampStart) return null;
                          return <div key={i} style={{
                            position: 'absolute',
                            top: `${filetTop}px`,
                            left: `${clampStart}%`,
                            width: `${clampEnd - clampStart}%`,
                            height: '10px',
                            background: 'rgba(255, 40, 50, 0.7)',
                            pointerEvents: 'none',
                            zIndex: 12,
                            borderRadius: '2px'
                          }}/>;
                        })}
                      </>}
                      {/* Sunrise/Sunset vertical lines + triangles */}
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: `${filetTop + triH}px`, pointerEvents: 'none', zIndex: 10 }}>
                        {/* Sunrise vertical line */}
                        <div style={{ position: 'absolute', top: 0, bottom: `${triH}px`, left: srLeft, width: '1px', background: 'rgba(255,255,255,0.15)', transform: 'translateX(-0.5px)' }}/>
                        {/* Sunset vertical line */}
                        <div style={{ position: 'absolute', top: 0, bottom: `${triH}px`, left: ssLeft, width: '1px', background: 'rgba(255,255,255,0.15)', transform: 'translateX(-0.5px)' }}/>
                        {/* Sunrise ▲ - base on filet line, pointing UP */}
                        <div style={{ position: 'absolute', bottom: `${triH}px`, left: srLeft, transform: 'translate(-50%, 0)' }}>
                          <svg width={triW} height={triH} viewBox={`0 0 ${triW} ${triH}`}>
                            <path d={`M${triW*0.5},0 L${triW},${triH} Q${triW},${triH} ${triW*0.85},${triH} L${triW*0.15},${triH} Q0,${triH} 0,${triH} Z`} fill="#ffffff" strokeLinejoin="round" stroke="#ffffff" strokeWidth="0.5"/>
                          </svg>
                        </div>
                        {/* Sunset ▼ - base on filet line, pointing DOWN */}
                        <div style={{ position: 'absolute', bottom: `${triH}px`, left: ssLeft, transform: 'translate(-50%, 0)' }}>
                          <svg width={triW} height={triH} viewBox={`0 0 ${triW} ${triH}`}>
                            <path d={`M${triW*0.5},${triH} L${triW},0 Q${triW},0 ${triW*0.85},0 L${triW*0.15},0 Q0,0 0,0 Z`} fill="#ffffff" strokeLinejoin="round" stroke="#ffffff" strokeWidth="0.5"/>
                          </svg>
                        </div>
                      </div>
                    </div>
                    </>
                  );
                })()}
                {/* Map controls - stacked vertically with subtle border */}
                <div ref={mapContainerRef} className="detail-map-keep" style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, background: '#181b1e', filter: activeEngine === 'apple' ? 'none' : 'saturate(0.50)' }}/>
                {/* Vue 3D par-dessus la carte (la carte reste montée, avec son état): même curseur, même météo */}
                <Scene3D visible={view3d} lat={project?.lat} lng={project?.lng} buildings={buildings} orientation={project?.orientation} timeMs={sceneTimeMs} weatherRow={sceneWeatherRow} zoomRef={scene3dZoom}/>
                <canvas ref={flareCanvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 2 }}/>
                {nightOpacity > 0 && <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 3, background: `radial-gradient(ellipse at center, transparent 30%, rgba(0,0,15,${0.4 * nightOpacity}) 70%, rgba(0,0,15,${0.7 * nightOpacity}) 100%)`, transition: 'opacity 0.5s ease' }}/>}
                {/* Fixed center pin */}
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 5, pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'transparent', border: '4px solid #ffffff', boxShadow: '0 2px 8px rgba(0,0,0,0.5)' }}/>
                </div>
                {/* Sun/Moon dot: fixed to viewport, mutated via refs (no React re-render) */}
                <div ref={sunDotContainerRef} style={{ position: 'absolute', pointerEvents: 'none', zIndex: 4, display: 'none' }}>
                  <div ref={sunDotHaloRef} style={{ position: 'absolute', borderRadius: '50%', display: 'none' }}/>
                  <div ref={sunDotInnerRef} style={{ position: 'absolute', borderRadius: '50%' }}/>
                </div>
                {/* Update address button: visible only when map has been dragged */}
                {adjustedPos && (
                  <div style={{ position: 'absolute', bottom: `${isMobile ? 40 : 200}px`, left: '50%', transform: 'translateX(-50%)', zIndex: 15 }}>
                    <button onClick={async () => {
                      const pos = adjustedPos;
                      try {
                        const result = await reverseGeocode(pos.lat, pos.lng);
                        skipMapRecreateRef.current = true;
                        updateProject(project.id, { lat: pos.lat, lng: pos.lng, address: result.formattedAddress, mapZoom: mapZoom });
                        setAdjustedPos(null);
                        effectiveCenterRef.current = null;
                      } catch(e) {
                        skipMapRecreateRef.current = true;
                        updateProject(project.id, { lat: pos.lat, lng: pos.lng, address: pos.lat.toFixed(5) + ', ' + pos.lng.toFixed(5), mapZoom: mapZoom });
                        setAdjustedPos(null);
                        effectiveCenterRef.current = null;
                      }
                    }} style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
                      border: '1.5px solid rgba(255,255,255,0.3)', borderRadius: '20px',
                      padding: '8px 16px', cursor: 'pointer',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.4)'
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                      <span className="font-bebas-book" style={{ fontSize: '13px', color: '#ffffff', letterSpacing: '0.08em', lineHeight: '1', paddingTop: '2px' }}>{t('updateLocation')}</span>
                    </button>
                  </div>
                )}
                {/* Shape labels */}
                {buildings.length > 0 && (isMobile ? (
                  /* Mobile: simple labels top-left under filet */
                  <div style={{ position: 'absolute', top: `${Math.round(88 * 0.75) + 14}px`, left: '12px', zIndex: 13, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {buildings.map((b, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className="font-bebas-book" style={{ fontSize: '12px', color: '#fff', letterSpacing: '0.1em', lineHeight: '1' }}>{t('shape')} {i + 1}</span>
                        <button onClick={(e) => { e.stopPropagation(); deleteBuilding(i); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', display: 'flex', alignItems: 'center' }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  /* Desktop: original pill labels top-right */
                  <div style={{ position: 'absolute', top: '145px', right: '-2px', zIndex: 13, display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
                    {buildings.map((b, i) => {
                      const color = BUILDING_COLORS[i % BUILDING_COLORS.length];
                      const displayH = draggingHeight && draggingHeight.idx === i ? draggingHeight.currentH : b.height;
                      const pillOffsetY = draggingHeight && draggingHeight.idx === i ? draggingHeight.offsetY : 0;
                      const isDragging = draggingHeight && draggingHeight.idx === i;
                      const hexToRgba = (hex, a) => { const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16); return `rgba(${r},${g},${b},${a})`; };
                      return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0px', position: 'relative', zIndex: isDragging ? 20 : 1 }}
                        onMouseEnter={() => setHoveredBuilding(i)} onMouseLeave={() => setHoveredBuilding(null)}>
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: '0px',
                          background: hexToRgba(color, 0.25), borderRadius: '16px', padding: '2px 3px 2px 6px',
                          whiteSpace: 'nowrap', boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
                          opacity: (hoveredBuilding !== null && hoveredBuilding !== i) ? 0.15 : 1,
                          transition: 'opacity 0.2s ease'
                        }}>
                          <div onClick={() => { setEditingBuilding(i); setBuildingHeight(String(b.height)); setBuildingName(b.name); }} style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: 'pointer', padding: '2px 6px 2px 0' }}>
                            <div style={{ width: '18px', height: '18px', borderRadius: '50%', background: color, flexShrink: 0 }}/>
                            <span className="font-bebas-bold" style={{ letterSpacing: '0.06em', fontSize: '17px', color: '#fff', lineHeight: '1', padding: '3px 0 0 0' }}>{t('shape')} {i + 1}</span>
                          </div>
                          {/* Couleur des murs (vue 3D): pastille cliquable, palette sobre en dessous */}
                          {view3d && <div onClick={(e) => { e.stopPropagation(); setWallPickFor(wallPickFor === i ? null : i); }} title={(WALL_COLORS.find(c => c[0] === (b.wallColor || '#7a3f33')) || [])[1]} style={{ width: '14px', height: '14px', borderRadius: '50%', background: b.wallColor || '#7a3f33', border: '1px solid rgba(255,255,255,0.7)', marginRight: '8px', cursor: 'pointer', flexShrink: 0 }}/>}
                          {view3d && wallPickFor === i && <div style={{ position: 'absolute', top: '100%', right: '0', marginTop: '6px', display: 'flex', gap: '6px', padding: '6px 8px', borderRadius: '14px', background: 'rgba(20,24,26,0.75)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', boxShadow: '0 2px 12px rgba(0,0,0,0.4)', zIndex: 30 }}>
                            {WALL_COLORS.map(([hex, name]) => <div key={hex} title={name} onClick={(e) => { e.stopPropagation(); setWallColor(i, hex); }} style={{ width: '16px', height: '16px', borderRadius: '50%', background: hex, border: (b.wallColor || '#7a3f33') === hex ? '2px solid #fff' : '1px solid rgba(255,255,255,0.35)', cursor: 'pointer', boxSizing: 'border-box' }}/>)}
                          </div>}
                          <div style={{ position: 'relative' }}>
                            {(hoveredBuilding === i || isDragging) && (<>
                              <div style={{ position: 'absolute', left: '50%', transform: `translateX(-50%) translateY(${pillOffsetY}px)`, top: '-13px', pointerEvents: 'none', opacity: isDragging ? 0.8 : 0.5, transition: isDragging ? 'none' : 'opacity 0.2s' }}>
                                <svg width="10" height="7" viewBox="0 0 10 7" fill="none"><path d="M2 7L5 1L8 7" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
                              </div>
                              <div style={{ position: 'absolute', left: '50%', transform: `translateX(-50%) translateY(${pillOffsetY}px)`, bottom: '-13px', pointerEvents: 'none', opacity: isDragging ? 0.8 : 0.5, transition: isDragging ? 'none' : 'opacity 0.2s' }}>
                                <svg width="10" height="7" viewBox="0 0 10 7" fill="none"><path d="M2 0L5 6L8 0" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
                              </div>
                            </>)}
                            <div style={{ background: '#fff', borderRadius: '13px', padding: '4px 8px 1px 8px', cursor: isDragging ? 'grabbing' : 'grab', userSelect: 'none', WebkitUserSelect: 'none', transform: `translateY(${pillOffsetY}px)`, transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)', boxShadow: '0 2px 8px rgba(0,0,0,0.25)', minWidth: '48px', textAlign: 'center' }}
                              onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setDraggingHeight({ idx: i, startY: e.clientY, startH: b.height, currentH: b.height, offsetY: 0 }); }}
                              onTouchStart={e => { e.stopPropagation(); const t = e.touches[0]; setDraggingHeight({ idx: i, startY: t.clientY, startH: b.height, currentH: b.height, offsetY: 0 }); }}>
                              <span className="font-bebas-bold" style={{ fontSize: '17px', color: '#000', letterSpacing: '0.04em', lineHeight: '1' }}>{displayH} M</span>
                            </div>
                          </div>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); deleteBuilding(i); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', marginLeft: '4px', opacity: hoveredBuilding === i ? 1 : 0, transition: 'opacity 0.2s ease', pointerEvents: hoveredBuilding === i ? 'auto' : 'none' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,100,100,0.8)" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      </div>);
                    })}
                  </div>
                ))}
                {/* Controls pill + Zoom pill wrapper */}
                {/* Mobile: small round pill top-right, opens menu on click */}
                {isMobile && <>
                    {/* Small trigger pill */}
                    {/* Small trigger pill: hidden when menu open */}
                    {!mapMenuOpen && <div onClick={() => setMapMenuOpen(true)} style={{
                      position: 'absolute', top: `${Math.round(88 * 0.75) + 21}px`, right: '12px', zIndex: 14,
                      backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
                      borderRadius: '14px', border: '1.5px solid rgba(255,255,255,0.7)',
                      padding: '4px 10px', cursor: 'pointer'
                    }}>
                      <span className="font-bebas-bold" style={{ fontSize: '12px', color: 'rgba(255,255,255,0.9)', letterSpacing: '0.04em' }}>
                        {view3d ? '3D' : mapType === 'sat2' ? 'SAT2' : 'SAT'}
                      </span>
                    </div>}
                    {/* Expanded menu */}
                    {mapMenuOpen && <div style={{
                      position: 'absolute', top: `${Math.round(88 * 0.75) + 21}px`, right: '12px', zIndex: 15,
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                      backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
                      borderRadius: '20px', border: '1.5px solid rgba(255,255,255,0.7)',
                      padding: '6px 2px', gap: '0px', width: '38px', boxSizing: 'border-box'
                    }}>
                      <button onClick={() => { setMapType('hybrid'); setView3d(false); setMapMenuOpen(false); }} className="font-bebas-bold pill-btn" style={{ letterSpacing: '0.04em', fontSize: '13px', padding: '4px 8px', lineHeight: '1.2', background: 'transparent', color: 'rgba(255,255,255,0.9)', border: 'none', cursor: 'pointer', textShadow: mapType === 'hybrid' && !view3d ? '0 0 10px rgba(255,255,255,0.7)' : 'none' }}>SAT</button>
                      {AppleSat.appleSatAvailable() && <button onClick={() => { setMapType('sat2'); setView3d(false); setMapMenuOpen(false); }} className="font-bebas-bold pill-btn" style={{ letterSpacing: '0.04em', fontSize: '13px', padding: '4px 8px', lineHeight: '1.2', background: 'transparent', color: 'rgba(255,255,255,0.9)', border: 'none', cursor: 'pointer', textShadow: mapType === 'sat2' && !view3d ? '0 0 10px rgba(255,255,255,0.7)' : 'none' }}>SAT2</button>}
                      <button onClick={() => { setView3d(true); setMapMenuOpen(false); }} className="font-bebas-bold pill-btn" style={{ letterSpacing: '0.04em', fontSize: '13px', padding: '4px 8px', lineHeight: '1.2', background: 'transparent', color: 'rgba(255,255,255,0.9)', border: 'none', cursor: 'pointer', textShadow: view3d ? '0 0 10px rgba(255,255,255,0.7)' : 'none' }}>3D</button>
                      <button onClick={() => { setView3d(false); if (drawingMode) { drawingVerticesRef.current = []; setDrawingVertices([]); setDrawingMode(false); } else { drawingVerticesRef.current = []; setDrawingVertices([]); setDrawingMode(true); setEditingBuilding(null); } setMapMenuOpen(false); }} className="pill-btn" style={{ background: 'transparent', border: 'none', borderRadius: '50%', cursor: 'pointer', padding: '5px', color: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', filter: drawingMode ? 'drop-shadow(0 0 6px rgba(255,255,255,0.6))' : 'none' }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                      </button>
                      <button onClick={() => { setShowSunLines(v => !v); setMapMenuOpen(false); }} className="pill-btn" style={{ background: 'transparent', border: 'none', borderRadius: '50%', cursor: 'pointer', padding: '5px', color: showSunLines ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', filter: showSunLines ? 'drop-shadow(0 0 6px rgba(255,255,255,0.6))' : 'none' }}>
                        {showSunLines ? (
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        ) : (
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        )}
                      </button>
                      <button onClick={() => { setShowMapFull(f => !f); setMapMenuOpen(false); }} className="pill-btn" style={{ background: 'transparent', border: 'none', borderRadius: '50%', cursor: 'pointer', padding: '5px', color: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', filter: showMapFull ? 'drop-shadow(0 0 6px rgba(255,255,255,0.6))' : 'none' }}>
                        {showMapFull ? (
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                        ) : (
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                        )}
                      </button>
                    </div>}
                </>}
                {/* Desktop: original vertical pill */}
                {!isMobile && <div style={{ position: 'absolute', top: '70%', transform: 'translateY(-50%)', right: '12px', zIndex: 13, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '35px' }}>
                  <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
                    borderRadius: '28px',
                    border: '2px solid rgba(255,255,255,0.9)',
                    padding: '10px 2px', gap: '2px',
                    width: '44px', boxSizing: 'border-box'
                  }}>
                    <button onClick={() => { setMapType('hybrid'); setView3d(false); }} className="font-bebas-bold pill-btn" style={{ letterSpacing: '0.04em', fontSize: '17px', padding: '6px 12px', lineHeight: '1.2', background: 'transparent', color: 'rgba(255,255,255,0.9)', border: 'none', cursor: 'pointer', textShadow: mapType === 'hybrid' && !view3d ? '0 0 10px rgba(255,255,255,0.7), 0 0 20px rgba(255,255,255,0.3)' : 'none', transition: 'text-shadow 0.3s ease, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>SAT</button>
                    {AppleSat.appleSatAvailable() && <button onClick={() => { setMapType('sat2'); setView3d(false); }} className="font-bebas-bold pill-btn" style={{ letterSpacing: '0.04em', fontSize: '17px', padding: '6px 12px', lineHeight: '1.2', background: 'transparent', color: 'rgba(255,255,255,0.9)', border: 'none', cursor: 'pointer', textShadow: mapType === 'sat2' && !view3d ? '0 0 10px rgba(255,255,255,0.7), 0 0 20px rgba(255,255,255,0.3)' : 'none', transition: 'text-shadow 0.3s ease, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>SAT2</button>}
                    <button onClick={() => setView3d(true)} className="font-bebas-bold pill-btn" style={{ letterSpacing: '0.04em', fontSize: '17px', padding: '6px 12px', lineHeight: '1.2', background: 'transparent', color: 'rgba(255,255,255,0.9)', border: 'none', cursor: 'pointer', textShadow: view3d ? '0 0 10px rgba(255,255,255,0.7), 0 0 20px rgba(255,255,255,0.3)' : 'none', transition: 'text-shadow 0.3s ease, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>3D</button>
                    <button onClick={() => { setView3d(false); if (drawingMode) { drawingVerticesRef.current = []; setDrawingVertices([]); setDrawingMode(false); } else { drawingVerticesRef.current = []; setDrawingVertices([]); setDrawingMode(true); setEditingBuilding(null); } }} className="pill-btn" style={{ background: 'transparent', border: 'none', borderRadius: '50%', cursor: 'pointer', padding: '8px', marginTop: '2px', color: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', filter: drawingMode ? 'drop-shadow(0 0 6px rgba(255,255,255,0.6))' : 'none', transition: 'filter 0.3s ease, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                    </button>
                    <button onClick={() => setShowSunLines(v => !v)} className="pill-btn" style={{ background: 'transparent', border: 'none', borderRadius: '50%', cursor: 'pointer', padding: '8px', color: showSunLines ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', filter: showSunLines ? 'drop-shadow(0 0 6px rgba(255,255,255,0.6))' : 'none', transition: 'filter 0.3s ease, color 0.3s ease, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
                      {showSunLines ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      )}
                    </button>
                    <button className="pill-btn" onClick={() => setShowMapFull(f => !f)} style={{ background: 'transparent', border: 'none', borderRadius: '50%', cursor: 'pointer', padding: '8px', color: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', filter: showMapFull ? 'drop-shadow(0 0 6px rgba(255,255,255,0.6))' : 'none', transition: 'filter 0.3s ease, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
                      {showMapFull ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                      )}
                    </button>
                  </div>
                  {/* Zoom pill */}
                  {!isMobile && (
                    <div style={{ 
                      position: 'relative',
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                      background: 'rgba(255,255,255,0.92)', 
                      borderRadius: '24px', 
                      width: '36px', boxSizing: 'border-box',
                      padding: '16px 0 4px 0'
                    }}>
                      <span className="font-bebas-book"
                        style={{ width: '100%', height: '28px',
                          color: '#333', fontSize: '50px', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
                        }}>+</span>
                      <span className="font-bebas-book"
                        style={{ width: '100%', height: '28px',
                          color: '#333', fontSize: '50px', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
                        }}>−</span>
                      {/* Invisible 50/50 click overlays */}
                      <button onClick={() => { if (view3d) { if (scene3dZoom.current) scene3dZoom.current(1 / 1.4); return; } const m = mapInstanceRef.current; if (m) m.setZoom(m.getZoom() + 1); }}
                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '50%', background: 'transparent', border: 'none', cursor: 'pointer' }}/>
                      <button onClick={() => { if (view3d) { if (scene3dZoom.current) scene3dZoom.current(1.4); return; } const m = mapInstanceRef.current; if (m) m.setZoom(m.getZoom() - 1); }}
                        style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '50%', background: 'transparent', border: 'none', cursor: 'pointer' }}/>
                    </div>
                  )}
                </div>}
                {/* Échelle de la carte (pas en 3D: la perspective n'a pas d'échelle fixe, et elle chevauchait la boussole) */}
                {!view3d && (() => {
                  const lat = adjustedPos?.lat ?? project?.lat ?? 45;
                  const mPerPx = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, mapZoom);
                  const targetPx = 100;
                  const targetM = targetPx * mPerPx;
                  const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
                  const best = nice.reduce((a, b) => Math.abs(b - targetM) < Math.abs(a - targetM) ? b : a);
                  const barPx = Math.round(best / mPerPx);
                  const label = best >= 1000 ? (best / 1000) + ' km' : best + ' m';
                  return (
                    <div style={{ position: 'absolute', bottom: '14px', right: '10px', zIndex: 13, pointerEvents: 'none', display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                        <span className="font-bebas-bold" style={{ fontSize: '12px', color: '#ffffff', letterSpacing: '0.06em', textShadow: '0 1px 3px rgba(0,0,0,0.8)', marginBottom: '2px' }}>{label}</span>
                        <div style={{ width: barPx + 'px', height: '2px', background: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.6)', position: 'relative' }}>
                          <div style={{ position: 'absolute', left: 0, top: '-3px', width: '2px', height: '8px', background: '#ffffff' }}/>
                          <div style={{ position: 'absolute', right: 0, top: '-3px', width: '2px', height: '8px', background: '#ffffff' }}/>
                        </div>
                      </div>
                    </div>
                  );
                })()}
                {/* Drawing mode hint: near the polygon */}
                {drawingMode && (
                  <div style={{ position: 'absolute', 
                    bottom: '14px', left: '50%', transform: 'translateX(-50%)',
                    zIndex: 13, 
                    background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', borderRadius: '8px', padding: '6px 14px',
                    display: 'flex', alignItems: 'center', gap: '10px'
                  }}>
                    <span className="font-bebas-bold" style={{ fontSize: '14px', color: '#7dd3c6', letterSpacing: '0.04em' }}>
                      {drawingVertices.length === 0 ? 'CLIQUER POUR PLACER LE PREMIER POINT' : 
                       drawingVertices.length < 3 ? `${drawingVertices.length} POINT${drawingVertices.length > 1 ? 'S' : ''} | CONTINUEZ` :
                       `${drawingVertices.length} POINTS`}
                    </span>
                    {drawingVertices.length >= 3 && (
                      <button onClick={() => finishDrawing()} className="font-bebas-bold"
                        style={{ background: 'rgba(125,211,198,0.3)', border: '1px solid rgba(125,211,198,0.5)', borderRadius: '4px', cursor: 'pointer', padding: '2px 10px', color: '#7dd3c6', fontSize: '14px', letterSpacing: '0.04em' }}>OK</button>
                    )}
                    <button onClick={() => { drawingVerticesRef.current = []; setDrawingVertices([]); setDrawingMode(false); }} className="font-bebas-regular"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'rgba(255,255,255,0.4)', fontSize: '14px' }}>✕</button>
                  </div>
                )}
                {/* Date wheel picker */}
                {showDatePicker && <DateWheelPicker date={sunDate} onChange={setSunDate} onClose={() => setShowDatePicker(false)} />}
                {/* Position auto-updates on map pan: no button needed */}
              </div>
              </>
            ) : (
              <div style={{ width: '100%', flex: 1, minHeight: '500px', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="text-charcoal-muted font-bebas-book" style={{ letterSpacing: '0.04em', fontSize: '18px' }}>{t('noAddress')}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Fichiers */}
      <div className={`${isMobile ? 'px-4' : 'px-8 md:px-12'} mt-6`} style={{ maxWidth: isMobile ? '100%' : '700px' }}>
        <label className="font-bebas-book text-charcoal-muted" style={{ letterSpacing: '0.04em', fontSize: '22px' }}>{t('files')}</label>
        {projectFiles.length > 0 && <span className="font-bebas-light" style={{ fontSize: '14px', color: '#404A48', letterSpacing: '0.04em', marginLeft: '12px' }}>{totalFilesMB.toFixed(1)} / {MAX_PROJECT_FILES_MB} MB</span>}

        {/* Upload zone: desktop only, before files */}
        {!isMobile && project?.status !== 'done' && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFileUpload(e.dataTransfer.files); }}
            onClick={() => fileInputRef.current?.click()}
            style={{
              borderStyle: 'dashed', borderWidth: '2.5px', borderColor: dragOver ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.15)',
              borderRadius: '8px',
              padding: '18px 12px', cursor: 'pointer', marginTop: '10px', minHeight: '60px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px',
              background: dragOver ? 'rgba(255,255,255,0.03)' : 'transparent',
              boxShadow: dragOver ? '0 0 12px rgba(255,255,255,0.08), inset 0 0 12px rgba(255,255,255,0.03)' : 'none',
              transition: 'all 0.25s ease'
            }}
          >
            <input ref={fileInputRef} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.heic,.pdf" style={{ display: 'none' }}
              onChange={(e) => { handleFileUpload(e.target.files); e.target.value = ''; }}
            />
            <span className="text-charcoal" style={{ fontSize: '15px', color: uploading ? '#7dd3c6' : 'rgba(255,255,255,0.4)' }}>
              {uploading ? `Téléversement... ${uploadProgress}%` : 'Glisser ou cliquer pour ajouter...'}
            </span>
            {uploading && (
              <div style={{ width: '80%', height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div style={{ width: `${uploadProgress}%`, height: '100%', background: '#7dd3c6', borderRadius: '2px', transition: 'width 0.3s ease' }}/>
              </div>
            )}
          </div>
        )}

        {/* Files list: below upload zone */}
        {projectFiles.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '12px' }}>
            {projectFiles.map(f => {
              const isPdf = f.mime_type === 'application/pdf' || f.filename.toLowerCase().endsWith('.pdf');
              const ext = f.filename.split('.').pop().toUpperCase();
              const sizeMB = (f.size_bytes / (1024 * 1024)).toFixed(1);
              const url = fileUrls[f.id];
              return (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 12px', borderRadius: '6px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', transition: 'background 0.15s' }}
                  onClick={() => { if (url) { if (isMobile) { setPreviewFile(f); } else { const tmp = document.createElement('a'); tmp.href = url; tmp.target = '_blank'; tmp.rel = 'noopener noreferrer'; document.body.appendChild(tmp); tmp.click(); tmp.remove(); } } }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                >
                  {isPdf ? (
                    <div style={{ width: '88px', height: '88px', borderRadius: '6px', background: 'rgba(232,150,122,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span className="font-bebas-bold" style={{ fontSize: '22px', color: '#e8967a', letterSpacing: '0.04em', position: 'relative', top: '1px' }}>PDF</span>
                    </div>
                  ) : url ? (
                    <img src={url} alt={f.filename} style={{ width: '88px', height: '88px', borderRadius: '6px', objectFit: 'cover', background: 'rgba(255,255,255,0.04)', flexShrink: 0 }}/>
                  ) : (
                    <div style={{ width: '88px', height: '88px', borderRadius: '6px', background: 'rgba(125,211,198,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span className="font-bebas-bold" style={{ fontSize: '20px', color: '#7dd3c6', letterSpacing: '0.04em', position: 'relative', top: '1px' }}>{ext}</span>
                    </div>
                  )}
                  <span style={{ fontSize: '14px', color: '#c8d0ce', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.filename}</span>
                  <span style={{ fontSize: '11px', color: '#556462', flexShrink: 0 }}>{sizeMB} MB</span>
                  {!isMobile && (
                    <button onClick={(e) => { e.stopPropagation(); handleFileDelete(f); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', opacity: 0.5, transition: 'opacity 0.15s', flexShrink: 0 }}
                      onMouseEnter={e => e.currentTarget.style.opacity = 1}
                      onMouseLeave={e => e.currentTarget.style.opacity = 0.5}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF3B30" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {projectFiles.length === 0 && isMobile && (
          <div style={{ border: '1px dashed rgba(255,255,255,0.15)', padding: '18px 12px', marginTop: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60px' }}>
            <span style={{ fontSize: '15px', color: 'rgba(255,255,255,0.4)' }}>Aucun fichier</span>
          </div>
        )}
      </div>

      {/* File preview overlay */}
      {previewFile && (
        <div onClick={() => setPreviewFile(null)} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          {previewFile.mime_type === 'application/pdf' ? (
            <iframe src={fileUrls[previewFile.id]} style={{ width: '90%', height: '90%', border: 'none', borderRadius: '8px' }}/>
          ) : (
            <img src={fileUrls[previewFile.id]} style={{ maxWidth: '95%', maxHeight: '95%', objectFit: 'contain', borderRadius: '8px' }} alt={previewFile.filename}/>
          )}
        </div>
      )}

      {/* Actions en bas */}
      <div className={`${isMobile ? 'px-4' : 'px-8 md:px-12'} mt-8 pt-4 border-t border-adaptive flex items-center ${isMobile ? 'justify-between' : 'gap-8'}`}>
        <button onClick={onClose} className="text-charcoal-muted hover:text-charcoal transition-colors" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div className={`flex items-center ${isMobile ? 'gap-6' : 'gap-8'}`} style={isMobile ? {} : { marginLeft: '80px' }}>
          {project.status === 'todo' && (
            <button onClick={() => updateProject(project.id, { onHold: !project.onHold })} className="font-bebas-bold text-xl" style={{ letterSpacing: '0.04em', background: 'none', border: 'none', cursor: 'pointer', color: project.onHold ? '#7dd3c6' : '#8B9B99', transition: 'text-shadow 0.2s, color 0.2s', textShadow: project.onHold ? '0 0 12px rgba(125,211,198,0.45), 0 0 30px rgba(125,211,198,0.15)' : 'none' }}
              onMouseEnter={e => { if (!project.onHold) { e.target.style.color = '#FAF9F7'; e.target.style.textShadow = '0 0 12px rgba(255,255,255,0.25), 0 0 30px rgba(255,255,255,0.1)'; }}}
              onMouseLeave={e => { if (!project.onHold) { e.target.style.color = '#8B9B99'; e.target.style.textShadow = 'none'; }}}
            >{t('onHold')}</button>
          )}
          {project.status === 'todo' && (
            <button onClick={handleDone} className="font-bebas-bold text-xl" style={{ letterSpacing: '0.04em', background: 'none', border: 'none', cursor: 'pointer', color: confirmDone ? '#d83152' : '#8B9B99', transition: 'text-shadow 0.2s, color 0.2s', textShadow: confirmDone ? '0 0 12px rgba(216,49,82,0.4), 0 0 30px rgba(216,49,82,0.15)' : 'none' }}
              onMouseEnter={e => { if (!confirmDone) { e.target.style.color = '#FAF9F7'; e.target.style.textShadow = '0 0 12px rgba(255,255,255,0.25), 0 0 30px rgba(255,255,255,0.1)'; }}}
              onMouseLeave={e => { if (!confirmDone) { e.target.style.color = '#8B9B99'; e.target.style.textShadow = 'none'; } else { e.target.style.color = '#d83152'; e.target.style.textShadow = '0 0 12px rgba(216,49,82,0.4), 0 0 30px rgba(216,49,82,0.15)'; }}}
            >{confirmDone ? t('moveToEditingConfirm') : t('moveToEditing')}</button>
          )}
          <button onClick={handleDelete} className="font-bebas-bold text-xl" style={{ letterSpacing: '0.04em', background: 'none', border: 'none', cursor: 'pointer', color: confirm ? '#d83152' : '#8B9B99', transition: 'text-shadow 0.2s, color 0.2s', textShadow: confirm ? '0 0 12px rgba(216,49,82,0.4), 0 0 30px rgba(216,49,82,0.15)' : 'none' }}
            onMouseEnter={e => { if (!confirm) { e.target.style.color = '#FAF9F7'; e.target.style.textShadow = '0 0 12px rgba(255,255,255,0.25), 0 0 30px rgba(255,255,255,0.1)'; }}}
            onMouseLeave={e => { if (!confirm) { e.target.style.color = '#8B9B99'; e.target.style.textShadow = 'none'; } else { e.target.style.color = '#d83152'; e.target.style.textShadow = '0 0 12px rgba(216,49,82,0.4), 0 0 30px rgba(216,49,82,0.15)'; }}}
          >{confirm ? t('deleteConfirm') : t('delete')}</button>
        </div>
        {!isMobile && <span className="ml-auto"/>}
      </div>
    </div>
  );
};
