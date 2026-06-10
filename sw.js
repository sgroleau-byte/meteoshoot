const CACHE_VERSION = 803;
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

// Réponse de secours quand le réseau ET le cache échouent.
// Évite respondWith(null) qui casse la page avec une erreur cryptique
// (« FetchEvent.respondWith received an error: Returned response is null »).
const OFFLINE_HTML =
  '<!doctype html><html lang="fr"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>Serveur injoignable</title></head>' +
  '<body style="margin:0;background:#1c1c1e;color:#aeaeb2;font-family:-apple-system,sans-serif;' +
  'display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:2rem">' +
  '<div><p style="font-size:1.1rem;line-height:1.5">Le serveur local est injoignable.<br>' +
  'Démarrez-le, puis rechargez la page.</p></div></body></html>';

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  if (e.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .catch(() => caches.match(e.request))
        .then(res => res || new Response(OFFLINE_HTML, {
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
