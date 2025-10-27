// pwa.js — instant updates, no version bumping
const SW_URL = './sw.js';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(SW_URL, {
        scope: './',
        updateViaCache: 'none' // never use HTTP cache for sw.js
      });

      // Check for updates on load and every minute
      reg.update();
      setInterval(() => reg.update(), 60 * 1000);

      // Promote a newly installed worker immediately
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            sw.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });

      // When controller changes, reload once to pick up fresh assets
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!window.__reloadedForSW) {
          window.__reloadedForSW = true;
          location.reload();
        }
      });

      // If there’s already a waiting worker (fresh after deploy), activate it
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    } catch (err) {
      console.log('SW registration failed:', err);
    }
  });
}
