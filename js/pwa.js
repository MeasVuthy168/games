// Registers the Service Worker + handles the install prompt button on Home.
(function(){
  // SW registration
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(console.error);
  }

  // "Add to Home Screen" custom prompt on Home page
  let deferredPrompt = null;
  const btn = document.getElementById('installBtn');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (btn) btn.style.display = 'flex';
  });

  if (btn) {
    btn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      btn.disabled = true;
      try {
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        // choice.outcome is 'accepted' | 'dismissed'
      } catch (err) {
        console.log('Install prompt error:', err);
      } finally {
        btn.style.display = 'none';
        deferredPrompt = null;
      }
    });
  }

  // Hide button if already installed
  window.addEventListener('appinstalled', () => {
    if (btn) btn.style.display = 'none';
  });
  if (window.matchMedia('(display-mode: standalone)').matches) {
    if (btn) btn.style.display = 'none';
  }
})();
