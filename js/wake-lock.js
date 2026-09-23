// js/wake-lock.js — Screen Wake Lock helper. A purely spectator screen
// (watching a friend's online game, or an AI-vs-AI match) never counts as
// "user activity" to the OS — no taps, no scrolling — so the normal
// screen-dim/lock timer still fires exactly as if the page were idle,
// even while it's actively updating. This keeps the display on for as
// long as one of those screens wants it.
//
// Support (the Wake Lock API) isn't universal (notably pre-16.4 Safari) —
// every call below degrades to a silent no-op rather than throwing, so a
// page that can't get a lock just falls back to the OS's normal timeout
// exactly as it already did before this module existed.
let sentinel = null;
let wanted = false;

async function requestLock() {
  try {
    if (!('wakeLock' in navigator)) return;
    sentinel = await navigator.wakeLock.request('screen');
  } catch {
    sentinel = null;
  }
}

export async function acquireWakeLock() {
  wanted = true;
  await requestLock();
}

export async function releaseWakeLock() {
  wanted = false;
  try { await sentinel?.release(); } catch {}
  sentinel = null;
}

// The lock is auto-released by the browser itself whenever the tab
// becomes hidden (its own privacy/battery rule — nothing to work around),
// so it has to be re-requested once the tab is visible again, for as long
// as the caller still wants it (e.g. switching apps mid-watch, then
// coming back).
document.addEventListener('visibilitychange', () => {
  if (wanted && document.visibilityState === 'visible') requestLock();
});
