// js/page-transition.js — marks the incoming page's slide-in direction
// before first paint, on every bottom-tab page (Home/Friend/Play/Chat/
// Setting/Notification). Deliberately a plain classic script (not a
// module, no defer/async) loaded first in <head>, same reasoning as
// theme-init.js right above it: this has to run and set its class on
// <html> before <main> is ever parsed/painted, or the page would flash
// at its normal resting position for one frame and then jump into the
// off-screen starting point instead of smoothly sliding in from it.
//
// This is a real multi-page app (separate .html files, full browser
// navigations) — no client-side router, so there's no way to show the
// outgoing and incoming page sliding past each other simultaneously
// without either a full SPA rewrite or the Cross-Document View
// Transitions API (Chrome/Edge only, not supported on this app's actual
// primary target — iOS Safari/WKWebView standalone PWA — where it would
// just silently do nothing). Instead each page plays its own short
// entrance animation on load; see styles.css's pt-slide-in-left/right
// keyframes for the actual animation, gated on the html.pt-enter-left/
// -right class this script decides.
//
// Direction comes from real navigation history, never bottom-nav menu
// order (Home->Chat must not animate as if it passed through Friend/
// Play): the browser's own Back/Forward buttons are "backward" (enter
// from the left); any other same-origin arrival is "forward" (enter
// from the right). A fresh/external entry (typed URL, bookmark, first
// load) or a plain reload has nothing to slide "from", so neither class
// is applied and the page just appears normally.
(function () {
  try {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Reuses the app's existing Animation ON/OFF setting (js/settings.js /
    // js/ui.js's isAnimationEnabled()) rather than inventing a second one —
    // same localStorage key, same "missing/true means on" default. This is
    // a plain classic script with no module imports available, so it reads
    // the stored value directly instead of importing settings.js.
    try {
      var storedSettings = JSON.parse(localStorage.getItem('kc_settings_v1') || 'null');
      if (storedSettings && storedSettings.animationEnabled === false) return;
    } catch (e) {}

    var navEntry = performance.getEntriesByType('navigation')[0];
    var navType = navEntry ? navEntry.type : 'navigate';
    if (navType === 'reload') return;

    var cameFromSameOrigin = false;
    if (document.referrer) {
      try { cameFromSameOrigin = new URL(document.referrer).origin === location.origin; }
      catch (e) { cameFromSameOrigin = false; }
    }
    if (!cameFromSameOrigin) return;

    var cls = navType === 'back_forward' ? 'pt-enter-left' : 'pt-enter-right';
    document.documentElement.classList.add(cls);

    // Remove the class once the entrance animation actually finishes,
    // rather than leaving it on <html> for the rest of the page's
    // lifetime. Matters on chat.html specifically: its #listView (this
    // page's .page-transition-root there) toggles `hidden` as the user
    // opens/closes a conversation thread within the SAME page load, and
    // a CSS animation restarts from the beginning whenever its element
    // goes from display:none back to displayed while a matching
    // `animation` value is still in effect — leaving the class in place
    // would replay this same slide-in every time the list is shown again,
    // not just once on the real page navigation. Delegated on `document`
    // (animationend bubbles) so it works even though .page-transition-root
    // doesn't exist yet when this script runs.
    document.addEventListener('animationend', function (e) {
      if (e.animationName === 'pt-slide-in-right' || e.animationName === 'pt-slide-in-left') {
        document.documentElement.classList.remove('pt-enter-left', 'pt-enter-right');
      }
    });
  } catch (e) {}
})();
