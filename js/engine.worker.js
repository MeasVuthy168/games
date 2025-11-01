// js/engine.worker.js
// Classic worker that spawns an inner *module* worker (uci-loader.module.js) to run the ESM engine.
// Bridges messages between main thread <-> inner module worker as UCI text lines.

(function () {
  const safePost = (s) => { try { postMessage(s); } catch {} };
  const log = (tag, ...a) => safePost(`${tag} ${a.join(' ')}`);

  // Build absolute URLs for /engine/ files based on this worker's URL.
  const here      = new URL(self.location.href);   // .../js/engine.worker.js?[v=...]
  const jsDir     = new URL('./', here);           // .../js/
  const repoRoot  = new URL('../', jsDir);         // .../
  const engineDir = new URL('engine/', repoRoot);  // .../engine/

  const wasmURL   = new URL('fairy-stockfish.wasm', engineDir).href;
  const loaderURL = new URL('uci-loader.module.js', engineDir);
  loaderURL.searchParams.set('wasm', wasmURL);

  let inner = null;
  let queue = [];
  let readySeen = false;
  let started   = false;

  function pump(cmd) {
    if (!inner) { queue.push(cmd); return; }
    // Send several shapes to satisfy different Emscripten UCI bridges
    try { inner.postMessage(cmd); } catch {}
    try { inner.postMessage(cmd.endsWith('\n') ? cmd : (cmd + '\n')); } catch {}
    try { inner.postMessage({ cmd }); } catch {}
    try { inner.postMessage({ uci: cmd }); } catch {}
    try { inner.postMessage({ type:'cmd', cmd }); } catch {}
    try { inner.postMessage({ event:'stdin', data:(cmd.endsWith('\n')?cmd:cmd+'\n') }); } catch {}
    try { inner.postMessage({ stdin:(cmd.endsWith('\n')?cmd:cmd+'\n') }); } catch {}
  }

  function flush() {
    if (!inner || !queue.length) return;
    const lines = queue.slice(); queue.length = 0;
    for (const l of lines) pump(l);
  }

  function startInner() {
    if (started) return;
    started = true;

    try {
      inner = new Worker(loaderURL, { type: 'module', name: 'fairy-stockfish-module' });
      log('[ENGINE][BRIDGE]', 'Spawning module worker:', loaderURL.href);

      // If module worker fails to load (404 or syntax), we’ll see an 'error' event.
      inner.addEventListener('error', (err) => {
        log('[ENGINE][ERR]', 'Module worker error:', err?.message || String(err));
        legacyFallback('module worker error');
      });

      // Some browsers emit messageerror on bad postMessage payloads
      inner.addEventListener('messageerror', (e) => {
        log('[ENGINE][ERR]', 'messageerror from module worker');
      });

      // Pipe module worker stdout up to main thread. Look for UCI markers.
      inner.onmessage = (e) => {
        const d = e?.data;

        if (typeof d === 'string') {
          safePost(d);
          if (/uciok|readyok|option|id name|bestmove/i.test(d)) {
            readySeen = true;
            flush();
          }
          return;
        }

        // Some ports send objects
        const s = d?.data || d?.line || d?.stdout;
        if (typeof s === 'string') {
          safePost(s);
          if (/uciok|readyok|option|id name|bestmove/i.test(s)) {
            readySeen = true;
            flush();
          }
          return;
        }

        // Last-resort visibility
        try { safePost('[ENGINE][OBJ] ' + JSON.stringify(d)); } catch {}
      };

      // Kick the engine repeatedly until it answers.
      const kicks = ['uci', 'isready', 'uci', 'isready'];
      kicks.forEach((c, i) => setTimeout(() => pump(c), 40 + i * 120));
      log('[ENGINE][BRIDGE]', 'Module worker requested');

      // Safety timeout: if we never see any reply, reveal fallback cause.
      setTimeout(() => {
        if (!readySeen) {
          log('[ENGINE][WARN]', 'No UCI reply from module after 2.5s — possible 404 or unsupported module worker.');
        }
      }, 2500);

    } catch (e) {
      log('[ENGINE][ERR]', 'Spawn failed:', e?.message || String(e));
      legacyFallback('spawn exception');
    }
  }

  function legacyFallback(reason) {
    // Tell the main thread we’re alive (legacy), so app won’t hang.
    log('[ENGINE][LEGACY]', `Classic worker online (${reason})`);
    // You could implement a minimal JS engine here if desired.
  }

  // Outer worker API (main thread -> this worker)
  self.onmessage = (e) => {
    const d = e?.data;
    let line = null;

    if (typeof d === 'string') line = d;
    else if (d && typeof d.cmd   === 'string') line = d.cmd;
    else if (d && typeof d.uci   === 'string') line = d.uci;
    else if (d && typeof d.data  === 'string') line = d.data;
    else if (d && typeof d.stdin === 'string') line = d.stdin;

    if (!line) return;

    if (!inner) queue.push(line);
    else pump(line);
  };

  // Boot this wrapper
  log('[ENGINE][BRIDGE]', 'Classic wrapper online');
  startInner();
})();
