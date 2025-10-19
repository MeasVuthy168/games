// ================================
// main.js — Khmer Chess Entry Point
// ================================

import { initUI } from './ui.js';

// ✅ Run UI only after the page is fully loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUI);
} else {
  initUI();
}

// 🛑 Basic error logging to help debug issues on mobile (GitHub Pages)
window.addEventListener('error', (e) => {
  console.log('Runtime error:', e.error || e.message);
});

window.addEventListener('unhandledrejection', (e) => {
  console.log('Unhandled promise rejection:', e.reason);
});
