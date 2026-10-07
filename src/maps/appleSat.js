// Satellite Plans d'Apple pour le bouton SAT2 de la fiche projet.
//
// MapKit JS n'affiche que les images. Tout le reste (caméra, gestes, dessins) est tenu ici, derrière une petite
// interface calquée sur celle de Google Maps (Map, OverlayView, Polygon, Polyline, Marker, LatLng, event): les
// dessins de la fiche (soleil, ombres, bâtiments au crayon) tournent donc sans changement sur les deux cartes.
// La caméra est un centre et un zoom au sens de Google (monde de 256 px au zoom 0, projection de Mercator). Le
// rectangle visible est poussé à MapKit à chaque image et les projections suivent la même formule que Google:
// SAT et SAT2 s'alignent au pixel près.

// Table { nom d'hôte: jeton } injectée à la compilation (vite.config.js): un jeton par site autorisé chez Apple,
// plus « * » pour le serveur de développement.
const TOKENS = __APPLE_MAPS_TOKENS__;
export const APPLE_MAPS_TOKEN = TOKENS[window.location.hostname] || TOKENS['*'] || '';
export const appleSatAvailable = () => !!APPLE_MAPS_TOKEN;

const MAPKIT_SRC = 'https://cdn.apple-mapkit.com/mk/6/mapkit.core.js'; // version 6 (juin 2026), mises à jour mineures automatiques
const TILE = 256;
const MIN_ZOOM = 3;
const MAX_ZOOM = 21;

// ===== Chargement de MapKit JS (une fois, à la première ouverture de SAT2) =====
let loadPromise = null;
const errorHandlers = new Set();
export const onAppleMapsError = (fn) => { errorHandlers.add(fn); return () => errorHandlers.delete(fn); };

export function loadMapKit() {
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    if (!APPLE_MAPS_TOKEN) { reject(new Error('Jeton Plans absent')); return; }
    const init = () => {
      try {
        // Une seule initialisation par page (le module peut être réévalué en développement).
        if (window.__msMapKitInit) { resolve(window.mapkit); return; }
        window.__msMapKitInit = true;
        mapkit.init({ authorizationCallback: (done) => done(APPLE_MAPS_TOKEN), language: 'fr' });
        // Jeton refusé, domaine non autorisé ou quota atteint: la fiche revient sur SAT.
        mapkit.addEventListener('error', (e) => {
          console.warn('[SAT2] Plans a refusé le jeton:', e && e.status);
          errorHandlers.forEach((fn) => fn(e));
        });
        resolve(window.mapkit);
      } catch (err) { reject(err); }
    };
    // En version 6, lire mapkit.Map avant le chargement de sa bibliothèque lève une erreur, et le rappel arrive
    // aussi quand le chargement a échoué.
    const ready = () => { try { return !!(window.mapkit && window.mapkit.Map); } catch (e) { return false; } };
    if (ready()) { init(); return; }
    const cb = '__msMapKitReady';
    window[cb] = () => {
      delete window[cb];
      if (ready()) init();
      else { loadPromise = null; reject(new Error('MapKit JS: bibliothèque de carte non chargée')); }
    };
    const s = document.createElement('script');
    s.src = MAPKIT_SRC;
    s.crossOrigin = 'anonymous';
    s.async = true;
    s.dataset.callback = cb;
    s.dataset.libraries = 'map';
    s.onerror = () => { loadPromise = null; reject(new Error('MapKit JS introuvable')); };
    document.head.appendChild(s);
  });
  return loadPromise;
}

// ===== Géométrie (mêmes formules que Google) =====
const clampLat = (lat) => Math.max(-85.05112878, Math.min(85.05112878, lat));
const toWorld = (lat, lng) => {
  const s = Math.sin(clampLat(lat) * Math.PI / 180);
  return { x: (lng + 180) / 360, y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) };
};
const fromWorld = (x, y) => ({ lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI, lng: x * 360 - 180 });

export class LatLng {
  constructor(lat, lng) {
    if (lat && typeof lat === 'object') {
      lng = typeof lat.lng === 'function' ? lat.lng() : lat.lng;
      lat = typeof lat.lat === 'function' ? lat.lat() : lat.lat;
    }
    this._lat = lat;
    this._lng = lng;
  }
  lat() { return this._lat; }
  lng() { return this._lng; }
  toJSON() { return { lat: this._lat, lng: this._lng }; }
}
const toLL = (p) => (p instanceof LatLng ? p : new LatLng(p));

export class Point {
  constructor(x, y) { this.x = x; this.y = y; }
}

class LatLngBounds {
  constructor(sw, ne) { this._sw = sw; this._ne = ne; }
  getSouthWest() { return this._sw; }
  getNorthEast() { return this._ne; }
  getCenter() { return new LatLng((this._sw.lat() + this._ne.lat()) / 2, (this._sw.lng() + this._ne.lng()) / 2); }
  contains(p) {
    const q = toLL(p);
    return q.lat() >= this._sw.lat() && q.lat() <= this._ne.lat() && q.lng() >= this._sw.lng() && q.lng() <= this._ne.lng();
  }
}

export const SymbolPath = { CIRCLE: 'circle' };

// ===== Évènements =====
class Emitter {
  addListener(name, fn) {
    const all = this._listeners || (this._listeners = {});
    (all[name] || (all[name] = [])).push(fn);
    return { remove: () => { all[name] = (all[name] || []).filter((f) => f !== fn); } };
  }
  _emit(name, ...args) {
    const list = this._listeners && this._listeners[name];
    if (list) list.slice().forEach((fn) => fn(...args));
  }
}

export const event = {
  addListener: (obj, name, fn) => obj.addListener(name, fn),
  addListenerOnce: (obj, name, fn) => {
    const handle = obj.addListener(name, (...args) => { handle.remove(); fn(...args); });
    return handle;
  },
  removeListener: (handle) => { if (handle && handle.remove) handle.remove(); },
  trigger: (obj, name, ...args) => { if (obj && obj._emit) obj._emit(name, ...args); },
  clearInstanceListeners: (obj) => { if (obj) obj._listeners = {}; },
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag) => document.createElementNS(SVG_NS, tag);
const layer = (z) => {
  const d = document.createElement('div');
  d.style.cssText = `position:absolute;left:0;top:0;width:0;height:0;overflow:visible;z-index:${z}`;
  return d;
};

// ===== Carte =====
export class Map extends Emitter {
  constructor(el, opts = {}) {
    super();
    this._el = el;
    this._center = toLL(opts.center || { lat: 0, lng: 0 });
    this._zoom = opts.zoom != null ? opts.zoom : 18;
    this._zoomTarget = this._zoom;
    this._styles = opts.styles || [];
    this._gesture = opts.gestureHandling || 'greedy';
    this._cursor = null;
    this._overlays = new Set();
    this._shapes = new Set();
    this._raf = 0;
    this._lastClick = null;
    this._lastTouchEnd = 0;
    this._mouseDrag = null; // nettoyage du glisser à la souris en cours
    this._destroyed = false;
    this._maxZoom = MAX_ZOOM; // abaissé si les images d'Apple s'arrêtent plus tôt à cet endroit

    // Images d'Apple dessous, nos calques par-dessus. La désaturation de la fiche ne touche que les images
    // (classe ms-apple-sat, app.css): le logo Plans et le lien « Mentions légales » restent tels qu'Apple les
    // fournit, comme l'exige sa licence.
    this._mk = document.createElement('div');
    this._mk.className = 'ms-apple-sat';
    this._mk.style.cssText = 'position:absolute;inset:0;';
    this._root = document.createElement('div');
    this._root.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:1;';
    this._panes = {
      mapPane: layer(0),
      overlayLayer: layer(1),
      overlayShadow: layer(2),
      markerLayer: layer(4),
      overlayMouseTarget: layer(5),
      floatShadow: layer(6),
      floatPane: layer(7),
    };
    this._shapeSvg = svgEl('svg');
    this._markerSvg = svgEl('svg');
    [this._shapeSvg, this._markerSvg].forEach((s, i) => {
      s.setAttribute('style', `position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:${i ? 4 : 3}`);
    });
    const p = this._panes;
    this._root.append(p.mapPane, p.overlayLayer, p.overlayShadow, this._shapeSvg, this._markerSvg, p.markerLayer, p.overlayMouseTarget, p.floatShadow, p.floatPane);
    el.append(this._mk, this._root);
    this._applyGesture();

    this._measure();
    this._mkMap = new mapkit.Map(this._mk, {
      mapType: mapkit.MapType ? mapkit.MapType.Satellite : mapkit.Map.MapTypes.Satellite,
      showsCompass: mapkit.FeatureVisibility.Hidden,
      showsScale: mapkit.FeatureVisibility.Hidden,
      showsZoomControl: false,
      showsMapTypeControl: false,
      showsUserLocationControl: false,
      showsPointsOfInterest: false,
      isRotationEnabled: false,
      isScrollEnabled: false,
      isZoomEnabled: false,
    });
    this._projection = {
      fromLatLngToContainerPixel: (ll) => this._toPx(ll),
      fromLatLngToDivPixel: (ll) => this._toPx(ll),
      fromContainerPixelToLatLng: (pt) => this._toLL(pt.x, pt.y),
      fromDivPixelToLatLng: (pt) => this._toLL(pt.x, pt.y),
      getWorldWidth: () => this._scale(),
    };
    this._push();
    // La configuration d'Apple (zoom maximal des images) arrive après la création: on revérifie à chaque fin de
    // mouvement de MapKit.
    // On ne lit jamais la caméra laissée par MapKit: on lui renvoie notre rectangle, puis on vérifie sa réponse.
    this._onMkRegion = () => {
      if (this._destroyed || this._hidden) return;
      if (this._sizeDirty) { this._sizeDirty = false; clearTimeout(this._sizeTimer); }
      // Rien à faire si MapKit montre déjà notre rectangle (évite de se relancer soi-même).
      const got = this._mkMap.visibleMapRect;
      const want = this._rect();
      if (got && got.size && Math.abs(got.size.width - want.size.width) <= want.size.width * 1e-6
        && Math.abs(got.origin.x - want.origin.x) <= want.size.width * 1e-4
        && Math.abs(got.origin.y - want.origin.y) <= want.size.height * 1e-4) return;
      const before = this._zoom;
      this._push();
      if (this._zoom !== before) this._changed();
    };
    this._mkMap.addEventListener('region-change-end', this._onMkRegion);

    // Redimensionnement: MapKit prend la nouvelle taille un peu après nous. D'ici là, sa lecture est périmée (elle
    // ferait croire à des images plus courtes): pas de vérification du zoom maximal, qui repart du plafond.
    this._ro = new ResizeObserver(() => {
      this._measure();
      this._sizeDirty = true;
      this._maxZoom = MAX_ZOOM;
      clearTimeout(this._sizeTimer);
      this._sizeTimer = setTimeout(() => { this._sizeDirty = false; this._push(); }, 600);
      this._changed();
    });
    this._ro.observe(el);
    this._bind();
    this._initRaf = requestAnimationFrame(() => { this._changed(); this._emit('idle'); });
    // MapKit n'annonce pas la fin du chargement des tuiles: on laisse le temps au premier affichage.
    this._tilesTimer = setTimeout(() => this._emit('tilesloaded'), 450);
  }

  // --- Caméra ---
  _scale() { return TILE * Math.pow(2, this._zoom); }
  // Conteneur masqué (taille nulle): on garde la dernière taille connue et on ne pousse rien à MapKit.
  _measure() {
    const w = this._el.clientWidth, h = this._el.clientHeight;
    this._hidden = !w || !h;
    if (!this._hidden) { this._w = w; this._h = h; }
    else if (!this._w) { this._w = 1; this._h = 1; }
  }
  _world() { return toWorld(this._center.lat(), this._center.lng()); }
  _toPx(ll) {
    const p = toLL(ll);
    const w = toWorld(p.lat(), p.lng());
    const c = this._world();
    const s = this._scale();
    return new Point((w.x - c.x) * s + this._w / 2, (w.y - c.y) * s + this._h / 2);
  }
  _toLL(x, y) {
    const c = this._world();
    const s = this._scale();
    const g = fromWorld(c.x + (x - this._w / 2) / s, c.y + (y - this._h / 2) / s);
    return new LatLng(g.lat, g.lng);
  }
  _rect() {
    const c = this._world();
    const s = this._scale();
    return new mapkit.MapRect(c.x - this._w / 2 / s, c.y - this._h / 2 / s, this._w / s, this._h / s);
  }
  _push() {
    if (this._destroyed || this._hidden) return;
    this._mkMap.setVisibleMapRectAnimated(this._rect(), false);
    // Images plus courtes que le zoom demandé: MapKit s'arrête sans prévenir. On s'arrête au même palier, sinon
    // les dessins (à notre échelle) glisseraient par rapport aux images (à la sienne).
    if (this._clamp()) this._mkMap.setVisibleMapRectAnimated(this._rect(), false);
  }
  _clamp() {
    if (this._destroyed || this._hidden || this._sizeDirty) return false;
    const got = this._mkMap.visibleMapRect;
    if (!got || !got.size || !got.size.width || !got.size.height) return false;
    // Lecture fiable seulement si MapKit a la même forme que nous (sinon il travaille encore sur une ancienne taille).
    if (Math.abs(Math.log2((got.size.width / got.size.height) / (this._w / this._h))) > 0.01) return false;
    const eff = Math.log2(this._w / (TILE * got.size.width));
    if (eff >= this._zoom - 0.02) return false;
    this._maxZoom = Math.max(MIN_ZOOM, Math.floor(eff + 0.02));
    if (this._zoom <= this._maxZoom) return false;
    cancelAnimationFrame(this._raf);
    this._zoom = this._maxZoom;
    const was = this._zoomTarget;
    this._zoomTarget = Math.min(this._zoomTarget, this._maxZoom);
    if (was !== this._zoomTarget) { this._emit('zoom_changed'); this._idleSoon(); }
    return true;
  }
  _changed() {
    if (this._destroyed) return;
    this._push();
    this._overlays.forEach((o) => { try { o.draw(); } catch (e) { console.warn('[SAT2] dessin:', e); } });
    this._shapes.forEach((s) => s._render());
    this._emit('bounds_changed');
    this._emit('center_changed');
  }

  getCenter() { return this._center; }
  setCenter(ll) { this._center = toLL(ll); this._changed(); this._idleSoon(); }
  panTo(ll) { this.setCenter(ll); }
  getZoom() { return this._zoomTarget; }
  setZoom(z) {
    const target = Math.max(MIN_ZOOM, Math.min(this._maxZoom, Math.round(z)));
    if (target === this._zoomTarget) return;
    this._animateZoom(target, true);
  }
  // Animation du zoom vers un palier entier. emit: annoncer zoom_changed (non quand un pincement revient
  // simplement au palier où il avait commencé).
  _animateZoom(target, emit) {
    const from = this._zoom;
    const t0 = performance.now();
    this._zoomTarget = target;
    if (emit) this._emit('zoom_changed');
    cancelAnimationFrame(this._raf);
    const step = (now) => {
      if (this._destroyed) return;
      const k = Math.min(1, (now - t0) / 280);
      const ease = 1 - Math.pow(1 - k, 3);
      this._zoom = from + (this._zoomTarget - from) * ease;
      this._changed();
      if (k < 1) this._raf = requestAnimationFrame(step);
      else { this._zoom = this._zoomTarget; this._changed(); this._emit('idle'); }
    };
    this._raf = requestAnimationFrame(step);
  }
  getBounds() {
    const c = this._world();
    const s = this._scale();
    const ne = fromWorld(c.x + this._w / 2 / s, c.y - this._h / 2 / s);
    const sw = fromWorld(c.x - this._w / 2 / s, c.y + this._h / 2 / s);
    return new LatLngBounds(new LatLng(sw.lat, sw.lng), new LatLng(ne.lat, ne.lng));
  }
  getDiv() { return this._el; }
  getProjection() { return this._projection; }
  setMapTypeId() {}
  get(key) { return key === 'styles' ? this._styles : undefined; }
  setOptions(o = {}) {
    if (this._destroyed) return;
    if ('styles' in o) this._styles = o.styles || [];
    if ('draggableCursor' in o) { this._cursor = o.draggableCursor; this._applyGesture(); }
    if ('gestureHandling' in o) { this._gesture = o.gestureHandling; this._applyGesture(); }
  }
  _idleSoon() {
    clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(() => { if (!this._destroyed) this._emit('idle'); }, 0);
  }

  // --- Gestes: souris (glisser = déplacer), doigts (un doigt fait défiler la page en mode coopératif,
  // deux doigts déplacent et zooment la carte). Le zoom à la molette reste coupé, comme sur SAT. ---
  _applyGesture() {
    if (this._destroyed) return;
    this._el.style.touchAction = this._gesture === 'greedy' ? 'none' : 'pan-x pan-y';
    this._el.style.cursor = this._cursor || 'grab';
  }
  _bind() {
    this._onMouseDown = (e) => this._mouseDown(e);
    this._onTouchStart = (e) => this._touchStart(e);
    this._onTouchMove = (e) => this._touchMove(e);
    this._onTouchEnd = (e) => this._touchEnd(e);
    this._onResizeEvt = this.addListener('resize', () => { this._measure(); this._changed(); });
    // Pincement au trackpad dans Safari: ni zoom de MapKit, ni zoom de la page (comme SAT). La molette, elle,
    // n'est pas interceptée: MapKit a ses gestes coupés et la page (défilement doux de la fiche) la reçoit.
    this._onGesture = (e) => { e.stopPropagation(); e.preventDefault(); };
    this._el.addEventListener('gesturestart', this._onGesture, true);
    // Phase de capture: MapKit ne doit pas avaler les gestes avant nous (ses propres gestes sont coupés).
    this._el.addEventListener('mousedown', this._onMouseDown, true);
    this._el.addEventListener('touchstart', this._onTouchStart, { passive: false, capture: true });
    this._el.addEventListener('touchmove', this._onTouchMove, { passive: false, capture: true });
    this._el.addEventListener('touchend', this._onTouchEnd, { passive: false, capture: true });
    this._el.addEventListener('touchcancel', this._onTouchEnd, { passive: false, capture: true });
  }
  _skipTarget(t) {
    // Lien « Mentions légales » de Plans et éventuels boutons: ils gardent leur propre comportement. Les
    // contrôles de MapKit vivent dans une racine fantôme fermée: l'évènement nous arrive sur leur conteneur.
    return !!(t && t.closest && t.closest('a, button, input, select, textarea, .mk-controls-container'));
  }
  // Doigts posés sur la carte seulement: un doigt sur le curseur du soleil ou ailleurs dans la page ne compte pas.
  _ownTouches(list) { return [...(list || [])].filter((t) => t.target && this._el.contains(t.target)); }
  _local(clientX, clientY) {
    const r = this._el.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }
  _shapeFrom(t) {
    const node = t && t.closest && t.closest('[data-ms-shape]');
    if (!node) return null;
    for (const s of this._shapes) if (s._node === node || s._hit === node) return s;
    return null;
  }
  _mouseDown(e) {
    if (e.button !== 0 || this._skipTarget(e.target)) return;
    // Souris simulée par le navigateur après un toucher: le toucher a déjà été traité.
    if (performance.now() - this._lastTouchEnd < 800) return;
    const shape = this._shapeFrom(e.target);
    if (shape && shape._draggable) return; // le sommet se déplace lui-même
    e.preventDefault();
    if (this._mouseDrag) this._mouseDrag();
    const start = { x: e.clientX, y: e.clientY, c: this._world(), moved: false };
    const move = (ev) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!start.moved && Math.hypot(dx, dy) < 3) return;
      if (!start.moved) { start.moved = true; this._el.style.cursor = 'grabbing'; this._emit('dragstart'); }
      const s = this._scale();
      const g = fromWorld(start.c.x - dx / s, start.c.y - dy / s);
      this._center = new LatLng(g.lat, g.lng);
      this._changed();
      this._emit('drag');
    };
    const stop = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      this._mouseDrag = null;
    };
    const up = (ev) => {
      stop();
      this._applyGesture();
      if (start.moved) { this._emit('dragend'); this._emit('idle'); return; }
      this._tap(ev.clientX, ev.clientY, shape);
    };
    this._mouseDrag = stop;
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }
  _tap(clientX, clientY, shape) {
    const pt = this._local(clientX, clientY);
    const latLng = this._toLL(pt.x, pt.y);
    if (shape && shape._clickable) { shape._emit('click', { latLng }); return; }
    this._emit('click', { latLng, stop() {} });
    const now = performance.now();
    const last = this._lastClick;
    if (last && now - last.t < 320 && Math.hypot(pt.x - last.x, pt.y - last.y) < 8) {
      this._lastClick = null;
      this._emit('dblclick', { latLng, stop() {} });
    } else {
      this._lastClick = { t: now, x: pt.x, y: pt.y };
    }
  }
  // Geste à deux doigts (ou à un doigt en mode « greedy ») repris à partir de la caméra actuelle: début du geste,
  // ou doigt levé ou ajouté en cours de route (sinon la carte sauterait). zoomStart reste celui du tout début.
  _anchor(ts, zoomStart) {
    const two = ts.length >= 2;
    return {
      two,
      mid: two ? { x: (ts[0].x + ts[1].x) / 2, y: (ts[0].y + ts[1].y) / 2 } : ts[0],
      dist: two ? Math.hypot(ts[0].x - ts[1].x, ts[0].y - ts[1].y) || 1 : 1,
      c: this._world(),
      zoom: this._zoom,
      zoomStart,
      moved: true,
    };
  }
  _touchStart(e) {
    const own = this._ownTouches(e.touches);
    const shape = this._shapeFrom(e.target);
    if (this._skipTarget(e.target) || (shape && shape._draggable)) {
      if (own.length <= 1) this._touch = null; // pas de reste d'un geste précédent pendant le déplacement d'un sommet
      return;
    }
    const ts = own.map((t) => this._local(t.clientX, t.clientY));
    if (!ts.length) return;
    const coop = this._gesture !== 'greedy';
    const st = this._touch;
    if (ts.length >= 2) {
      e.preventDefault();
      cancelAnimationFrame(this._raf);
      const fresh = !st || st.tapOnly || (!st.two && !st.moved);
      this._touch = this._anchor(ts, fresh ? this._zoom : st.zoomStart);
      if (fresh) this._emit('dragstart');
    } else if (!coop) {
      e.preventDefault();
      cancelAnimationFrame(this._raf);
      this._touch = { two: false, mid: ts[0], c: this._world(), zoom: this._zoom, zoomStart: this._zoom, moved: false, shape };
    } else {
      this._touch = { tapOnly: true, mid: ts[0], moved: false, shape };
    }
  }
  _touchMove(e) {
    const st = this._touch;
    if (!st) return;
    const ts = this._ownTouches(e.touches).map((t) => this._local(t.clientX, t.clientY));
    if (!ts.length) return;
    if (st.tapOnly) {
      if (Math.hypot(ts[0].x - st.mid.x, ts[0].y - st.mid.y) > 6) st.moved = true;
      return; // un doigt en mode coopératif: la page défile
    }
    e.preventDefault();
    let mid = ts[0];
    let zoom = st.zoom;
    if (st.two && ts.length >= 2) {
      mid = { x: (ts[0].x + ts[1].x) / 2, y: (ts[0].y + ts[1].y) / 2 };
      const d = Math.hypot(ts[0].x - ts[1].x, ts[0].y - ts[1].y);
      zoom = Math.max(MIN_ZOOM, Math.min(this._maxZoom, st.zoom + Math.log2(d / st.dist)));
    }
    if (!st.moved && Math.hypot(mid.x - st.mid.x, mid.y - st.mid.y) < 4) return;
    if (!st.moved) { st.moved = true; this._emit('dragstart'); }
    // Le point sous les doigts au départ reste sous les doigts (déplacement et pincement ensemble).
    const s0 = TILE * Math.pow(2, st.zoom);
    const anchor = { x: st.c.x + (st.mid.x - this._w / 2) / s0, y: st.c.y + (st.mid.y - this._h / 2) / s0 };
    const s1 = TILE * Math.pow(2, zoom);
    const g = fromWorld(anchor.x - (mid.x - this._w / 2) / s1, anchor.y - (mid.y - this._h / 2) / s1);
    this._zoom = zoom;
    this._center = new LatLng(g.lat, g.lng);
    this._changed();
    this._emit('drag');
  }
  _touchEnd(e) {
    const st = this._touch;
    if (!st) return;
    this._lastTouchEnd = performance.now();
    const rest = this._ownTouches(e.touches);
    if (rest.length > 0) {
      // Un doigt levé, d'autres restent sur la carte: le geste continue à partir de la caméra actuelle.
      if (!st.tapOnly && (st.two || st.moved)) this._touch = this._anchor(rest.map((t) => this._local(t.clientX, t.clientY)), st.zoomStart);
      return;
    }
    this._touch = null;
    const cancelled = e.type === 'touchcancel';
    if (st.tapOnly || (!st.two && !st.moved)) {
      if (!cancelled && !st.moved && e.changedTouches[0]) {
        // Pas de souris simulée ensuite (sinon un second clic, et un faux double-clic).
        if (e.cancelable) e.preventDefault();
        this._tap(e.changedTouches[0].clientX, e.changedTouches[0].clientY, st.shape);
      }
      // Un toucher a pu interrompre une animation de zoom: on la termine.
      if (Math.abs(this._zoom - this._zoomTarget) > 0.001) this._animateZoom(this._zoomTarget, false);
      return;
    }
    // Fin d'un déplacement ou d'un pincement (ou geste interrompu): le zoom revient au palier entier le plus
    // proche (comme Google). zoom_changed n'est annoncé que si le palier a changé, et avant dragend: la fiche ne
    // recentre pas sur le rond (le geste dure encore).
    const rounded = Math.max(MIN_ZOOM, Math.min(this._maxZoom, Math.round(this._zoom)));
    const changed = rounded !== Math.round(st.zoomStart);
    const animate = Math.abs(rounded - this._zoom) > 0.001;
    if (animate) this._animateZoom(rounded, changed);
    else { this._zoomTarget = rounded; if (changed) this._emit('zoom_changed'); }
    this._emit('dragend');
    if (!animate) this._emit('idle');
  }

  // --- Calques ---
  _addOverlay(o) { this._overlays.add(o); }
  _removeOverlay(o) { this._overlays.delete(o); }
  _addShape(s) {
    this._shapes.add(s);
    const svg = s._isMarker ? this._markerSvg : this._shapeSvg;
    // Ordre d'empilement: zIndex, puis ordre d'ajout (comme Google).
    const after = [...svg.childNodes].find((n) => (n._msZ || 0) > (s._z || 0));
    svg.insertBefore(s._group, after || null);
  }
  _removeShape(s) { this._shapes.delete(s); if (s._group.parentNode) s._group.parentNode.removeChild(s._group); }

  destroy() {
    if (this._destroyed) return;
    this._el.style.touchAction = '';
    this._el.style.cursor = '';
    this._destroyed = true;
    cancelAnimationFrame(this._raf);
    cancelAnimationFrame(this._initRaf);
    clearTimeout(this._tilesTimer);
    clearTimeout(this._idleTimer);
    clearTimeout(this._sizeTimer);
    if (this._mouseDrag) this._mouseDrag();
    this._shapes.forEach((s) => { if (s._dragCleanup) s._dragCleanup(); });
    if (this._ro) this._ro.disconnect();
    this._el.removeEventListener('gesturestart', this._onGesture, true);
    this._el.removeEventListener('mousedown', this._onMouseDown, true);
    this._el.removeEventListener('touchstart', this._onTouchStart, true);
    this._el.removeEventListener('touchmove', this._onTouchMove, true);
    this._el.removeEventListener('touchend', this._onTouchEnd, true);
    this._el.removeEventListener('touchcancel', this._onTouchEnd, true);
    try { this._mkMap.removeEventListener('region-change-end', this._onMkRegion); } catch (e) { /* carte détruite */ }
    this._overlays.forEach((o) => { try { o.onRemove && o.onRemove(); } catch (e) { /* calque déjà retiré */ } });
    this._overlays.clear();
    this._shapes.clear();
    try { this._mkMap.destroy(); } catch (e) { /* carte déjà détruite */ }
    this._mk.remove();
    this._root.remove();
    this._listeners = {};
  }
}

// ===== OverlayView (même cycle que Google: onAdd, draw, onRemove) =====
export class OverlayView extends Emitter {
  setMap(map) {
    if (this._map === map) return;
    if (this._map) {
      this._map._removeOverlay(this);
      if (this.onRemove) this.onRemove();
    }
    this._map = map || null;
    if (map) {
      if (this.onAdd) this.onAdd();
      map._addOverlay(this);
      if (this.draw) this.draw();
    }
  }
  getMap() { return this._map || null; }
  getPanes() { return this._map ? this._map._panes : null; }
  getProjection() { return this._map ? this._map._projection : null; }
}

// ===== Formes (polygones, lignes, marqueurs) dessinées en SVG =====
const colorOf = (c) => (!c || c === 'transparent' ? 'none' : c);

class Shape extends Emitter {
  constructor(opts) {
    super();
    this._opts = {};
    this._group = svgEl('g');
    this._map = null;
    this.setOptions(opts);
  }
  setOptions(o = {}) {
    Object.assign(this._opts, o);
    this._z = this._opts.zIndex || 0;
    this._group._msZ = this._z;
    this._clickable = this._opts.clickable !== false;
    if ('map' in o) this.setMap(o.map);
    else this._render();
  }
  setMap(map) {
    if (this._map === map) return;
    if (this._map) this._map._removeShape(this);
    this._map = map || null;
    if (map) { map._addShape(this); this._render(); }
  }
  getMap() { return this._map; }
}

export class Polygon extends Shape {
  _render() {
    if (!this._map) return;
    const o = this._opts;
    if (!this._node) {
      this._node = svgEl('path');
      this._node.setAttribute('data-ms-shape', '1');
      this._node.setAttribute('stroke-linejoin', 'round');
      this._group.appendChild(this._node);
    }
    const raw = o.paths || o.path || [];
    const rings = raw.length && Array.isArray(raw[0]) ? raw : [raw];
    const d = rings.map((ring) => ring.map((v, i) => {
      const p = this._map._toPx(v);
      return (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
    }).join('') + (this._closed === false ? '' : 'Z')).join('');
    const n = this._node;
    n.setAttribute('d', d);
    n.setAttribute('fill', this._closed === false ? 'none' : colorOf(o.fillColor));
    n.setAttribute('fill-opacity', o.fillOpacity != null ? o.fillOpacity : 0.3);
    n.setAttribute('stroke', colorOf(o.strokeColor || '#000'));
    n.setAttribute('stroke-opacity', o.strokeOpacity != null ? o.strokeOpacity : 1);
    n.setAttribute('stroke-width', o.strokeWeight != null ? o.strokeWeight : 3);
    n.style.pointerEvents = this._clickable ? 'visiblePainted' : 'none';
    n.style.cursor = this._clickable ? 'pointer' : '';
  }
  getPath() { return this._opts.paths || this._opts.path || []; }
}

export class Polyline extends Polygon {
  constructor(opts) { super({ clickable: false, ...opts }); this._closed = false; this._render(); }
}

export class Marker extends Shape {
  constructor(opts) {
    super(opts);
    this._isMarker = true;
    if (this._map) { this._map._removeShape(this); this._map._addShape(this); }
  }
  setOptions(o = {}) {
    this._draggable = !!(o.draggable != null ? o.draggable : this._opts && this._opts.draggable);
    super.setOptions(o);
  }
  getPosition() { return toLL(this._opts.position); }
  setPosition(p) { this._opts.position = p; this._render(); }
  _render() {
    if (!this._map || !this._opts.position) return;
    const o = this._opts;
    const icon = o.icon || { path: SymbolPath.CIRCLE, scale: 6, fillColor: '#ea4335', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 };
    const p = this._map._toPx(o.position);
    const scale = icon.scale != null ? icon.scale : 1;
    const interactive = this._clickable || this._draggable;
    if (!this._node) {
      this._node = icon.path === SymbolPath.CIRCLE ? svgEl('circle') : svgEl('path');
      this._node.setAttribute('data-ms-shape', '1');
      this._node.setAttribute('vector-effect', 'non-scaling-stroke');
      this._node.setAttribute('stroke-linecap', 'round');
      this._node.setAttribute('stroke-linejoin', 'round');
      this._node.style.pointerEvents = 'none';
      this._group.appendChild(this._node);
      if (interactive) {
        // Zone de clic ronde et invisible, comme la zone d'icône de Google (un trait fin seul serait introuvable).
        this._hit = svgEl('circle');
        this._hit.setAttribute('data-ms-shape', '1');
        this._hit.setAttribute('fill', 'transparent');
        this._hit.style.pointerEvents = 'all';
        this._hit.style.cursor = this._draggable ? 'move' : 'pointer';
        this._group.appendChild(this._hit);
      }
      if (this._draggable) this._bindDrag();
    }
    const n = this._node;
    if (icon.path === SymbolPath.CIRCLE) {
      n.setAttribute('cx', p.x.toFixed(1));
      n.setAttribute('cy', p.y.toFixed(1));
      n.setAttribute('r', scale);
    } else {
      const ax = icon.anchor ? icon.anchor.x : 0;
      const ay = icon.anchor ? icon.anchor.y : 0;
      n.setAttribute('d', icon.path);
      n.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) scale(${scale}) translate(${-ax} ${-ay})`);
    }
    n.setAttribute('fill', colorOf(icon.fillColor));
    n.setAttribute('fill-opacity', icon.fillOpacity != null ? icon.fillOpacity : 1);
    n.setAttribute('stroke', colorOf(icon.strokeColor));
    n.setAttribute('stroke-opacity', icon.strokeOpacity != null ? icon.strokeOpacity : 1);
    n.setAttribute('stroke-width', icon.strokeWeight != null ? icon.strokeWeight : 1);
    if (this._hit) {
      this._hit.setAttribute('cx', p.x.toFixed(1));
      this._hit.setAttribute('cy', p.y.toFixed(1));
      this._hit.setAttribute('r', Math.max(12, (icon.path === SymbolPath.CIRCLE ? scale : 6) + 4));
    }
  }
  _bindDrag() {
    const startDrag = (clientX, clientY, touchId) => {
      const map = this._map;
      if (!map) return;
      if (this._dragCleanup) this._dragCleanup();
      const isTouch = touchId != null;
      const startPos = this._opts.position;
      const st = { moved: false, x: clientX, y: clientY };
      const ours = (list) => [...(list || [])].find((t) => t.identifier === touchId);
      const move = (cx, cy, ev) => {
        if (!st.moved && Math.hypot(cx - st.x, cy - st.y) < 3) return;
        if (ev && ev.cancelable) ev.preventDefault();
        st.moved = true;
        const pt = map._local(cx, cy);
        this._opts.position = map._toLL(pt.x, pt.y);
        this._render();
        this._emit('drag', { latLng: this._opts.position });
      };
      const onMouseMove = (ev) => move(ev.clientX, ev.clientY, ev);
      const onTouchMove = (ev) => { const t = ours(ev.changedTouches); if (t) move(t.clientX, t.clientY, ev); };
      const cleanup = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', end);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onTouchEnd);
        window.removeEventListener('touchcancel', onTouchCancel);
        this._dragCleanup = null;
      };
      const end = () => {
        cleanup();
        if (st.moved) this._emit('dragend', { latLng: this._opts.position });
        else if (this._clickable) this._emit('click', { latLng: this.getPosition() });
      };
      const onTouchEnd = (ev) => {
        if (!ours(ev.changedTouches)) return;
        map._lastTouchEnd = performance.now();
        if (!st.moved && ev.cancelable) ev.preventDefault(); // pas de souris simulée ensuite
        end();
      };
      // Geste interrompu (appel, centre de contrôle...): le sommet revient à sa place, rien n'est enregistré.
      const onTouchCancel = (ev) => {
        if (!ours(ev.changedTouches)) return;
        cleanup();
        this._opts.position = startPos;
        this._render();
      };
      this._dragCleanup = cleanup;
      if (isTouch) {
        window.addEventListener('touchmove', onTouchMove, { passive: false });
        window.addEventListener('touchend', onTouchEnd, { passive: false });
        window.addEventListener('touchcancel', onTouchCancel);
      } else {
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', end);
      }
    };
    const g = this._group;
    g.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (this._map && performance.now() - this._map._lastTouchEnd < 800) return; // souris simulée après un toucher
      startDrag(e.clientX, e.clientY, null);
    });
    g.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      const t = e.changedTouches[0];
      if (t) startDrag(t.clientX, t.clientY, t.identifier);
    }, { passive: true });
  }
}
