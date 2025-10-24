/* Khmer Chess — Service Worker (Balanced Strategy) */
const VERSION = 'v2.0.1';  // ⬅️ bump when you deploy new code
const PREFIX = 'khmer-chess';
const STATIC_CACHE = `${PREFIX}-static-${VERSION}`;
const RUNTIME_CACHE = `${PREFIX}-runtime-${VERSION}`;
const IMG_CACHE = `${PREFIX}-img-${VERSION}`;

/** Core pages & essential app files */
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

  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

/** Piece images → cache-first */
const PIECES = [
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
  './assets/pieces/b-pawn.png'
];

/** ✅ Board textures → also cache-first */
const BOARDS = [
  './assets/board/wood_light.jpg',
  './assets/board/wood_dark.jpg'
];

/* ===== INSTALL ===== */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const staticCache = await caches.open(STATIC_CACHE);
      await staticCache.addAll(CORE);

      const imageCache = await caches.open(IMG_CACHE);
      await imageCache.addAll(PIECES.concat(BOARDS));

      // activate new service worker immediately
      await self.skipWaiting();
    })()
  );
});

/* ===== ACTIVATE ===== */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(k => ![STATIC_CACHE, RUNTIME_CACHE, IMG_CACHE].includes(k) && k.startsWith(PREFIX))
          .map(k => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

/* ===== CACHING STRATEGIES ===== */

// Stale-while-revalidate for images/icons
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req).then(res => {
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return cached || network || Response.error();
}

// Network-first for code (HTML/CSS/JS)
async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req);
    return cached || Response.error();
  }
}

// Cache-first for small game assets (pieces, boards)
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && res.status === 200) cache.put(req, res.clone());
  return res;
}

/* ===== FETCH HANDLER ===== */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const path = url.pathname;

  // 1. Navigations → always network-first
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, RUNTIME_CACHE));
    return;
  }

  // 2. App code (HTML/CSS/JS/manifest)
  if (/\.(?:html|css|js|webmanifest|map)$/.test(path)) {
    event.respondWith(networkFirst(req, RUNTIME_CACHE));
    return;
  }

  // 3. Chess pieces and board textures → cache-first
  if (path.includes('/assets/pieces/') || path.includes('/assets/board/')) {
    event.respondWith(cacheFirst(req, IMG_CACHE));
    return;
  }

  // 4. Icons/images → stale-while-revalidate
  if (/\.(?:png|jpg|jpeg|gif|svg|webp|ico)$/.test(path)) {
    event.respondWith(staleWhileRevalidate(req, IMG_CACHE));
    return;
  }

  // 5. Fallback → network-first
  event.respondWith(networkFirst(req, RUNTIME_CACHE));
});

/* ===== UPDATE FLOW ===== */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
