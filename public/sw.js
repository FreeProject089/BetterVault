const CACHE_NAME = 'bettervault-v4';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/brand/logo-on-dark.svg',
  '/brand/logo-on-light.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Seuls les fichiers de l'application sont mis en cache : jamais l'API (coffre, sessions),
  // ni les pages rendues par le serveur (documents légaux, administration), ni les domaines tiers.
  const serverRendered = url.pathname === '/legal' || url.pathname.startsWith('/legal/')
    || url.pathname === '/admin' || url.pathname.startsWith('/admin/');
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || serverRendered) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const network = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return networkResponse;
      });

      if (cachedResponse) {
        network.catch(() => undefined);
        return cachedResponse;
      }
      return network;
    }).catch(() => caches.match('/index.html'))
  );
});
