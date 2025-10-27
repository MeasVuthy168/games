/* Khmer Chess — Service Worker (instant update, no bumping) */
const CACHE = 'khmer-chess';    // fixed name

const CORE = [
  './index.html',
  './play.html',
  './friends.html',
  './settings.html',
  './notifications.html',

  './styles.css',
  './js/main.js',
  './js/ui.js',
  './js/game.js',
  './js/pwa.js',
  './js/settings.js',
  './manifest.webmanifest',

  './assets/fonts/Krasar-Regular.ttf',

  './assets/board/wood_light.jpg',
  './assets/board/wood_dark.jpg',

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

  './assets/ui/reset.png',
  './assets/ui/pause.png',
  './assets/ui/undo.png',
  './assets/ui/play.png',
  './assets/ui/nav-home.png',
  './assets/ui/nav-friends.png',
  './assets/ui/nav-play.png',
  './assets/ui/nav-settings.png',
  './assets/ui/nav-bell.png',

  './assets/sfx/move.mp3',
  './assets/sfx/capture.mp3',
  './assets/sfx/select.mp3',
  './assets/sfx/error.mp3',
  './assets/sfx/check.mp3'
];

/* ---------------- install: fetch with {cache:'reload'} so we bypass HTTP cache */
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(
      CORE.map(async (u) => {
        const req = new Request(u, { cache: 'reload' });
        const res = await fetch(req);
        if (res.ok) await c.put(req, res.clone());
      })
    );
    await self.skipWaiting(); // go to waiting; pwa.js will promote immediately
  })());
});

/* ---------------- activate: clean old caches + take control */
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim(); // control all open tabs now
  })());
});

/* ---------------- allow page to force skipWaiting (used by pwa.js) */
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* ---------------- fetch:
   - HTML -> network-first (fresh pages after deploy)
   - Static assets -> stale-while-revalidate (fast, then refresh in background)
*/
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  if (req.method !== 'GET' || url.origin !== location.origin) return;

  // HTML / navigations
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'reload' });
        const c = await caches.open(CACHE);
        c.put(req, fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match(req);
        return cached || caches.match('./index.html');
      }
    })());
    return;
  }

  // static files
  e.respondWith((async () => {
    const cached = await caches.match(req);
    const fetchAndUpdate = fetch(req).then(async (res) => {
      if (res && res.status === 200) {
        const c = await caches.open(CACHE);
        c.put(req, res.clone());
      }
      return res;
    }).catch(() => cached);
    return cached || fetchAndUpdate;
  })());
});
