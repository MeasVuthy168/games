// pwa.js — no version bumping required
const SW_URL = './sw.js'; // keep sw.js at site root (or same directory as index.html)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(SW_URL, {
        scope: './',
        updateViaCache: 'none' // don’t reuse a cached sw.js
      });

      // Always check for a newer SW on load
      reg.update();

      // If a new SW is installing, force it to take control ASAP
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            sw.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });

      // When the new SW takes control, reload once to get fresh assets
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!window.__reloadedForSW) {
          window.__reloadedForSW = true;
          location.reload();
        }
      });

      // Optional: ping for updates while app is open
      setInterval(() => reg.update(), 60 * 1000);
    } catch (err) {
      console.log('SW registration failed:', err);
    }
  });
}
