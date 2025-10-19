// js/main.js
import { initUI } from './ui.js';

// Make sure the DOM exists before booting UI
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUI);
} else {
  initUI();
}

// Optional: very basic error surface (helps debugging on phones)
window.addEventListener('error', (e) => {
  console.log('Runtime error:', e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.log('Unhandled promise rejection:', e.reason);
});
