import { initUI } from './ui.js';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUI);
} else {
  initUI();
}

window.addEventListener('error', (e) => {
  console.log('Runtime error:', e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.log('Unhandled promise rejection:', e.reason);
});
