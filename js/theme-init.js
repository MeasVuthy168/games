// js/theme-init.js — applies the persisted theme choice before first
// paint, on every page. Deliberately a plain classic script (not a
// module, no defer/async) loaded first in <head> so it runs synchronously
// before the page renders — otherwise a page would flash light before
// settings.js (which only ran on settings.html, and only reacted to the
// radio's own change event) ever got a chance to apply it, or would never
// apply it at all on any other page.
(function () {
  try {
    var v = localStorage.getItem('kc_theme');
    if (v === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else if (v === 'light') document.documentElement.setAttribute('data-theme', 'light');
  } catch (e) {}
})();
