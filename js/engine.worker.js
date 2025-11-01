// js/engine.worker.js
// Outer "bridge" worker. Spawns an inner MODULE worker to run the ESM engine.
// Now with deep diagnostics + Blob fallback.

(function () {
  const say = (s) => { try { postMessage(s); } catch {} };

  // EARLY LOG: if you don't see this, the worker file didn't execute.
  say('[ENGINE][BRIDGE] worker booting…');

  // ---- URL resolution -------------------------------------------------
  const here      = new URL(self.location.href);  // …/js/engine.worker.js?[v=...]
  const jsDir     = new URL('./', here);          // …/js/
  const root      = new URL('../', jsDir);        // …/
  const engineDir = new URL('engine/', root);     // …/engine/

  const wasmURL   = new URL('fairy-stockfish.wasm', engineDir).href;
  const engJSURL  = new URL('fairy-stockfish.js',   engineDir).href;
  const loaderURL = new URL('uci-loader.module.js', engineDir);
  loaderURL.searchParams.set('wasm', wasmURL);

  // ---- Quick path probes (from inside worker) ------------------------
  (async () => {
    try {
      const [r1, r2, r3] = await Promise.allSettled([
        fetch(engJSURL, { method: 'HEAD', cache: 'no-store' }),
        fetch(wasmURL,  { method: 'HEAD', cache: 'no-store' }),
        fetch(loaderURL, { method: 'HEAD', cache: 'no-store' }),
      ]);
      if (r1.status === 'fulfilled') say(`[ENGINE][CHK] fairy-stockfish.js -> ${r1.value.status}`);
      else                          say(`[ENGINE][CHK] fairy-stockfish.js -> ${r1.reason}`);

      if (r2.status === 'fulfilled') say(`[ENGINE][CHK] fairy-stockfish.wasm -> ${r2.value.status}`);
      else                          say(`[ENGINE][CHK] fairy-stockfish.wasm -> ${r2.reason}`);

      if (r3.status === 'fulfilled') say(`[ENGINE][CHK] uci-loader.module.js -> ${r3.value.status}`);
      else                          say(`[ENGINE][CHK] uci-loader.module.js -> ${r3.reason}`);
    } catch (e) {
      say(`[ENGINE][CHK][ERR] ${e?.message || e}`);
    }
  })();

  let inner = null;
  let queued = [];
  let ready = false;

  function pump(line) {
    if (!inner) { queued.push(line); return; }
    // Try multiple shapes to satisfy different Emscripten bridges
    try { inner.postMessage(line); } catch {}
    try { inner.postMessage(line.endsWith('\n') ? line : line + '\n'); } catch {}
    try { inner.postMessage({ cmd: line }); } catch {}
    try { inner.postMessage({ uci: line }); } catch {}
    try { inner.postMessage({ type:'cmd', cmd: line }); } catch {}
    try { inner.postMessage({ event:'stdin', data: (line.endsWith('\n')?line:line+'\n') }); } catch {}
    try { inner.postMessage({ stdin: (line.endsWith('\n')?line:line+'\n') }); } catch {}
  }
  function flush() {
    if (!inner || !queued.length) return;
    const lines = queued.slice(); queued.length = 0;
    for (const l of lines) pump(l);
  }

  function attachInnerCommon() {
    inner.addEventListener('error', (err) => {
      say(`[ENGINE][ERR] inner worker error: ${err?.message || String(err)}`);
    });
    inner.addEventListener('messageerror', () => {
      say('[ENGINE][ERR] inner worker messageerror');
    });
    inner.onmessage = (e) => {
      const d = e?.data;
      if (typeof d === 'string') {
        say(d);
        if (/uciok|readyok|option|id name|bestmove/i.test(d)) { ready = true; flush(); }
        return;
      }
      const s = d?.data || d?.line || d?.stdout;
      if (typeof s === 'string') {
        say(s);
        if (/uciok|readyok|option|id name|bestmove/i.test(s)) { ready = true; flush(); }
        return;
      }
      try { say('[ENGINE][OBJ] ' + JSON.stringify(d)); } catch {}
    };
  }

  // ---- Strategy A: external module worker (uci-loader.module.js) -----
  function tryExternalModuleWorker() {
    say(`[ENGINE][BRIDGE] spawning module worker: ${loaderURL.href}`);
    try {
      inner = new Worker(loaderURL, { type: 'module', name: 'fairy-stockfish-module' });
      attachInnerCommon();

      // Kick a few times
      ['uci','isready','uci','isready'].forEach((c,i)=>setTimeout(()=>pump(c), 40+i*120));

      // Safety watchdog
      setTimeout(() => {
        if (!ready) {
          say('[ENGINE][WARN] no UCI reply after 2500ms (external loader). Will try Blob fallback…');
          tryBlobModuleWorker(); // fall back
        }
      }, 2500);
    } catch (e) {
      say(`[ENGINE][ERR] external module spawn failed: ${e?.message || e}`);
      tryBlobModuleWorker();
    }
  }

  // ---- Strategy B: inline Blob module worker -------------------------
  function tryBlobModuleWorker() {
    try {
      const code = `
        const wasmAbs = ${JSON.stringify(wasmURL)};
        const engineURL = ${JSON.stringify(engJSURL)};
        self.Module = {
          locateFile(path){ return (wasmAbs && path.endsWith('.wasm')) ? wasmAbs : path; },
          print:    (line)=>{ try{ self.postMessage(String(line)); }catch{} },
          printErr: (line)=>{ try{ self.postMessage(String(line)); }catch{} },
        };
        // Top-level dynamic import for ESM engine
        (async () => {
          try {
            await import(engineURL);
            try { self.postMessage('[ENGINE][MODULE] online (blob)'); } catch {}
          } catch (e) {
            try { self.postMessage('[ENGINE][ERR] blob module import failed: ' + (e?.message||e)); } catch {}
          }
        })();
      `;
      const blob = new Blob([code], { type: 'text/javascript' });
      const url  = URL.createObjectURL(blob);

      say('[ENGINE][BRIDGE] spawning blob module worker…');
      inner = new Worker(url, { type: 'module', name: 'fairy-stockfish-blob' });
      attachInnerCommon();

      ['uci','isready','uci','isready'].forEach((c,i)=>setTimeout(()=>pump(c), 60+i*140));
      setTimeout(() => {
        if (!ready) {
          say('[ENGINE][LEGACY] giving up on module — remain in classic bridge mode');
        }
      }, 3000);
    } catch (e) {
      say(`[ENGINE][ERR] blob module spawn failed: ${e?.message || e}`);
      say('[ENGINE][LEGACY] Classic worker online (no module available)');
    }
  }

  // ---- Outer API (main thread -> this worker) ------------------------
  self.onmessage = (e) => {
    const d = e?.data;
    let line = null;
    if (typeof d === 'string') line = d;
    else if (d && typeof d.cmd   === 'string') line = d.cmd;
    else if (d && typeof d.uci   === 'string') line = d.uci;
    else if (d && typeof d.data  === 'string') line = d.data;
    else if (d && typeof d.stdin === 'string') line = d.stdin;
    if (!line) return;

    pump(line);
  };

  // ---- Boot -----------------------------------------------------------
  say('[ENGINE][BRIDGE] classic wrapper online');
  tryExternalModuleWorker();
})();
