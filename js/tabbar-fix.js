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
