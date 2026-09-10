// js/tabbar-fix.js — keeps the fixed bottom nav (#appTabbar) pinned to the
// actual visible bottom edge of the screen, on every page that has it.
//
// Nothing in this app ever hides #appTabbar (no code anywhere toggles a
// hidden/collapsed state on it — its .is-hidden CSS rule in styles.css is
// unused dead code from an earlier, never-wired-up feature). The "auto
// hide" users see is a mobile browser/WebView behavior: `position:fixed;
// bottom:0` is positioned against the *layout* viewport, which can be
// taller than what's actually on screen while the browser's own chrome
// (address bar, or Telegram's in-app-browser bar) is visible — so the bar
// ends up sitting partly or fully behind that chrome, and appears to
// "auto-hide" as the chrome expands/collapses on scroll.
//
// window.visualViewport reports the *actual* visible area, so this nudges
// the bar's `bottom` offset to match it exactly instead of trusting plain
// position:fixed alone. A no-op (and harmless) on browsers without the API.
(function () {
  const vv = window.visualViewport;
  if (!vv) return;

  function pin() {
    const bar = document.getElementById('appTabbar');
    if (!bar) return;
    const gap = window.innerHeight - vv.height - vv.offsetTop;
    bar.style.bottom = `${Math.max(0, gap)}px`;
  }

  vv.addEventListener('resize', pin);
  vv.addEventListener('scroll', pin);
  document.addEventListener('DOMContentLoaded', pin);
})();
