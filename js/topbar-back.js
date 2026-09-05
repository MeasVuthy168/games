// js/topbar-back.js — wires every page's top-bar back button. Plain
// classic script (not a module, loaded with `defer`) so it runs on every
// page without each one needing its own copy of this handful of lines.
(function () {
  function goBack() {
    // A real previous page in *this* browsing context — not just any
    // history entry — is what makes "back" meaningful; otherwise (a fresh
    // tab, a PWA launched straight into this page) fall back to Home.
    if (window.history.length > 1 && document.referrer) {
      window.history.back();
    } else {
      location.href = 'index.html';
    }
  }
  document.querySelectorAll('.topbar-back').forEach(function (btn) {
    btn.addEventListener('click', goBack);
  });
})();
