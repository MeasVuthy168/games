// js/engine.worker.js
// Classic worker entry that spawns an *inner* MODULE worker to run the ESM engine.
// Bridges messages between main thread <-> inner module worker (UCI text lines).

(function () {
  const log = (...a) => { try { postMessage(a.join(' ')); } catch {} };

  // Resolve absolute URLs for engine dir + wasm
  const here     = new URL(self.location.href);
  // Repo base like https://measvuthy168.github.io/games/
  // Assuming this file lives at .../js/engine.worker.js
  const base     = new URL('./', here);                 // .../js/
  const root     = new URL('../', base);                // repo root of / (one up from js/)
  const engineDir= new URL('engine/', root);            // .../engine/

  const wasmURL  = new URL('fairy-stockfish.wasm', engineDir).href;
  const loaderURL= new URL('uci-loader.module.js', engineDir);
  loaderURL.searchParams.set('wasm', wasmURL);

  let inner = null;
  let ready = false;
  let queue = [];

  function pump(cmd) {
    // Robust send variants (some Emscripten ports accept different shapes)
    try { inner.postMessage(cmd); } catch {}
    try { inner.postMessage(cmd.endsWith('\n') ? cmd : (cmd + '\n')); } catch {}
    try { inner.postMessage({ cmd }); } catch {}
    try { inner.postMessage({ type:'cmd', cmd }); } catch {}
    try { inner.postMessage({ uci: cmd }); } catch {}
    try { inner.postMessage({ event:'stdin', data:(cmd.endsWith('\n')?cmd:cmd+'\n') }); } catch {}
    try { inner.postMessage({ stdin:(cmd.endsWith('\n')?cmd:cmd+'\n') }); } catch {}
  }

  function flushQueue() {
    if (!inner) return;
    for (const s of queue) pump(s);
    queue.length = 0;
  }

  function startInner() {
    try {
      // Spawn MODULE worker that can import the ESM engine
      inner = new Worker(loaderURL, { type: 'module', name: 'fairy-stockfish-module' });
      log('[ENGINE] [BRIDGE] Spawning module worker:', loaderURL.href);

      inner.onmessage = (e) => {
        const d = e?.data;

        // Heuristics: treat *any* string line as engine stdout (push up to main thread)
        if (typeof d === 'string') {
          postMessage(d);

          // Toggle "ready" once we see common UCI tokens
          if (/uciok|readyok|option|id name|bestmove/i.test(d)) {
            ready = true;
            flushQueue();
          }
          return;
        }

        // Some builds send structured objects
        const s = d?.data || d?.line || d?.stdout;
        if (typeof s === 'string') {
          postMessage(s);
          if (/uciok|readyok|option|id name|bestmove/i.test(s)) {
            ready = true;
            flushQueue();
          }
          return;
        }

        try { postMessage('[ENGINE][OBJ] ' + JSON.stringify(d)); } catch {}
      };

      inner.onerror = (err) => {
        try { postMessage('[ENGINE][ERR] Module worker error: ' + (err?.message||String(err))); } catch {}
      };

      // Proactively prime UCI several times
      const kicks = ['uci', 'isready', 'uci', 'isready'];
      kicks.forEach((c, i) => setTimeout(() => { pump(c); }, 50 + i*120));

      postMessage('[ENGINE] [BRIDGE] Module worker requested');
    } catch (e) {
      // Last resort: classic “fake” online so app doesn’t crash.
      postMessage('[ENGINE] [LEGACY] Classic worker online (module spawn failed)');
    }
  }

  // Main-thread -> outer worker messages
  self.onmessage = (e) => {
    const data = e?.data;
    let line = null;

    if (typeof data === 'string') line = data;
    else if (data && typeof data.cmd === 'string') line = data.cmd;
    else if (data && typeof data.uci === 'string') line = data.uci;
    else if (data && typeof data.data === 'string') line = data.data;
    else if (data && typeof data.stdin === 'string') line = data.stdin;

    if (!line) return;

    if (inner) {
      pump(line);
    } else {
      // Queue until inner is up
      queue.push(line);
    }
  };

  // Boot
  postMessage('[ENGINE] [BRIDGE] Classic wrapper online');
  startInner();

})();
