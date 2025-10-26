/* Khmer Chess — Service Worker */
const VERSION = 'v3.0.0';                  // bump when anything changes
const CACHE   = `khmer-chess-${VERSION}`;

const CORE = [
  // pages
  './index.html',
  './play.html',
  './friends.html',
  './settings.html',
  './notifications.html',

  // scripts & styles
  './styles.css',
  './js/main.js',
  './js/ui.js',
  './js/game.js',
  './js/pwa.js',
  './js/settings.js',
  './manifest.webmanifest',

  // font
  './assets/fonts/Krasar-Regular.ttf',

  // board textures
  './assets/board/wood_light.jpg',
  './assets/board/wood_dark.jpg',

  // app icons & pieces
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/pieces/w-king.png',
  './assets/pieces/w-queen.png',
  './assets/pieces/w-bishop.png',
  './assets/pieces/w-knight.png',
  './assets/pieces/w-rook.png',
  './assets/pieces/w-pawn.png',
  './assets/pieces/b-king.png',
  './assets/pieces/b-queen.png',
  './assets/pieces/b-bishop.png',
  './assets/pieces/b-knight.png',
  './assets/pieces/b-rook.png',
  './assets/pieces/b-pawn.png',

  // UI PNGs (controls + bottom nav)
  './assets/ui/reset.png',
  './assets/ui/pause.png',
  './assets/ui/undo.png',
  './assets/ui/play.png',           // if you toggle pause->play icon
  './assets/ui/nav-home.png',
  './assets/ui/nav-friends.png',
  './assets/ui/nav-play.png',
  './assets/ui/nav-settings.png',
  './assets/ui/nav-bell.png',

  // sounds
  './assets/sfx/move.mp3',
  './assets/sfx/capture.mp3',
  './assets/sfx/select.mp3',
  './assets/sfx/error.mp3',
  './assets/sfx/check.mp3'
];

/* ------------------------------ install ------------------------------ */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

/* ------------------------------ activate ----------------------------- */
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(k => k.startsWith('khmer-chess-') && k !== CACHE)
            .map(k => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

/* ------------------------------ fetch -------------------------------- */
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Only handle same-origin GET
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  // Navigations → network-first (fallback to shell)
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Static assets → cache-first (stale-while-revalidate lite)
  if (/\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|ttf|mp3|wav|ogg|webmanifest)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(cached => {
        const fetchAndUpdate = fetch(req).then(res => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        }).catch(() => cached);
        return cached || fetchAndUpdate;
      })
    );
    return;
  }

  // Everything else → network-first, fallback to cache
  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req))
  );
});
