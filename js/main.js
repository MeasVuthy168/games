// main.js — bootstrap + expose window.game + kc:ready event
import { initUI } from './ui.js';

// Dispatch kc:ready once we can see a game object (from ui.js)
function fireReady(game) {
  if (!game) return;
  if (window.__kc_ready_fired) return;
  window.__kc_ready_fired = true;
  window.game = game;
  document.dispatchEvent(new CustomEvent('kc:ready', { detail: { game } }));
}

// 1) run initUI
let returnedGame = null;
try {
  returnedGame = await initUI?.();
} catch { /* non-async initUI */ }

// 2) if initUI returned the instance, fire
if (returnedGame) fireReady(returnedGame);

// 3) otherwise poll for window.game set by ui.js
const poll = setInterval(() => {
  if (window.game) {
    clearInterval(poll);
    fireReady(window.game);
  }
}, 100);

// safety: stop polling after 10s
setTimeout(() => clearInterval(poll), 10000);

// basic error logs
window.addEventListener('error', (e) => {
  console.log('Runtime error:', e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.log('Unhandled promise rejection:', e.reason);
});
