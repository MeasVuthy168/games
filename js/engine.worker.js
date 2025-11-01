// js/engine.worker.js
// Bridge worker that prefers ESM module engine, with a robust Classic fallback.
// Sends UCI commands exactly once (no multi-shape spam).

(() => {
  const log = (t) => { try { postMessage(t); } catch {} };

  // Resolve URLs
  const here      = new URL(self.location.href);
  const jsDir     = new URL('./', here);       // .../js/
  const root      = new URL('../', jsDir);     // repo root (one level up from js/)
  const engineDir = new URL('engine/', root);  // .../engine/

  const wasmURL   = new URL('fairy-stockfish.wasm', engineDir).href;
  const jsURL     = new URL('fairy-stockfish.js',   engineDir).href;
  const loaderURL = new URL('uci-loader.module.js', engineDir);
  loaderURL.searchParams.set('wasm', wasmURL);

  /** Current inner worker (either module or classic-shim) */
  let inner = null;
  let ready = false;
  const q = [];

  function outLine(s) {
    // Any line coming from engine to app:
    try { postMessage(s); } catch {}
    // Flip ready on common UCI tokens:
    if (/uciok|readyok|^id\s|^option\s|^bestmove\s/i.test(s)) ready = true;
  }

  function send(line) {
    if (!line) return;
    // Only one normalized shape with trailing newline.
    const msg = line.endsWith('\n') ? line : (line + '\n');
    if (inner) inner.postMessage(msg);
    else q.push(msg);
  }

  function flush() {
    if (!inner || !q.length) return;
    for (const s of q) inner.postMessage(s);
    q.length = 0;
  }

  /** Start module worker first. If no output soon, fall back to classic shim. */
  function startModuleThenMaybeFallback() {
    try {
      inner = new Worker(loaderURL, { type: 'module', name: 'fairy-stockfish-esm' });
      let gotAny = false;
      const arm = setTimeout(() => {
        if (!gotAny) {
          try { inner.terminate(); } catch {}
          inner = null;
          log('[ENGINE] [FALLBACK] Switching to Classic shim (no ESM output)');
          startClassicShim();
        }
      }, 450); // short grace; enough to see 'uciok' on fast networks

      inner.onmessage = (e) => {
        gotAny = true;
        const d = e && e.data;
        if (typeof d === 'string') { outLine(d); return; }
        const s = d?.data || d?.line || d?.stdout;
        if (typeof s === 'string') { outLine(s); return; }
        try { postMessage('[ENGINE][OBJ] ' + JSON.stringify(d)); } catch {}
      };
      inner.onerror = (err) => {
        try { postMessage('[ENGINE][ERR] Module worker error: ' + (err?.message||String(err))); } catch {}
      };

      log('[ENGINE] [ESM] loader: ' + loaderURL.href);
      // Prime (minimal, once each)
      send('uci');
      send('isready');
      flush();
    } catch (e) {
      log('[ENGINE] [ERR] Cannot start ESM worker: ' + (e?.message||String(e)));
      startClassicShim();
    }
  }

  /** Classic shim: importScripts engine JS inside a nested worker and wire UCI. */
  function startClassicShim() {
    // Blob worker code – sets Module.locateFile, imports engine JS, then wires a factory/global.
    const blobSrc =
`(function(){
  const wasm='${wasmURL}';
  const js  ='${jsURL}';

  self.Module = {
    locateFile: (p) => (typeof p === 'string' && p.endsWith('.wasm')) ? wasm : p,
    print:   (l) => { try { postMessage(String(l)); } catch {} },
    printErr:(l) => { try { postMessage(String(l)); } catch {} },
  };

  importScripts(js);
  // Try common factory exports
  let engine = null;
  try {
    if (typeof self.FairyStockfish === 'function') engine = self.FairyStockfish();
    else if (typeof self.Stockfish === 'function') engine = self.Stockfish();
  } catch(_) {}

  // If we got a worker-like engine (preferred)
  if (engine && typeof engine.postMessage === 'function') {
    engine.onmessage = (e) => {
      const d = e && e.data;
      if (typeof d === 'string') { try { postMessage(d); } catch {} }
      else {
        const s = d?.data || d?.line || d?.stdout;
        if (typeof s === 'string') { try { postMessage(s); } catch {} }
      }
    };
    self.onmessage = (e) => {
      const dat = e && e.data;
      const line = (typeof dat === 'string') ? dat
                 : (dat?.cmd || dat?.uci || dat?.data || dat?.stdin || '');
      if (!line) return;
      engine.postMessage(line.endsWith('\\n') ? line : (line+'\\n'));
    };
    try { postMessage('[ENGINE] [CLASSIC] Worker online'); } catch {}
    try { postMessage('[ENGINE] [CLASSIC] WASM: ' + wasm); } catch {}
    try { postMessage('[ENGINE] [CLASSIC] JS:   ' + js); } catch {}
    return;
  }

  // Fallback: hope the imported script has hooked global onmessage/print
  try { postMessage('[ENGINE] [CLASSIC] Global-mode (no factory)'); } catch {}
})();`;

    const blob = new Blob([blobSrc], { type:'application/javascript' });
    const url  = URL.createObjectURL(blob);
    inner = new Worker(url, { name:'fairy-classic-shim' });

    inner.onmessage = (e) => {
      const d = e && e.data;
      if (typeof d === 'string') { outLine(d); return; }
      const s = d?.data || d?.line || d?.stdout;
      if (typeof s === 'string') { outLine(s); return; }
    };
    inner.onerror = (err) => {
      try { postMessage('[ENGINE][ERR] Classic shim error: ' + (err?.message||String(err))); } catch {}
    };

    // Prime (once each)
    send('uci');
    send('isready');
    flush();
  }

  // Relay from main thread -> inner worker (single format)
  self.onmessage = (e) => {
    const dat = e && e.data;
    const line = (typeof dat === 'string') ? dat
               : (dat?.cmd || dat?.uci || dat?.data || dat?.stdin || '');
    if (!line) return;
    if (inner) inner.postMessage(line.endsWith('\n') ? line : (line + '\n'));
    else q.push(line.endsWith('\n') ? line : (line + '\n'));
  };

  // Boot
  startModuleThenMaybeFallback();
})();
