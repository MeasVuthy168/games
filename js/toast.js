// js/toast.js — lightweight, self-contained toast notifications, used in
// place of alert() for messages that don't need to block the page (saved
// settings, sent/failed requests, etc.). No HTML changes needed anywhere:
// the container is created lazily on first use and appended to <body>, so
// any page just imports { showToast } and calls it.

const DURATION_MS = 3200;

function ensureContainer() {
  let el = document.getElementById('toastContainer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toastContainer';
    el.className = 'toast-container';
    document.body.appendChild(el);
  }
  return el;
}

// kind: 'info' (default) | 'success' | 'error'
export function showToast(message, kind = 'info') {
  if (!message) return;
  const container = ensureContainer();
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  container.appendChild(el);

  // Next frame so the enter transition actually plays instead of the toast
  // just appearing already in its "shown" state.
  requestAnimationFrame(() => el.classList.add('show'));

  setTimeout(() => {
    el.classList.remove('show');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 500); // fallback if transitionend never fires
  }, DURATION_MS);
}
