const CACHE_VERSION = 770;
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

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  
  if (e.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).catch(() => caches.match(e.request))
    );
    return;
  }
  
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
