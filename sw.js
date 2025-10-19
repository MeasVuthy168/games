/* Khmer Chess — Service Worker */
const VERSION = 'v1.0.0';
const CACHE = `khmer-chess-${VERSION}`;

const CORE = [
  // pages
  'index.html',
  'play.html',
  'friends.html',
  'settings.html',
  'notifications.html',

  // assets
  'styles.css',
  'js/main.js',
  'js/ui.js',
  'js/game.js',
  'js/pwa.js',
  'manifest.webmanifest',

  // piece images (12)
  'assets/pieces/w-king.png',
  'assets/pieces/w-queen.png',
  'assets/pieces/w-bishop.png',
  'assets/pieces/w-knight.png',
  'assets/pieces/w-rook.png',
  'assets/pieces/w-pawn.png',
  'assets/pieces/b-king.png',
  'assets/pieces/b-queen.png',
  'assets/pieces/b-bishop.png',
  'assets/pieces/b-knight.png',
  'assets/pieces/b-rook.png',
  'assets/pieces/b-pawn.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k.startsWith('khmer-chess-') && k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Only handle same-origin GETs
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  // 1) Navigations: App Shell (index.html) offline
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('index.html'))
    );
    return;
  }

  // 2) Static assets: cache-first
  if (/\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|webmanifest)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(res => {
        const resClone = res.clone();
        caches.open(CACHE).then(c => c.put(req, resClone));
        return res;
      }).catch(() => cached))
    );
    return;
  }

  // 3) Default: network-first, fallback to cache
  e.respondWith(
    fetch(req).then(res => {
      const resClone = res.clone();
      caches.open(CACHE).then(c => c.put(req, resClone));
      return res;
    }).catch(() => caches.match(req))
  );
});
