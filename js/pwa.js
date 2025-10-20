// Registers the Service Worker + handles the install prompt button on Home.
// Also applies the saved theme across all pages.
(function () {
  const log = (...a) => console.log('[PWA]', ...a);

  // ===== THEME boot =====
  try {
    const theme = localStorage.getItem('kc_theme') || 'auto';
    const root = document.documentElement;
    if (theme === 'dark') root.setAttribute('data-theme', 'dark');
    else if (theme === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
  } catch {}

  // SW registration (scope './' for GitHub Pages subfolder)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then(reg => {
        log('SW registered', reg.scope);
        return navigator.serviceWorker.ready;
      })
      .then(() => log('SW ready (controls this page)'))
      .catch(err => console.error('[PWA] SW error', err));
  }

  let deferredPrompt = null;
  const btn = document.getElementById('installBtn');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    log('beforeinstallprompt fired');
    if (btn) btn.style.display = 'flex';
  });

  btn?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    btn.disabled = true;
    try {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      log('install choice', choice);
    } catch (err) {
      console.error('[PWA] prompt error', err);
    } finally {
      btn.style.display = 'none';
      deferredPrompt = null;
    }
  });

  window.addEventListener('appinstalled', () => {
    log('appinstalled');
    if (btn) btn.style.display = 'none';
  });

  if (window.matchMedia('(display-mode: standalone)').matches) {
    if (btn) btn.style.display = 'none';
  }
})();
