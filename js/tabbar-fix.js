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

// Tap-and-hold on ANY in-app navigation link -- bottom-nav tabs, home's
// menu cards, Settings' profile-bar link, etc. -- brings up the BROWSER's
// own native link menu (Copy link address / Share link / Open in Chrome
// browser, etc. — Android Chrome's version of this; iOS Safari's
// equivalent callout is already suppressed by styles.css's global
// -webkit-touch-callout:none, which is a WebKit-only property with no
// effect on Chrome). Every one of these is app navigation, not a link
// meant to be copied, shared, or downloaded — a native app's own screens
// never show this menu — so suppress it the same way here.
//
// Delegated on `document` (rather than querying specific selectors) so it
// covers every current and future in-app link at once, including ones
// built dynamically by page-specific JS. The one deliberate exception:
// genuinely external targets (mailto:, tel:, http(s)://) are left alone,
// since someone long-pressing Settings' support-email link plausibly
// DOES want to copy/share that address -- there's exactly one such link
// in the whole app.
document.addEventListener('contextmenu', function (e) {
  var a = e.target.closest && e.target.closest('a[href]');
  if (!a) return;
  if (/^(mailto:|tel:|https?:)/i.test(a.getAttribute('href') || '')) return;
  e.preventDefault();
}, true);
