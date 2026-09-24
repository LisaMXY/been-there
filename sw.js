/* Offline for the hosted copy. Opening index.html from disk needs none of this
   - a service worker only runs over http(s) - so everything here is a bonus
   layer that the app never depends on.

   Bump VERSION whenever anything in data/ or src/ changes; the old cache is
   thrown away on activate. */
const VERSION = 'been-there-v7';

/* The page and the code are network-first: when you are online you always get
   what the server has, so a redeploy is never masked by a stale cache. The two
   big data files never change without a VERSION bump and are ~3.5 MB, so those
   are cache-first - re-downloading them on every visit is the one thing worth
   avoiding. */
const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'src/styles.css',
  'src/store.js',
  'src/atlas.js',
  'src/badges.js',
  'src/roulette.js',
  'src/card.js',
  'src/trips.js',
  'src/summary.js',
  'src/app.js',
  'vendor/geo.js',
  'data/countries.js',
  'data/borders.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

const HEAVY = /\/data\/(admin1|cities)\.js$/;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // One bad URL must not fail the whole install, so add them one at a time.
    await Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== VERSION).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (HEAVY.test(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(request, {ignoreSearch: true});
      if (cached) return cached;
      const fresh = await fetch(request);
      if (fresh.ok) (await caches.open(VERSION)).put(request, fresh.clone());
      return fresh;
    })());
    return;
  }

  event.respondWith((async () => {
    try {
      const fresh = await fetch(request);
      if (fresh.ok) (await caches.open(VERSION)).put(request, fresh.clone());
      return fresh;
    } catch (err) {
      const cached = await caches.match(request, {ignoreSearch: true});
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const shell = await caches.match('index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
