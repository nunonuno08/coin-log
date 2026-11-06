// Serves the app from cache first (works offline) and refreshes the cache in the background,
// so updates appear on the next launch (app.js then reloads once).
// Raise CACHE with every release.
const CACHE = 'coinlog-v1';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js',
  'js/db.js',
  'js/store.js',
  'js/calc.js',
  'js/util.js',
  'js/nav.js',
  'js/ui.js',
  'js/ocr.js',
  'js/record.js',
  'js/views/home.js',
  'js/views/calendar.js',
  'js/views/history.js',
  'js/views/settings.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

// GitHub Pages lets browsers reuse files for 10 minutes, so a plain fetch right after an
// update could store the old files again. 'reload' / 'no-cache' always ask the server.
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // the reading library caches itself
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req.url, { cache: 'no-cache' })
        .then(res => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      if (cached) {
        e.waitUntil(network);
        return cached;
      }
      return network;
    }),
  );
});
