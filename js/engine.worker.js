// js/engine.worker.js — Classic single worker hosting Fairy-Stockfish directly.
// We set Module.locateFile so the .wasm absolute URL is used, import the engine JS,
// then forward UCI strings back and forth.

(function () {
  const say = (m) => { try { postMessage(m); } catch {} };

  // Resolve …/js/ → …/ (root), then …/engine/
  const here      = new URL(self.location.href);       // …/js/engine.worker.js?...
  const jsDir     = new URL('./', here);               // …/js/
  const rootDir   = new URL('../', jsDir);             // …/
  const engineDir = new URL('engine/', rootDir);       // …/engine/

  const wasmAbs   = new URL('fairy-stockfish.wasm', engineDir).href;
  const engineJS  = new URL('fairy-stockfish.js', engineDir).href;

  say('[ENGINE] [CLASSIC] Worker online');
  say(`[ENGINE] [CLASSIC] WASM: ${wasmAbs}`);
  say(`[ENGINE] [CLASSIC] JS:   ${engineJS}`);

  // Emscripten config so the engine prints back to this worker -> main thread
  self.Module = {
    locateFile(path) {
      if (typeof path === 'string' && path.endsWith('.wasm')) return wasmAbs;
      return path;
    },
    print   : (line) => { try { postMessage(String(line)); } catch {} },
    printErr: (line) => { try { postMessage(String(line)); } catch {} },
  };

  try {
    importScripts(engineJS); // loads the engine build; most ports install their own onmessage handler
    say('[ENGINE] [CLASSIC] Engine script imported');
  } catch (e) {
    say(`[ENGINE][ERR] importScripts failed: ${e?.message || e}`);
  }

  // If the port didn’t auto-start, poke it a couple of times.
  const kicks = ['uci', 'isready'];
  kicks.forEach((cmd, i) => setTimeout(() => {
    try { postMessage(`[ENGINE] [CLASSIC] kick: ${cmd}`); } catch {}
    try { self.postMessage(cmd); } catch {}
    try { self.onmessage && self.onmessage({ data: cmd }); } catch {}
  }, 60 + i * 140));

  // Main thread -> engine: forward broad shapes the port might accept
  self.onmessage = (e) => {
    const d = e?.data;
    let line = null;
    if (typeof d === 'string') line = d;
    else if (d && typeof d.cmd === 'string') line = d.cmd;
    else if (d && typeof d.uci === 'string') line = d.uci;
    else if (d && typeof d.data === 'string') line = d.data;
    else if (d && typeof d.stdin === 'string') line = d.stdin;
    if (!line) return;

    try { self.postMessage(line); } catch {}
    try { self.postMessage(line.endsWith('\n') ? line : line + '\n'); } catch {}
    try { self.postMessage({ cmd: line }); } catch {}
    try { self.postMessage({ uci: line }); } catch {}
    try { self.postMessage({ event:'stdin', data:(line.endsWith('\n')?line:line+'\n') }); } catch {}
    try { self.postMessage({ stdin:(line.endsWith('\n')?line:line+'\n') }); } catch {}
  };
})();
