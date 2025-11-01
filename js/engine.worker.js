// js/engine.worker.js — Classic single worker that hosts Fairy-Stockfish directly.
// No nested/module worker. We set Module.locateFile so the WASM loads from our absolute URL,
// then import the Emscripten build and nudge it with "uci"/"isready".

(function () {
  const say = (m) => { try { postMessage(m); } catch {} };

  // Resolve …/js/ → …/ (repo root), then …/engine/
  const here      = new URL(self.location.href);       // …/js/engine.worker.js?...
  const jsDir     = new URL('./', here);               // …/js/
  const rootDir   = new URL('../', jsDir);             // …/
  const engineDir = new URL('engine/', rootDir);       // …/engine/

  const wasmAbs   = new URL('fairy-stockfish.wasm', engineDir).href;
  const engineJS  = new URL('fairy-stockfish.js', engineDir).href;

  say(`[ENGINE] [CLASSIC] Booting single-worker`);
  say(`[ENGINE] [CLASSIC] WASM: ${wasmAbs}`);
  say(`[ENGINE] [CLASSIC] JS:   ${engineJS}`);

  // Emscripten hooks so the engine prints into our worker -> main thread log
  self.Module = {
    locateFile(path) {
      if (typeof path === 'string' && path.endsWith('.wasm')) return wasmAbs;
      return path;
    },
    print   : (line) => { try { postMessage(String(line)); } catch {} },
    printErr: (line) => { try { postMessage(String(line)); } catch {} },
  };

  // Some ports read self.FS_* environment style hints – harmless to set:
  try { self.FS_WASM_URL = wasmAbs; } catch {}

  // Load the engine script (classic worker style). It usually installs its own onmessage handler
  // for UCI and starts responding to "uci"/"isready".
  try {
    importScripts(engineJS);
    say('[ENGINE] [CLASSIC] Engine script imported');
  } catch (e) {
    say(`[ENGINE][ERR] importScripts failed: ${e?.message || e}`);
  }

  // If the port didn't auto-start, poke it a few times.
  const kicks = ['uci', 'isready', 'uci', 'isready'];
  kicks.forEach((cmd, i) => setTimeout(() => {
    try { postMessage(`[ENGINE] [CLASSIC] kick: ${cmd}`); } catch {}
    // Many Emscripten UCI builds read raw strings on onmessage
    try { self.postMessage(cmd); } catch {}
    // Some read structured { cmd } objects
    try { self.onmessage && self.onmessage({ data: { cmd } }); } catch {}
  }, 50 + i * 120));

  // Bridge main->engine: forward any line-like commands to the engine as generously as possible
  self.onmessage = (e) => {
    const d = e?.data;
    let line = null;
    if (typeof d === 'string') line = d;
    else if (d && typeof d.cmd === 'string') line = d.cmd;
    else if (d && typeof d.uci === 'string') line = d.uci;
    else if (d && typeof d.data === 'string') line = d.data;
    else if (d && typeof d.stdin === 'string') line = d.stdin;
    if (!line) return;

    // Try multiple shapes; different builds accept different forms
    try { self.postMessage(line); } catch {}
    try { self.postMessage(line.endsWith('\n') ? line : line + '\n'); } catch {}
    try { self.postMessage({ cmd: line }); } catch {}
    try { self.postMessage({ uci: line }); } catch {}
    try { self.postMessage({ event: 'stdin', data: (line.endsWith('\n') ? line : line + '\n') }); } catch {}
    try { self.postMessage({ stdin: (line.endsWith('\n') ? line : line + '\n') }); } catch {}
  };

  // Heartbeat so your debug panel shows we’re alive
  try { postMessage('[ENGINE] [CLASSIC] Worker online'); } catch {}
})();
