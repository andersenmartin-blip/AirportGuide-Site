const CACHE_NAME = 'airportguide-v6';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './tz-lookup.min.js',
  './assets/partner-links.js?v=20261106-dubai-transfer',
  './assets/analytics.js?v=20261106-affiliates',
  './assets/analytics.css?v=20261106-affiliates',
  './assets/guide.css',
  './guides/dubai/',
  './privacy/'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Flight and weather data must always come from the network.
  if (
    url.hostname === 'flightcard-api.andersen-martin.workers.dev' ||
    url.hostname === 'api.open-meteo.com' ||
    url.hostname === 'raw.githubusercontent.com'
  ) {
    return;
  }

  // Always try the newest app shell first so visitors do not get a stale UI.
  if (request.mode === 'navigate') {
    // Keep each page separate. A visit to a guide must never replace the cached
    // flight-search page, and flight query strings need not be stored offline.
    const cacheKey = url.pathname === '/' || url.pathname === '/index.html'
      ? './index.html'
      : url.pathname;
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, copy)));
          }
          return response;
        })
        .catch(async () => (await caches.match(cacheKey)) || Response.error())
    );
    return;
  }

  // Cache only same-origin static assets.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
          }
          return response;
        }).catch(() => cached || Response.error());
        return cached || network;
      })
    );
  }
});
