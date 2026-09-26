import React, { useEffect, useState } from 'react';
import { isNative } from '../native/platform.js';
import { checkLocationPermission, getCurrentPosition } from '../native/geolocation.js';
import { useLang } from '../i18n/LangProvider.jsx';
import { reverseGeocode } from '../maps/google.js';
import { formatTime } from '../utils/dates.js';
import { fetchWeather } from '../weather/api.js';
import { cloudcoverToIcon, veilIcon } from '../weather/iconsLogic.js';
import { fetchKp } from '../weather/kp.js';
import { SMOKE_TINT, WeatherIcon } from './icons/WeatherIcon.jsx';

// ===== GEO WEATHER CARD (mobile) =====
// Maquette: _PSD/MeteoActuelleApp.PSD (capture iPhone à 3x, 1179 px de large). Toutes les cotes
// ci-dessous sont en px CSS (valeurs de la maquette divisées par 3), comptées depuis le haut de la
// zone sûre et le bord gauche de l'écran, pour une largeur de 393 px; `zoom` adapte l'ensemble aux
// autres largeurs. La carte est une bande qui défile horizontalement: la page « météo actuelle »
// (soleil, deux heures, vent) glisse vers la gauche et laisse apparaître les heures suivantes.
export const GEO_CARD_W = 393;
export const GEO_CARD_H = 182;
export const GEO_COL_W = 44;
// Courbe du soleil: cosinus surélevé, sommet en (101 ; 45,7), base à y=88,3, demi-largeur 76,7.
export const GEO_CURVE = { peakX: 101, peakY: 45.7, baseY: 88.3, half: 76.7 };
export const geoCurveY = (x) => {
  const d = Math.abs(x - GEO_CURVE.peakX);
  if (d >= GEO_CURVE.half) return GEO_CURVE.baseY;
  return GEO_CURVE.baseY - (GEO_CURVE.baseY - GEO_CURVE.peakY) * (1 + Math.cos(Math.PI * d / GEO_CURVE.half)) / 2;
};
export const GEO_CURVE_PATH = (() => {
  const x0 = GEO_CURVE.peakX - GEO_CURVE.half, x1 = GEO_CURVE.peakX + GEO_CURVE.half, n = 80;
  const pts = [];
  for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n; pts.push(`${x.toFixed(2)},${geoCurveY(x).toFixed(2)}`); }
  return 'M' + pts.join(' L');
})();
// Fondu des deux extrémités du trait (profil d'opacité relevé sur la maquette entre x=31 et x=177).
export const GEO_CURVE_FADE = [[0, 0], [0.046, 0.016], [0.091, 0.05], [0.137, 0.165], [0.183, 0.435], [0.228, 0.75], [0.274, 0.937], [0.32, 0.99], [0.365, 1], [0.594, 1], [0.639, 0.99], [0.685, 0.945], [0.731, 0.77], [0.776, 0.427], [0.822, 0.153], [0.868, 0.043], [0.913, 0.012], [0.959, 0.008], [1, 0]];
// La boule voyage du centre de l'heure de lever (x=53,7) au centre de l'heure de coucher (x=149,3).
export const GEO_BALL_X0 = 53.7, GEO_BALL_X1 = 149.3;
// Teinte du % de soleil direct: même échelle que la bande horaire du détail de projet.
export const geoSunTint = (pct) => pct == null ? '#6f7d7b' : pct >= 60 ? '#E9D27A' : pct >= 45 ? '#E4CB78' : pct >= 32 ? '#DBCD92' : pct >= 20 ? '#CFC8A4' : pct >= 10 ? '#C3BDAA' : '#A7A99C';

// Colonne d'une heure: heure, icône, % de nuages, % de soleil direct, aux tailles de la rangée météo du
// listing d'accueil (Bebas Bold 14 px, icône 32 px, pourcentages 14 px), sur 44 px de large (v633.120).
export const GeoHourColumn = ({ h, dailyMap }) => {
  const d = new Date(h.time);
  const hr = d.getHours();
  const sun = dailyMap[d.toDateString()];
  const srH = sun && sun.sunrise ? new Date(sun.sunrise).getHours() : null;
  const ssH = sun && sun.sunset ? new Date(sun.sunset).getHours() : null;
  const isNight = srH !== null && ssH !== null && (hr < srH || hr >= ssH);
  const icon = (h.icon === 'thunderstorm' || h.icon === 'snow' || h.icon === 'rain') ? h.icon
    : ((!isNight && veilIcon(h.cloudcover, h.cloudLow, h.sunFraction)) || cloudcoverToIcon(h.cloudcover, isNight));
  const sunPct = h.sunFraction != null ? Math.round(h.sunFraction * 100) : null;
  const sunColor = geoSunTint(sunPct);
  const tint = isNight ? 'rgba(250,249,247,0.05)' : (h.smoke ? SMOKE_TINT[h.smoke] : null);
  return (
    <div style={{ position: 'relative', width: GEO_COL_W, height: GEO_CARD_H, flexShrink: 0 }}>
      {tint && <div style={{ position: 'absolute', left: 0, right: 0, top: 46, height: 130, background: tint }}/>}
      <div className="flex flex-col items-center gap-0" style={{ position: 'absolute', left: 0, right: 0, top: 66, padding: '4px 0' }}>
        <span className="font-bebas-bold text-sm leading-none" style={{ color: '#8B9B99' }}>{hr}H</span>
        <WeatherIcon type={icon} className={`w-8 h-8 ${isNight ? 'opacity-50' : ''}`}/>
        <span className="font-bebas-bold text-sm leading-none text-charcoal" style={{ letterSpacing: '0.04em', marginTop: '4px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
          <svg width="10.5" height="10.5" viewBox="0 0 32 32" style={{ flexShrink: 0, position: 'relative', top: '-1.5px' }}><g fill="#8A9794"><circle cx="12" cy="18" r="6"/><circle cx="20" cy="16" r="7"/><rect x="8" y="18" width="15" height="6" rx="3"/></g></svg>
          {h.cloudcover != null ? `${h.cloudcover}%` : '--'}
        </span>
        <span className="font-bebas-bold text-sm leading-none" style={{ letterSpacing: '0.04em', marginTop: '4px', display: 'inline-flex', alignItems: 'center', gap: '3px', color: sunColor }}>
          <svg width="9.6" height="9.6" viewBox="0 0 32 32" style={{ flexShrink: 0, position: 'relative', top: '-1.5px' }}><circle cx="16" cy="16" r="8" fill={sunColor}/></svg>
          {sunPct != null ? `${sunPct}%` : '--'}
        </span>
      </div>
    </div>
  );
};

export const GeoWeatherCard = () => {
  const { t } = useLang();
  const [geoData, setGeoData] = useState(null);
  // Web: comportement inchangé (drapeau local). Natif: 'checking' le temps de lire la permission système.
  const [status, setStatus] = useState(() => isNative ? 'checking' : (localStorage.getItem('geo-permission') === 'granted' ? 'loading' : 'prompt'));
  // Indice Kp (activité géomagnétique), chargé une fois la météo affichée.
  const [kp, setKp] = useState(null);
  useEffect(() => {
    if (status !== 'done') return;
    let alive = true;
    fetchKp().then((v) => { if (alive) setKp(v); });
    return () => { alive = false; };
  }, [status]);
  // Tick à la minute: la boule suit l'heure courante sur la courbe.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNowMs(Date.now()), 60000); return () => clearInterval(id); }, []);
  // Largeur d'écran: la carte est dessinée pour 393 px et mise à l'échelle (zoom) sur les autres largeurs.
  const [vw, setVw] = useState(() => window.innerWidth || GEO_CARD_W);
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth || GEO_CARD_W);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const requestGeo = () => {
    setStatus('loading');
    getCurrentPosition({ enableHighAccuracy: false, timeout: 10000 }).then(
      async (pos) => {
        try {
          localStorage.setItem('geo-permission', 'granted');
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          let city = 'Ma position';
          try {
            const rgResult = await reverseGeocode(lat, lng);
            const comps = rgResult.results[0]?.address_components || [];
            const locality = comps.find(c => c.types.includes('locality'));
            const sublocality = comps.find(c => c.types.includes('sublocality'));
            const admin3 = comps.find(c => c.types.includes('administrative_area_level_3'));
            const best = locality || sublocality || admin3;
            if (best) city = best.long_name;
          } catch(e) { console.warn('Reverse geocode failed', e); }
          const weatherResult = await fetchWeather(lat, lng);
          const weather = weatherResult.data;
          const today = weather?.daily?.[0];
          if (!today) { setStatus('error'); return; }
          // Heures à venir: de l'heure courante à 24 h plus loin (deux visibles, le reste au défilement).
          const startOfHour = new Date();
          startOfHour.setMinutes(0, 0, 0);
          const allHours = weather.hourly || [];
          const firstIdx = allHours.findIndex(h => new Date(h.time).getTime() >= startOfHour.getTime());
          const hours = firstIdx >= 0 ? allHours.slice(firstIdx, firstIdx + 24) : [];
          const currentHourly = hours[0] || null;
          // Lever et coucher par date, pour griser les heures de nuit dans les colonnes.
          const dailyMap = {};
          (weather.daily || []).forEach(d => { if (d.sunrise) dailyMap[new Date(d.sunrise).toDateString()] = { sunrise: d.sunrise, sunset: d.sunset }; });
          setGeoData({ city, sunrise: today.sunrise, sunset: today.sunset, temp: currentHourly?.temp ?? null, wind: currentHourly?.wind ?? null, gust: currentHourly?.gust ?? null, hours, dailyMap });
          setStatus('done');
        } catch(e) { console.error('GeoWeather error', e); setStatus('error'); }
      },
      (err) => { if (err && err.code === 'unsupported') { setStatus('error'); return; } console.error('Geolocation denied', err); setStatus('denied'); }
    );
  };

  useEffect(() => {
    if (status === 'loading' && localStorage.getItem('geo-permission') === 'granted') requestGeo();
  }, []);
  // Natif (Capacitor): la permission « Lorsque l'app est active » déjà accordée est réutilisée sans
  // redemander; refusée: message d'aide; jamais demandée: bouton, comme sur le web.
  useEffect(() => {
    if (!isNative) return;
    let alive = true;
    checkLocationPermission().then((p) => {
      if (!alive) return;
      if (p === 'granted') requestGeo();
      else setStatus(p === 'denied' ? 'denied' : 'prompt');
    });
    return () => { alive = false; };
  }, []);

  if (status === 'prompt') return (
    <div style={{ margin: '0 12px', marginBottom: '15px', borderRadius: '37px', background: 'rgba(0,0,0,0.14)', overflow: 'hidden', padding: '24px 28px', textAlign: 'center' }}>
      <div className="font-bebas-bold" style={{ letterSpacing: '0.04em', fontSize: '15px', color: 'rgba(255,255,255,0.4)', marginBottom: '4px' }}>{t('currentLocationWeather')}</div>
      <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.25)', marginBottom: '14px' }}>{t(isNative ? 'browserLocationPermissionNative' : 'browserLocationPermission')}</div>
      <button onClick={requestGeo} className="font-bebas-bold" style={{ letterSpacing: '0.04em', background: 'none', border: '1.5px solid rgba(255,255,255,0.2)', borderRadius: '20px', color: '#FAF9F7', fontSize: '16px', padding: '8px 24px', cursor: 'pointer', textShadow: '0 0 12px rgba(255,255,255,0.3)' }}>{t('enableLocation')}</button>
    </div>
  );
  if (status === 'loading' || status === 'checking') return (
    <div style={{ margin: '0 12px', marginBottom: '35px', borderRadius: '37px', background: 'rgba(0,0,0,0.14)', overflow: 'hidden', padding: '24px 28px', textAlign: 'center' }}>
      <div className="font-bebas-bold" style={{ letterSpacing: '0.04em', fontSize: '13px', color: '#424a48' }}>Chargement météo...</div>
    </div>
  );
  if (status === 'denied') return (
    <div style={{ margin: '0 12px', marginBottom: '15px', borderRadius: '37px', background: 'rgba(0,0,0,0.14)', overflow: 'hidden', padding: '24px 28px', textAlign: 'center' }}>
      <div className="font-bebas-bold" style={{ letterSpacing: '0.04em', fontSize: '15px', color: 'rgba(255,255,255,0.4)', marginBottom: '4px' }}>{t('locationDenied')}</div>
      <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.25)', marginBottom: '14px' }}>{t(isNative ? 'locationHelpNative' : 'locationHelp')}</div>
      <button onClick={() => { localStorage.removeItem('geo-permission'); requestGeo(); }} className="font-bebas-bold" style={{ letterSpacing: '0.04em', background: 'none', border: '1.5px solid rgba(255,255,255,0.15)', borderRadius: '20px', color: 'rgba(255,255,255,0.5)', fontSize: '14px', padding: '6px 20px', cursor: 'pointer' }}>{t('retry')}</button>
    </div>
  );
  if (status === 'error' || !geoData) return null;

  // Position de la boule: fraction du jour écoulée entre le lever et le coucher; absente la nuit.
  const sunriseMs = geoData.sunrise ? new Date(geoData.sunrise).getTime() : null;
  const sunsetMs = geoData.sunset ? new Date(geoData.sunset).getTime() : null;
  const dayFrac = (sunriseMs != null && sunsetMs != null && sunsetMs > sunriseMs) ? (nowMs - sunriseMs) / (sunsetMs - sunriseMs) : null;
  const showBall = dayFrac !== null && dayFrac >= 0 && dayFrac <= 1;
  const ballX = showBall ? GEO_BALL_X0 + dayFrac * (GEO_BALL_X1 - GEO_BALL_X0) : 0;
  const ballY = showBall ? geoCurveY(ballX) : 0;
  const scale = vw >= 320 ? vw / GEO_CARD_W : 1;
  const hours = geoData.hours || [];
  const fmt2 = (v) => v == null ? '--' : String(v).padStart(2, '0');
  // Séparateurs verticaux: trait d'un tiers de px CSS (1 px physique à 3x) à 27 % de blanc, dessinés en SVG
  // pour une couverture exacte (un div de 0,34 px est arrondi par le navigateur et ressort plus lourd).
  const hairline = (x) => <rect x={x} y={46} width={1 / 3} height={130} fill="#ffffff" fillOpacity={0.27}/>;
  const labelStyle = { position: 'absolute', top: 83.07, fontSize: 12.62, letterSpacing: '0.1em', color: '#575E5E', lineHeight: 1, whiteSpace: 'nowrap' };
  const timeStyle = { position: 'absolute', top: 102.37, fontSize: 46.67, letterSpacing: 0, color: '#8D9898', lineHeight: 1, whiteSpace: 'nowrap' };
  // Bloc d'infos (vent, temp., rafale, Kp): cellules étiquette / valeur / unité avec la présentation standard
  // de l'appli (étiquette Bebas Bold 15 px, valeur Bebas Book 25 px blanche, unité 12 px), deux colonnes
  // centrées à x=334 et 372, à 8 px du séparateur (306,8) et du bord droit (v633.120).
  const cxA = 334, cxB = 372;
  const cellText = (cx, top, size, color) => ({ position: 'absolute', left: cx, top, transform: 'translateX(-50%)', lineHeight: 1, whiteSpace: 'nowrap', fontSize: size, letterSpacing: '0.04em', paddingLeft: '0.04em', color });
  const cell = (cx, top, label, value, unit) => (
    <React.Fragment>
      <span className="font-bebas-bold" style={cellText(cx, top, 15, 'rgba(255,255,255,0.35)')}>{label}</span>
      <span className="font-bebas-book" style={cellText(cx, top + 17, 25, '#ffffff')}>{value}</span>
      {unit && <span className="font-bebas-bold" style={cellText(cx, top + 44, 12, '#8B9B99')}>{unit}</span>}
    </React.Fragment>
  );
  // Marges négatives: la carte se cale sur le haut de la zone sûre (le conteneur ajoute 16 px) et
  // annule les 16 px de la liste en dessous; les 25 px de padding sont la respiration demandée (v633.118).
  return (
    <div style={{ position: 'relative', zIndex: 2, marginTop: '-16px', marginBottom: '-16px', paddingTop: 25, paddingBottom: 25, width: '100%', overflow: 'hidden' }}>
      <div style={{ zoom: scale, width: GEO_CARD_W, height: GEO_CARD_H }}>
        <div className="hour-scroll" style={{ width: GEO_CARD_W, height: GEO_CARD_H, overflowX: 'auto', overflowY: 'hidden' }}>
          <div style={{ display: 'flex', width: 'max-content', height: GEO_CARD_H }}>
            {/* Page « météo actuelle »: glisse vers la gauche au défilement. */}
            <div style={{ position: 'relative', width: GEO_CARD_W, height: GEO_CARD_H, flexShrink: 0 }}>
              <div className="font-bebas-book" style={{ position: 'absolute', left: 0, right: 0, top: 5.36, textAlign: 'center', fontSize: 18.73, letterSpacing: '0.2em', paddingLeft: '0.2em', color: '#ffffff', lineHeight: 1, whiteSpace: 'nowrap', textTransform: 'uppercase' }}>{geoData.city}</div>
              {/* Courbe du soleil, ton sur ton, extrémités fondues. */}
              <svg width={GEO_CARD_W} height={GEO_CARD_H} viewBox={`0 0 ${GEO_CARD_W} ${GEO_CARD_H}`} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
                <defs>
                  <linearGradient id="geoSunCurveFade" gradientUnits="userSpaceOnUse" x1="31" y1="0" x2="177" y2="0">
                    {GEO_CURVE_FADE.map(([o, a], i) => <stop key={i} offset={o} stopColor="#ffffff" stopOpacity={a}/>)}
                  </linearGradient>
                </defs>
                <path d={GEO_CURVE_PATH} fill="none" stroke="url(#geoSunCurveFade)" strokeWidth="1.33" strokeLinecap="round" opacity="0.27"/>
                {hairline(202.8)}
                {hairline(306.8)}
              </svg>
              {/* Boule du soleil (12 px, halo blanc doux), à la position de l'heure courante; absente la nuit. */}
              {showBall && <div style={{ position: 'absolute', left: ballX - 6, top: ballY - 6, width: 12, height: 12, borderRadius: '50%', background: '#9B9D9E', boxShadow: '0 0 11px 1.8px rgba(255,255,255,0.57)' }}/>}
              <span className="font-bebas-book" style={{ ...labelStyle, left: 34.3 }}>{t('sunrise')}</span>
              <span className="font-bebas-book" style={{ ...labelStyle, left: 130.3 }}>{t('sunset')}</span>
              <span className="font-bebas-book" style={{ ...timeStyle, left: 17.67 }}>{formatTime(geoData.sunrise)}</span>
              <span className="font-bebas-book" style={{ ...timeStyle, left: 113.67 }}>{formatTime(geoData.sunset)}</span>
              <div style={{ position: 'absolute', left: 210.8, top: 0, display: 'flex' }}>
                {hours.slice(0, 2).map(h => <GeoHourColumn key={h.time} h={h} dailyMap={geoData.dailyMap}/>)}
              </div>
              {cell(cxA, 51, t('wind'), fmt2(geoData.wind), t('kmh'))}
              {cell(cxB, 51, t('temp'), geoData.temp == null ? '--' : `${geoData.temp}°`, null)}
              {cell(cxA, 115, t('gust'), fmt2(geoData.gust), t('kmh'))}
              {cell(cxB, 115, t('kp'), kp == null ? '--' : String(kp), t('kp'))}
            </div>
            {/* Heures suivantes, révélées au défilement (même colonne, même séparateur). */}
            {hours.length > 2 && <svg width={8} height={GEO_CARD_H} viewBox={`0 0 8 ${GEO_CARD_H}`} style={{ flexShrink: 0, display: 'block' }}>{hairline(0)}</svg>}
            {hours.slice(2).map(h => <GeoHourColumn key={h.time} h={h} dailyMap={geoData.dailyMap}/>)}
            <div style={{ width: 14.25, flexShrink: 0 }}/>
          </div>
        </div>
      </div>
    </div>
  );
};
