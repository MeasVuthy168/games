const SW_URL = './sw.js';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      // A page's very first-ever visit registers a service worker with no
      // prior controller — activation calls clients.claim() (see sw.js),
      // which fires a controllerchange on THIS SAME page even though
      // nothing actually changed underneath it. Only a controllerchange
      // that happens after a controller already existed is a genuine
      // "a newer version just took over" update worth reloading for.
      const hadController = !!navigator.serviceWorker.controller;

      const reg = await navigator.serviceWorker.register(SW_URL, {
        scope: './',
        updateViaCache: 'none'
      });
      reg.update();

      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            sw.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) return;
        if (!window.__reloadedForSW) {
          window.__reloadedForSW = true;
          location.reload();
        }
      });

      setInterval(() => reg.update(), 60 * 1000);
    } catch (err) {
      console.log('SW registration failed:', err);
    }
  });
}
