// js/engine.worker.js
// Universal wrapper for fairy-stockfish.js inside a Worker.
// Supports BOTH classic global-worker builds and factory-style builds.
//
// 1) importScripts(fairy-stockfish.js)
//    - If the script sets self.onmessage -> use that (classic)
//    - Else, if it exposes FairyStockfish/Stockfish() -> instantiate and bridge
// 2) Kick exactly once (uci + isready) after wiring
//
// No nested workers, no multiple kicks, no message-shape spam.

(function () {
  const log = (s) => { try { postMessage(s); } catch {} };

  let booted = false;
  if (booted) return;
  booted = true;

  log('[ENGINE] [CLASSIC] Worker online');

  // Paths
  const here      = new URL(self.location.href); // .../js/engine.worker.js
  const base      = new URL('./', here);         // .../js/
  const root      = new URL('../', base);        // repo root
  const engineDir = new URL('engine/', root);    // .../engine/

  const wasmURL = new URL('fairy-stockfish.wasm', engineDir).href;
  const jsURL   = new URL('fairy-stockfish.js',   engineDir).href;

  log(`[ENGINE] [CLASSIC] WASM: ${wasmURL}`);
  log(`[ENGINE] [CLASSIC] JS:   ${jsURL}`);

  // Ensure .wasm can be found even in factory builds
  self.Module = self.Module || {};
  const prevLocate = self.Module.locateFile;
  self.Module.locateFile = function (path) {
    if (typeof path === 'string' && path.endsWith('.wasm')) return wasmURL;
    return prevLocate ? prevLocate(path) : path;
  };

  let engineMode = 'unknown';         // 'global' | 'factory'
  let engineOnMessage = null;         // classic: function(lineEvent)
  let engineInstance = null;          // factory: object with postMessage/onmessage
  let kicked = false;

  // Parent -> engine bridge (wired after detection)
  let parentToEngine = null;

  function kickOnce() {
    if (kicked) return;
    kicked = true;
    log('[ENGINE] Handshake: uci + isready');
    try { parentToEngine('uci'); } catch {}
    setTimeout(() => { try { parentToEngine('isready'); } catch {} }, 10);
  }

  function wireGlobalMode() {
    engineMode = 'global';
    // The engine installed self.onmessage; capture & replace with a thin proxy
    engineOnMessage = self.onmessage;
    if (typeof engineOnMessage !== 'function') {
      log('[ENGINE][ERR] Global mode expected a function on self.onmessage, but none found.');
      return false;
    }
    // Parent -> engine: forward one canonical string
    parentToEngine = (line) => { engineOnMessage({ data: String(line) }); };

    // IMPORTANT: Do NOT override the engine’s own postMessage; it already posts to parent.
    // We only replace OUR outer handler now to forward parent messages to engine.
    self.onmessage = (e) => {
      const d = e && e.data;
      let line = null;
      if (typeof d === 'string') line = d;
      else if (d && typeof d.cmd   === 'string') line = d.cmd;
      else if (d && typeof d.uci   === 'string') line = d.uci;
      else if (d && typeof d.data  === 'string') line = d.data;
      else if (d && typeof d.stdin === 'string') line = d.stdin;
      if (line == null) return;
      parentToEngine(line);
    };

    return true;
  }

  function wireFactoryMode(factoryFn) {
    engineMode = 'factory';
    try {
      engineInstance = factoryFn(); // typical Stockfish() pattern returns a worker-like object
    } catch (e) {
      log('[ENGINE][ERR] Factory construct failed: ' + (e && e.message ? e.message : String(e)));
      return false;
    }

    if (!engineInstance || typeof engineInstance.postMessage !== 'function') {
      log('[ENGINE][ERR] Factory instance missing postMessage().');
      return false;
    }

    // Engine -> parent
    try {
      engineInstance.onmessage = (ev) => {
        const msg = (ev && (ev.data ?? ev.stdout ?? ev.line)) ?? ev;
        if (msg != null) postMessage(typeof msg === 'string' ? msg : String(msg));
      };
    } catch (e) {
      // Some builds use addEventListener
      try {
        engineInstance.addEventListener('message', (ev) => {
          const msg = (ev && (ev.data ?? ev.stdout ?? ev.line)) ?? ev;
          if (msg != null) postMessage(typeof msg === 'string' ? msg : String(msg));
        });
      } catch (e2) {
        log('[ENGINE][ERR] Cannot attach engine onmessage: ' + (e2 && e2.message ? e2.message : String(e2)));
        return false;
      }
    }

    // Parent -> engine
    parentToEngine = (line) => { engineInstance.postMessage(String(line)); };

    // Outer worker handler just forwards strings to engineInstance
    self.onmessage = (e) => {
      const d = e && e.data;
      let line = null;
      if (typeof d === 'string') line = d;
      else if (d && typeof d.cmd   === 'string') line = d.cmd;
      else if (d && typeof d.uci   === 'string') line = d.uci;
      else if (d && typeof d.data  === 'string') line = d.data;
      else if (d && typeof d.stdin === 'string') line = d.stdin;
      if (line == null) return;
      parentToEngine(line);
    };

    return true;
  }

  try {
    // Load the engine script
    importScripts(jsURL);

    // Try classic/global first
    if (typeof self.onmessage === 'function') {
      log('[ENGINE] Detected classic global-worker build');
      if (wireGlobalMode()) { kickOnce(); return; }
    }

    // Then try common factory names
    const factory =
        (typeof self.FairyStockfish === 'function' && self.FairyStockfish) ||
        (typeof self.Stockfish      === 'function' && self.Stockfish)      ||
        (typeof self.stockfish      === 'function' && self.stockfish);

    if (factory) {
      log('[ENGINE] Detected factory build');
      if (wireFactoryMode(factory)) { kickOnce(); return; }
    }

    // Neither detected
    log('[ENGINE][ERR] Engine did not install onmessage AND no factory was found.');
  } catch (e) {
    log('[ENGINE][ERR] importScripts failed: ' + (e && e.message ? e.message : String(e)));
  }
})();
