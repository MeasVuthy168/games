// js/tabbar-fix.js — historically nudged the fixed top/bottom bars'
// offsets to track window.visualViewport, to compensate for a mobile
// browser's own address-bar/toolbar chrome shrinking the visible area
// below what plain `position:fixed` assumes.
//
// Removed: this app is a manifest-declared `display:"standalone"` PWA
// (see manifest.webmanifest) with every page now carrying the
// apple-mobile-web-app-capable meta tag needed for iOS to actually honor
// that — a properly-recognized standalone launch has no address bar or
// toolbar to compensate for in the first place. The correction was
// instead the source of a real, reproduced bug: a single bad
// window.visualViewport reading during active scroll (confirmed via a
// user screen recording, frame-by-frame) sent the bottom nav flying into
// the middle of the screen for a moment before snapping back. Plain
// position:fixed + env(safe-area-inset-*) (already on both bars in
// styles.css) is simpler and can't produce that failure mode.

// Tap-and-hold on a bottom-nav tab: these are plain <a href> links (see
// #appTabbar in every page), so a long-press brings up the BROWSER's own
// native link menu (Copy link address / Share link / Open in Chrome
// browser, etc. — Android Chrome's version of this; iOS Safari's
// equivalent callout is already suppressed by styles.css's global
// -webkit-touch-callout:none, which is a WebKit-only property with no
// effect on Chrome). These tabs are app navigation, not links meant to be
// copied, shared, or downloaded — a native app's own tab bar would never
// show this menu — so suppress it the same way here.
document.querySelectorAll('#appTabbar a').forEach(function (a) {
  a.addEventListener('contextmenu', function (e) { e.preventDefault(); });
});
