/* Khmer Chess — Service Worker (instant update, no bumping) */
const CACHE = 'khmer-chess';

const CORE = [
  './index.html','./play.html','./friends.html','./settings.html','./notifications.html','./profile.html',
  './tournament.html','./rewards.html','./ai-vs-ai.html',
  './auth.html','./reset-password.html','./verify-email.html','./chat.html',
  './styles.css','./js/main.js','./js/ui.js','./js/ai.js','./js/ai-engine.js','./js/ai-worker.js','./js/game.js','./js/pwa.js','./js/settings.js','./js/profile.js',
  './js/coins.js','./js/history.js','./js/profile-data.js','./js/themes.js','./js/i18n.js',
  './js/tournament.js','./js/rewards.js','./js/tournament-page.js','./js/rewards-page.js','./js/ai-vs-ai.js',
  './js/api.js','./js/auth-page.js','./js/reset-password-page.js','./js/verify-email-page.js','./js/friends-page.js','./js/chat-page.js','./js/notifications-page.js','./js/notif-badge.js','./js/push-client.js',
  './js/theme-init.js','./js/toast.js','./js/topbar-back.js',
  './manifest.webmanifest',
  './assets/fonts/Krasar-Regular.ttf',
  './assets/board/wood_light.jpg','./assets/board/wood_dark.jpg',
  './assets/icons/icon-192.png','./assets/icons/icon-512.png',
  './assets/pieces/w-king.png','./assets/pieces/w-queen.png','./assets/pieces/w-bishop.png','./assets/pieces/w-knight.png','./assets/pieces/w-rook.png','./assets/pieces/w-pawn.png',
  './assets/pieces/b-king.png','./assets/pieces/b-queen.png','./assets/pieces/b-bishop.png','./assets/pieces/b-knight.png','./assets/pieces/b-rook.png','./assets/pieces/b-pawn.png',
  './assets/ui/reset.png','./assets/ui/pause.png','./assets/ui/undo.png','./assets/ui/play.png',
  './assets/ui/nav-home.png','./assets/ui/nav-friends.png','./assets/ui/nav-play.png','./assets/ui/nav-settings.png','./assets/ui/nav-bell.png',
  './assets/sfx/move.mp3','./assets/sfx/capture.mp3','./assets/sfx/select.mp3','./assets/sfx/error.mp3','./assets/sfx/check.mp3'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(CORE.map(async (u) => {
      const req = new Request(u, { cache: 'reload' });
      const res = await fetch(req);
      if (res.ok) await c.put(req, res.clone());
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Real Web Push — this is what lets a notification reach the device even
// while every tab/PWA window is fully closed (ouk-ai-backend's src/push.js
// sends the payload below via the browser's push service the instant a
// real event happens; js/notif-badge.js's in-page polling is a separate,
// foreground-only path that this doesn't replace). Payload shape is
// { title, body, url, tag } — composed server-side in src/notify.js so it
// never depends on any page's JS being alive to compute it.
self.addEventListener('push', (e) => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch { /* non-JSON/empty push — show a generic fallback below */ }
  const title = payload.title || 'Khmer Chess';
  const options = {
    body: payload.body || 'You have a new notification',
    icon: 'assets/icons/icon-192.png',
    badge: 'assets/icons/icon-192.png',
    tag: payload.tag,
    data: { url: payload.url || './' },
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// Chrome/Firefox/etc. can silently drop and re-issue a subscription with a
// new endpoint (key rotation, storage pressure) — this fires when that
// happens. Nothing here can re-POST to the backend itself (no page/fetch
// auth context in this scope), so just re-subscribe with the same
// application server key and hand it to any open page to persist; if none
// is open, the next page load's own resubscribe-check (js/push-client.js)
// picks it up instead.
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    try {
      const oldKey = e.oldSubscription?.options?.applicationServerKey;
      if (!oldKey) return;
      const newSub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: oldKey });
      const clientsList = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
      for (const c of clientsList) c.postMessage({ type: 'PUSH_RESUBSCRIBED', subscription: newSub.toJSON() });
    } catch { /* best-effort — the next page load's resubscribe-check is the fallback */ }
  })());
});

// Tap-to-open for notifications shown via registration.showNotification()
// (see js/notif-badge.js — the Android-compatible path, since that
// browser rejects the plain `new Notification()` constructor called
// directly from a page).
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || './';
  e.waitUntil(self.clients.openWindow(new URL(url, self.registration.scope).href));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

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

  // Script/style are the app's actual logic — serving a stale cached copy
  // here (then quietly refreshing the cache "for next time") means a real
  // code change can sit invisible on a device for a long time: the
  // background refresh only lands if that request happens to finish before
  // the tab is backgrounded/suspended, which on a phone is not reliable.
  // Network-first (falling back to cache only when actually offline) means
  // any online load gets the current code; images/fonts/audio below keep
  // the original cache-first behavior since those rarely change and
  // refetching them on every load would be wasteful.
  if (req.destination === 'script' || req.destination === 'style') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.status === 200) {
          const c = await caches.open(CACHE);
          c.put(req, fresh.clone());
        }
        return fresh;
      } catch {
        return (await caches.match(req)) || Response.error();
      }
    })());
    return;
  }

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
