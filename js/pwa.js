// js/pwa.js
const SW_VERSION = 'v2.2.1';                          // keep in sync with sw.js
const SW_URL     = `./sw.js?v=${encodeURIComponent(SW_VERSION)}`;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      // IMPORTANT: updateViaCache:'none' ensures the browser doesn't reuse a cached sw.js
      const reg = await navigator.serviceWorker.register(SW_URL, {
        scope: './',
        updateViaCache: 'none'
      });

      // Always check for a newer SW right away
      reg.update();

      // If a new worker is found, make it take control immediately
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          // When the new SW finishes installing while an old one controls the page,
          // tell it to skip waiting and take over now.
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            sw.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });

      // When control changes to a new SW, reload to pick up fresh assets
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // prevents infinite loops
        if (!window._swRefreshing) {
          window._swRefreshing = true;
          window.location.reload();
        }
      });

      // Optional: periodically check for updates while the page is open
      setInterval(() => reg.update(), 60 * 1000);
    } catch (err) {
      console.log('Service worker registration failed:', err);
    }
  });
}
