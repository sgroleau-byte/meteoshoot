// Fichier de désinstallation (v633.124): MeteoShoot n'utilise plus de service worker.
// Les navigateurs et l'app Mac qui avaient l'ancien service worker le remplacent par celui-ci lors de
// leur vérification de mise à jour; il vide les caches, se désinscrit et recharge les fenêtres ouvertes.
// À supprimer, avec le nettoyage dans index.html et la règle /sw.js de vercel.json, vers décembre 2026.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((c) => c.navigate(c.url));
  })());
});
