// js/engine.worker.js
// Bridge worker that prefers an ESM module loader, and cleanly falls back
// to a classic (importScripts) build. In classic mode, if the engine installs
// its own global onmessage, we DO NOT override it (global-mode).

(function () {
  /* ----------------------------- utilities ----------------------------- */

  const postStdout = (s) => {
    try { postMessage(String(s)); } catch {}
  };
  const postInfo = (s) => postStdout(String(s));

  // Try several message shapes for maximal engine compatibility.
  function pumpTo(worker, cmd) {
    const line = (typeof cmd === 'string') ? cmd : (
      cmd?.cmd || cmd?.uci || cmd?.stdin || cmd?.data || ''
    );
    if (!line) return;
    const l = line.endsWith('\n') ? line : (line + '\n');
    try { worker.postMessage(line); } catch {}
    try { worker.postMessage(l); } catch {}
    try { worker.postMessage({ cmd: line }); } catch {}
    try { worker.postMessage({ uci: line }); } catch {}
    try { worker.postMessage({ data: l }); } catch {}
    try { worker.postMessage({ stdin: l }); } catch {}
    try { worker.postMessage({ type:'cmd', cmd: line }); } catch {}
    try { worker.postMessage({ event:'stdin', data: l }); } catch {}
  }

  /* ----------------------- resolve engine locations --------------------- */

  const here       = new URL(self.location.href);
  const base       = new URL('./', here);      // .../js/
  const root       = new URL('../', base);     // repo root one level up from js/
  const engineDir  = new URL('engine/', root); // .../engine/

  const wasmURL    = new URL('fairy-stockfish.wasm', engineDir).href;
  const jsURL      = new URL('fairy-stockfish.js', engineDir).href;

  // ESM loader (module worker) that accepts ?wasm=<abs>
  const loaderURL  = new URL('uci-loader.module.js', engineDir);
  loaderURL.searchParams.set('wasm', wasmURL);

  /* --------------------------- state & wiring --------------------------- */

  let inner = null;            // the actual engine worker (module or classic shim)
  let ready = false;           // becomes true after seeing uciok/readyok/options/id/bestmove
  let seenOutput = false;      // any output from the ESM loader
  const queue = [];            // commands enqueued before engine is ready

  function flushQueue() {
    if (!inner) return;
    while (queue.length) pumpTo(inner, queue.shift());
  }

  function markOutputAndMaybeReady(line) {
    seenOutput = true;
    if (/uciok|readyok|option|id name|bestmove/i.test(line)) {
      ready = true;
      flushQueue();
    }
  }

  /* ------------------------------ ESM first ----------------------------- */

  function startModule() {
    try {
      inner = new Worker(loaderURL, { type: 'module', name: 'fairy-stockfish-module' });
      postInfo('[ENGINE] [ESM] loader: ' + loaderURL.href);

      inner.onmessage = (e) => {
        const d = e?.data;
        if (typeof d === 'string') {
          postStdout(d);
          markOutputAndMaybeReady(d);
          return;
        }
        const s = d?.data || d?.line || d?.stdout;
        if (typeof s === 'string') {
          postStdout(s);
          markOutputAndMaybeReady(s);
        }
      };

      inner.onerror = (err) => {
        try { postStdout('[ENGINE][ERR] Module worker error: ' + (err?.message || String(err))); } catch {}
      };

      // We send a couple of nudges; sophisticated builds ignore them until init.
      setTimeout(() => pumpTo(inner, 'uci'), 60);
      setTimeout(() => pumpTo(inner, 'isready'), 180);

      // If the ESM path stays silent briefly, we fall back to classic shim.
      setTimeout(() => {
        if (!seenOutput) {
          postInfo('[ENGINE] [FALLBACK] Classic shim (no ESM output)');
          startClassicShim();
        }
      }, 800);

    } catch (e) {
      postInfo('[ENGINE] [FALLBACK] Classic shim (ESM start error)');
      startClassicShim();
    }
  }

  /* --------------------------- classic shim ----------------------------- */

  function startClassicShim() {
    const blobSrc =
`(function(){
  const wasm='${wasmURL}';
  const js ='${jsURL}';

  // Emscripten plumbing for both factory + global builds
  self.Module = {
    locateFile(p){ return (typeof p==='string' && p.endsWith('.wasm')) ? wasm : p; },
    print(l){ try{ postMessage(String(l)); }catch{} },
    printErr(l){ try{ postMessage(String(l)); }catch{} },
  };

  // Capture handler before engine loads
  const beforeOnMsg = self.onmessage;

  // Load the classic engine script (either factory or global-mode)
  importScripts(js);

  // --- Case A: Engine installed its own global onmessage (GLOBAL-MODE) ---
  if (typeof self.onmessage === 'function' && self.onmessage !== beforeOnMsg) {
    try{ postMessage('[ENGINE] [CLASSIC] Global-mode active'); }catch{}
    try{ postMessage('[ENGINE] [CLASSIC] WASM: '+wasm); }catch{}
    try{ postMessage('[ENGINE] [CLASSIC] JS:   '+js); }catch{}
    // Do not override; messages from outer worker will hit engine directly.
    return;
  }

  // --- Case B: Factory-style build (FairyStockfish()/Stockfish()) ---
  let engine=null;
  try{
    if (typeof self.FairyStockfish === 'function') engine=self.FairyStockfish();
    else if (typeof self.Stockfish === 'function') engine=self.Stockfish();
  }catch(_){}

  if (engine && typeof engine.postMessage === 'function'){
    // Engine -> outer main
    engine.onmessage = (e)=>{
      const d=e?.data;
      if (typeof d==='string'){ try{ postMessage(d); }catch{}; return; }
      const s=d?.data||d?.line||d?.stdout;
      if (typeof s==='string'){ try{ postMessage(s); }catch{}; return; }
    };
    // Outer -> engine
    self.onmessage = (e)=>{
      const dat=e?.data;
      const line=(typeof dat==='string')?dat:(dat?.cmd||dat?.uci||dat?.data||dat?.stdin||'');
      if (!line) return;
      engine.postMessage(line.endsWith('\\n')?line:(line+'\\n'));
    };
    try{ postMessage('[ENGINE] [CLASSIC] Worker online (factory)'); }catch{}
    try{ postMessage('[ENGINE] [CLASSIC] WASM: '+wasm); }catch{}
    try{ postMessage('[ENGINE] [CLASSIC] JS:   '+js); }catch{}
    return;
  }

  // --- Case C: Neither global nor factory visible (rare) ---
  try{ postMessage('[ENGINE] [CLASSIC] Fallback proxy (no factory/global)'); }catch{}
  self.onmessage = (e)=>{
    const dat=e?.data;
    const s=(typeof dat==='string')?dat:(dat?.stdin||dat?.cmd||dat?.uci||dat?.data||'');
    // Just echo for visibility; if engine attaches later it will replace us.
    if (s) { try{ postMessage(String(s)); }catch{} }
  };
})();`;

    const blob = new Blob([blobSrc], { type: 'application/javascript' });
    const url  = URL.createObjectURL(blob);

    // Tear down ESM worker if it existed
    try { inner?.terminate?.(); } catch {}
    inner = new Worker(url, { name: 'fairy-classic-shim' });

    inner.onmessage = (e) => {
      const d = e?.data;
      if (typeof d === 'string') {
        postStdout(d);
        markOutputAndMaybeReady(d);
        return;
      }
      const s = d?.data || d?.line || d?.stdout;
      if (typeof s === 'string') {
        postStdout(s);
        markOutputAndMaybeReady(s);
      }
    };
    inner.onerror = (err) => {
      try { postStdout('[ENGINE][ERR] Classic shim error: ' + (err?.message || String(err))); } catch {}
    };

    // Give global-mode engines a small kick; harmless for others.
    setTimeout(() => { pumpTo(inner, 'uci'); }, 40);
    setTimeout(() => { pumpTo(inner, 'isready'); }, 160);
  }

  /* --------------------------- outer wiring ----------------------------- */

  self.onmessage = (e) => {
    const dat = e?.data;
    // Accept a variety of shapes
    const line = (typeof dat === 'string')
      ? dat
      : (dat?.cmd || dat?.uci || dat?.data || dat?.stdin || '');

    if (!line) return;

    if (inner) {
      pumpTo(inner, line);
    } else {
      // queue until engine is started/ready
      queue.push(line);
    }
  };

  /* ------------------------------- boot --------------------------------- */

  postInfo('[ENGINE] [CLASSIC] Worker online'); // visible instantly
  // Prefer module path; it will fallback itself if silent.
  startModule();

})();
