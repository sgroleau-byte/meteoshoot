(() => {
  if (window.__bl) return;
  const P = '/tools/baseline/fixtures/';
  const getSync = (path) => { try { const x = new XMLHttpRequest(); x.open('GET', path + '?t=' + Math.random(), false); x.send(); return x.status === 200 ? x.responseText : null; } catch (e) { return null; } };
  const seed = JSON.parse(getSync(P + 'seed.json'));
  if (localStorage.getItem('bl-seeded') !== '1') {
    localStorage.clear();
    for (const [k, v] of Object.entries(seed.localStorage)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    localStorage.setItem('bl-seeded', '1');
  }
  const replayTxt = getSync(P + 'replay.json');
  let store, mode;
  if (replayTxt) { store = JSON.parse(replayTxt); mode = 'replay'; }
  else { store = JSON.parse(localStorage.getItem('bl-replay') || 'null') || { fixedNow: seed.fixedNow, entries: {} }; mode = 'record'; }
  const marks = {}; const longTasks = []; const misses = [];
  window.__bl = { mode, store, marks, longTasks, misses };
  const FIXED = store.fixedNow; const RealDate = Date;
  function FakeDate(...a) { if (!new.target) return new RealDate(FIXED).toString(); return a.length ? new RealDate(...a) : new RealDate(FIXED); }
  FakeDate.prototype = RealDate.prototype; Object.setPrototypeOf(FakeDate, RealDate); FakeDate.now = () => FIXED;
  window.Date = FakeDate;
  const FREEZE = /open-meteo\.com|geo\.weather\.gc\.ca|swpc\.noaa\.gov|open-elevation\.com|maps\.googleapis\.com\/maps\/api\//;
  const realFetch = window.fetch;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => !window.__blOffline });
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    if (window.__blOffline && (FREEZE.test(url) || /supabase\.co/.test(url))) throw new TypeError('Failed to fetch (simulation hors ligne)');
    if (!FREEZE.test(url)) return realFetch.apply(this, arguments);
    const hit = store.entries[url];
    if (hit) return new Response(hit.body, { status: hit.status, headers: { 'Content-Type': hit.ct } });
    if (mode === 'replay') misses.push(url);
    const res = await realFetch.apply(this, arguments);
    try {
      const body = await res.clone().text();
      store.entries[url] = { status: res.status, ct: res.headers.get('content-type') || 'application/json', body };
      if (mode === 'record') localStorage.setItem('bl-replay', JSON.stringify(store));
    } catch (e) {}
    return res;
  };
  const pos = { coords: { latitude: 46.8139, longitude: -71.2080, accuracy: 20 }, timestamp: FIXED };
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok) => setTimeout(() => ok(pos), 0), watchPosition: () => 1, clearWatch: () => {} } });
  const mo = new MutationObserver(() => {
    const now = performance.now();
    if (!marks.rootRendered) { const r = document.getElementById('root'); if (r && r.children.length) marks.rootRendered = now; }
    const sp = document.getElementById('splashScreen');
    if (!marks.splashHidden && sp && sp.classList.contains('splash-hidden')) marks.splashHidden = now;
    if (!marks.splashRemoved && !sp && marks.rootRendered) marks.splashRemoved = now;
    const n = document.querySelectorAll('.day-cell').length;
    if (n && !marks.firstDayCell) marks.firstDayCell = now;
    if (n !== marks.dayCells) { marks.dayCells = n; marks.lastDayCellChange = now; }
  });
  mo.observe(document, { childList: true, subtree: true });
  // Échantillonnage de la sortie du splash (halo, fond, logo) toutes les 100 ms pendant 5 s.
  window.__bl.halo = [];
  const hs = setInterval(() => {
    const sp = document.getElementById('splashScreen'); const wrap = document.querySelector('.splash-halo'); const wv = document.querySelector('.splash-flare'); const logo = document.querySelector('.splash-logo-area');
    const t = Math.round(performance.now());
    window.__bl.halo.push({ t, overlay: !!sp, bg: sp ? getComputedStyle(sp).backgroundColor : null, haloOpacity: wrap ? getComputedStyle(wrap).opacity : null, haloScale: wrap ? (getComputedStyle(wrap).transform.match(/matrix\(([^,]+)/) || [])[1] : null, logo: logo ? getComputedStyle(logo).opacity : null, hold: !!(document.getElementById('root') && document.getElementById('root').classList.contains('ms-hold')), card: (document.querySelector('[data-project-id]') ? getComputedStyle(document.querySelector('[data-project-id]')).opacity : null), nav: (document.querySelector('.ms-enter-nav') ? getComputedStyle(document.querySelector('.ms-enter-nav')).opacity : null), geo: (document.querySelector('.ms-enter-geo') ? getComputedStyle(document.querySelector('.ms-enter-geo')).opacity : null), overlayOpacity: sp ? getComputedStyle(sp).opacity : null, wave: wv ? (getComputedStyle(wv).transform.match(/matrix\(([^,]+)/) || [])[1] : null });
    if (t > 5000) clearInterval(hs);
  }, 100);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) longTasks.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) }); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
})();
