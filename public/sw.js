const CACHE_VERSION = 875;
const CACHE_NAME = 'meteoshoot-v' + CACHE_VERSION;

const STATIC_ASSETS = [
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
  'icon-1024.png'
];

const DEV_ASSETS = [
  'icon-180-DevRose.png',
  'icon-192-DevRose.png',
  'icon-512-DevRose.png',
  'icon-1024-DevRose.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await cache.addAll(STATIC_ASSETS);
      // Try dev icons but don't fail if 401
      for (const asset of DEV_ASSETS) {
        try { await cache.add(asset); } catch(e) {}
      }
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Réponse de secours quand le réseau ET le cache échouent (première ouverture hors ligne, serveur
// injoignable). Texte destiné à l'utilisateur, en français ou en anglais selon la langue de l'appareil.
// Évite respondWith(null) qui casse la page avec une erreur cryptique.
const offlineHtml = () => {
  const en = /^en/i.test((self.navigator && self.navigator.language) || '');
  const t = en
    ? { lang: 'en', title: 'No connection', body: 'MeteoShoot cannot reach the server. Check your internet connection, then try again.', btn: 'Try again' }
    : { lang: 'fr', title: 'Connexion impossible', body: 'MeteoShoot n\u2019arrive pas à joindre le serveur. Vérifiez votre connexion internet, puis réessayez.', btn: 'Réessayer' };
  return '<!doctype html><html lang="' + t.lang + '"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
    '<meta name="theme-color" content="#181b1e"><title>' + t.title + '</title></head>' +
    '<body style="margin:0;background:#181b1e;color:#aeaeb2;font-family:-apple-system,BlinkMacSystemFont,\'Helvetica Neue\',sans-serif;' +
    'display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:2rem;box-sizing:border-box">' +
    '<div style="max-width:420px"><div style="font-size:1.25rem;font-weight:600;color:#e6e6e6;margin-bottom:.75rem">' + t.title + '</div>' +
    '<p style="font-size:1rem;line-height:1.5;margin:0 0 1.5rem">' + t.body + '</p>' +
    '<button onclick="location.reload()" style="background:none;border:1.5px solid rgba(255,255,255,0.3);color:#e6e6e6;border-radius:999px;' +
    'padding:.7rem 1.6rem;font-size:1rem;letter-spacing:.04em;cursor:pointer">' + t.btn + '</button></div></body></html>';
};

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  if (e.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .catch(() => caches.match(e.request))
        .then(res => res || new Response(offlineHtml(), {
          status: 503,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        }))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request)
      .then(cached => cached || fetch(e.request))
      .catch(() => new Response('', { status: 504 }))
  );
});
