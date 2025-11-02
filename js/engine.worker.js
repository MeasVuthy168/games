// js/engine.worker.js
// Tries ESM module-worker first; if no engine stdout, falls back to classic/global mode.
// In classic/global mode we DO NOT override self.onmessage so the engine's own handler runs.

(() => {
  const log = (s) => { try { postMessage(s); } catch {} };

  // Resolve URLs
  const here      = new URL(self.location.href);
  const base      = new URL('./', here);        // .../js/
  const root      = new URL('../', base);       // repo root
  const engineDir = new URL('engine/', root);   // .../engine/

  const wasmURL   = new URL('fairy-stockfish.wasm', engineDir).href;
  const loaderURL = new URL('uci-loader.module.js', engineDir);
  loaderURL.searchParams.set('wasm', wasmURL);

  const engineJS  = new URL('fairy-stockfish.js', engineDir).href;

  // ===== State =====
  let MODE = 'boot';            // 'boot' | 'module' | 'classic'
  let inner = null;             // module worker instance
  let queue = [];               // queue commands received before engine ready
  let haveEngineOutput = false; // did we see any stdout from engine?

  // We temporarily intercept to buffer commands until mode is known.
  function handleInbound(line) {
    if (typeof line !== 'string') return;
    // Buffer everything until we decide mode.
    queue.push(line);
    // If module mode, also pass-through to module worker if present
    if (MODE === 'module' && inner) {
      try { inner.postMessage(line); } catch {}
      try { inner.postMessage(line.endsWith('\n') ? line : line + '\n'); } catch {}
      try { inner.postMessage({ cmd: line }); } catch {}
    }
  }

  self.onmessage = (e) => {
    const d = e?.data;
    let line = null;
    if (typeof d === 'string') line = d;
    else if (d && typeof d.cmd === 'string') line = d.cmd;
    else if (d && typeof d.uci === 'string') line = d.uci;
    else if (d && typeof d.data === 'string') line = d.data;
    else if (d && typeof d.stdin === 'string') line = d.stdin;
    if (!line) return;

    // Before engine mode is known or in module mode, we buffer/forward above.
    if (MODE !== 'classic') {
      handleInbound(line);
      return;
    }

    // CLASSIC/GLOBAL: let the engine's own handler receive the same message
    try {
      self.dispatchEvent(new MessageEvent('message', { data: line }));
    } catch {}
  };

  // ===== Try MODULE worker first =====
  function startModule() {
    try {
      inner = new Worker(loaderURL, { type: 'module', name: 'fairy-stockfish-module' });
      MODE = 'module';
      log(`[ENGINE] [ESM] loader: ${loaderURL.href}`);

      inner.onmessage = (e) => {
        haveEngineOutput = true;
        const d = e?.data;
        if (typeof d === 'string') { postMessage(d); return; }
        const s = d?.data || d?.line || d?.stdout;
        if (typeof s === 'string') postMessage(s);
      };

      inner.onerror = (err) => {
        try { postMessage(`[ENGINE][ERR] module worker: ${err?.message||String(err)}`); } catch {}
      };

      // Kick a bit (these also go through queue)
      queue.push('uci'); queue.push('isready');

      // Give the module a short window to respond. If nothing -> classic.
      setTimeout(() => {
        if (!haveEngineOutput) {
          fallbackClassic();
        } else {
          // Flush queued lines to module
          const snapshot = queue.slice(); queue.length = 0;
          for (const s of snapshot) {
            try { inner.postMessage(s); } catch {}
            try { inner.postMessage(s.endsWith('\n') ? s : s + '\n'); } catch {}
            try { inner.postMessage({ cmd: s }); } catch {}
          }
        }
      }, 400); // short grace
    } catch (e) {
      fallbackClassic();
    }
  }

  // ===== CLASSIC/GLOBAL mode =====
  function fallbackClassic() {
    if (inner) { try { inner.terminate(); } catch {} }
    inner = null;
    MODE = 'classic';
    log('[ENGINE] [FALLBACK] Classic shim (no ESM output)');
    log('[ENGINE] [CLASSIC] Global-mode (no factory)');
    log(`[ENGINE] [CLASSIC] WASM: ${wasmURL}`);
    log(`[ENGINE] [CLASSIC] JS:   ${engineJS}`);

    try {
      // Import the global worker build; it will install its own self.onmessage
      importScripts(engineJS);
      log('[ENGINE] [CLASSIC] Engine script imported');

      // Replay any queued commands to the engine's own onmessage
      const snapshot = queue.slice(); queue.length = 0;
      for (const s of snapshot) {
        try { self.dispatchEvent(new MessageEvent('message', { data: s })); } catch {}
      }

      // Also proactively kick standard UCI init
      const kicks = ['uci','isready','uci','isready'];
      kicks.forEach((c, i) => setTimeout(() => {
        try { self.dispatchEvent(new MessageEvent('message', { data: c })); } catch {}
      }, 50 + i * 120));
    } catch (e) {
      try { postMessage(`[ENGINE][ERR] classic import failed: ${e?.message||String(e)}`); } catch {}
    }
  }

  // Boot banner + start module attempt
  postMessage('[ENGINE] [CLASSIC] Worker online');
  startModule();
})();
