// main.js — bootstrap & game exposure
import { initUI } from './ui.js';

/**
 * Make the game instance globally visible and notify listeners.
 */
function exposeGame(maybeGame) {
  // Accept either `game` or `{ game }`
  const g = maybeGame?.game ?? maybeGame;
  if (!g) return false;

  // Only set once
  if (!window.game) {
    window.game = g;
    console.log('[main] game exposed on window.game');

    // Let AI / other modules know the board is ready
    try {
      window.dispatchEvent(new CustomEvent('kc:ready', { detail: { game: g } }));
    } catch (e) {
      console.log('[main] dispatch kc:ready failed:', e);
    }
  }
  return true;
}

/**
 * Boot sequence:
 * - wait for DOM
 * - run initUI (supports sync or async)
 * - try to expose the game instance
 * - install a short fallback probe if UI creates game later
 */
async function boot() {
  // Wait for DOM if needed
  if (document.readyState === 'loading') {
    await new Promise(res => document.addEventListener('DOMContentLoaded', res, { once: true }));
  }

  // Call your current UI initializer (handle sync or Promise)
  let out;
  try {
    out = initUI();
    if (out instanceof Promise) out = await out;
  } catch (e) {
    console.log('[main] initUI threw:', e);
  }

  // Try to expose from return value
  if (exposeGame(out)) return;

  // Fallback #1: if UI attached something like window.kcGame
  if (exposeGame(window.kcGame)) return;

  // Fallback #2: light probe (up to ~2s) to catch late-created instance
  let ticks = 0;
  const timer = setInterval(() => {
    ticks++;
    if (exposeGame(window.kcGame) || exposeGame(window.game)) {
      clearInterval(timer);
      return;
    }
    if (ticks > 40) { // ~2s at 50ms/tick
      clearInterval(timer);
      console.log('[main] game instance not found after probing');
    }
  }, 50);
}

// Global error logs (kept)
window.addEventListener('error', (e) => {
  console.log('Runtime error:', e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.log('Unhandled promise rejection:', e.reason);
});

// Go
boot();
