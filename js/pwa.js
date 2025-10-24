(async () => {
  if (!('serviceWorker' in navigator)) return;

  try {
    const reg = await navigator.serviceWorker.register('./sw.js');

    // If waiting SW exists
    if (reg.waiting) notifyUpdate(reg.waiting);

    // Detect new installing SW
    reg.addEventListener('updatefound', () => {
      const newSW = reg.installing;
      if (!newSW) return;
      newSW.addEventListener('statechange', () => {
        if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
          notifyUpdate(newSW);
        }
      });
    });

    // When new SW takes control
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (window.__reloading) return;
      window.__reloading = true;
      location.reload();
    });
  } catch (err) {
    console.error('Service Worker registration failed:', err);
  }

  function notifyUpdate(waitingSW) {
    const ok = confirm('មានកំណែថ្មីរបស់ Khmer Chess។ តើចង់ធ្វើបច្ចុប្បន្នភាពឥឡូវនេះទេ?');
    if (ok) waitingSW.postMessage({ type: 'SKIP_WAITING' });
  }
})();
