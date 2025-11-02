// js/engine.worker.js
// Safe classic wrapper for fairy-stockfish.js (no nested module worker).
// - Imports the engine once
// - Proxies parent -> engine without re-entrancy
// - Sends a single UCI handshake (uci + isready) after import
// - NEVER overrides the engine's own postMessage behavior to the parent

(function () {
  let engineOnMessage = null;   // the handler installed by fairy-stockfish.js
  let booted = false;
  let kicked = false;

  // simple logger up to the main thread (debug panel prints strings)
  const log = (s) => { try { postMessage(s); } catch {} };

  // Guard against multiple initializations (the worker might be created twice)
  if (booted) return;
  booted = true;

  log('[ENGINE] [CLASSIC] Worker online');

  try {
    // Import fairy-stockfish classic build (global self.onmessage will be set by the engine)
    const here = new URL(self.location.href);                 // .../js/engine.worker.js
    const base = new URL('./', here);                         // .../js/
    const root = new URL('../', base);                        // repo root (../ from js/)
    const engineDir = new URL('engine/', root);               // .../engine/

    const wasmURL = new URL('fairy-stockfish.wasm', engineDir).href;
    const jsURL   = new URL('fairy-stockfish.js',   engineDir).href;

    log(`[ENGINE] [CLASSIC] WASM: ${wasmURL}`);
    log(`[ENGINE] [CLASSIC] JS:   ${jsURL}`);

    // Make sure the Emscripten locateFile can find the absolute WASM
    // Some classic builds read Module.locateFile from global scope.
    self.Module = self.Module || {};
    const prevLocate = self.Module.locateFile;
    self.Module.locateFile = function(path) {
      if (typeof path === 'string' && path.endsWith('.wasm')) return wasmURL;
      return prevLocate ? prevLocate(path) : path;
    };

    // Capture the engine's message handler after import
    importScripts(jsURL);
    if (typeof self.onmessage === 'function') {
      engineOnMessage = self.onmessage; // installed by fairy-stockfish.js
      log('[ENGINE] [CLASSIC] Engine script imported');
    } else {
      log('[ENGINE][ERR] Engine did not install onmessage handler.');
    }
  } catch (e) {
    log('[ENGINE][ERR] importScripts failed: ' + (e && e.message ? e.message : String(e)));
  }

  // Our *outer* handler (parent -> worker). We DO NOT call postMessage here
  // except via engineOnMessage, so there is no echo/recursion.
  self.onmessage = function (e) {
    if (!engineOnMessage) return; // drop until engine loaded
    try {
      // Only forward the single canonical shape the engine expects: string
      let line = null;
      const d = e && e.data;
      if (typeof d === 'string') line = d;
      else if (d && typeof d.cmd === 'string') line = d.cmd;
      else if (d && typeof d.uci === 'string') line = d.uci;
      else if (d && typeof d.data === 'string') line = d.data;
      else if (d && typeof d.stdin === 'string') line = d.stdin;

      if (!line) return;

      // Forward once; the engine's handler will process and use postMessage
      // to talk to the MAIN thread (not back to this handler), so no loop.
      engineOnMessage({ data: line });
    } catch (err) {
      log('[ENGINE][ERR] proxy failed: ' + (err && err.message ? err.message : String(err)));
    }
  };

  // Kick UCI exactly once, shortly after the engine installs its handler
  function kickOnce() {
    if (kicked || !engineOnMessage) return;
    kicked = true;
    log('[ENGINE] [CLASSIC] Handshake: uci + isready');
    try { engineOnMessage({ data: 'uci' }); } catch {}
    setTimeout(() => { try { engineOnMessage({ data: 'isready' }); } catch {} }, 10);
  }
  // small delay to ensure importScripts finished
  setTimeout(kickOnce, 0);
})();
