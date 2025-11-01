// engine/fairy-stockfish.factory.js
// Spawns a MODULE worker loader that sets Module.locateFile, then imports the ESM engine.

export async function FairyStockfish(options = {}) {
  const wasmURL = options.wasmPath || new URL('./fairy-stockfish.wasm', import.meta.url).href;

  // Prefer the module-loader (handles ESM correctly)
  const loaderURL = new URL('./uci-loader.module.js', import.meta.url);
  loaderURL.searchParams.set('wasm', wasmURL);

  let w;
  try {
    w = new Worker(loaderURL, { type: 'module', name: 'fairy-stockfish-module' });
  } catch (e) {
    // Fallback to your previous classic bridge if a very old browser (unlikely on iOS 16+)
    const bridgeURL = new URL('./fairy-stockfish.bridge.js', import.meta.url);
    bridgeURL.searchParams.set('wasm', wasmURL);
    w = new Worker(bridgeURL, { type: 'classic', name: 'fairy-stockfish-bridge' });
  }

  const listeners = new Set();
  const addMessageListener = (fn) => { if (typeof fn === 'function') listeners.add(fn); };

  // Fan out any worker text lines to listeners (debug panel)
  w.addEventListener('message', (e) => {
    const d = e?.data;
    if (typeof d === 'string') { for (const fn of listeners) try { fn(d) } catch {} ; return; }
    // Try common shapes
    const s = d?.data || d?.line || d?.stdout;
    if (typeof s === 'string') { for (const fn of listeners) try { fn(s) } catch {} ; return; }
    try { const s2 = '[obj] ' + JSON.stringify(d); for (const fn of listeners) try { fn(s2) } catch {} } catch {}
  });

  // Ultra-compatible sender (covers most UCI glue variants)
  function postMessage(cmd) {
    if (typeof cmd !== 'string' || !cmd) return;
    const s   = cmd;
    const sNL = s.endsWith('\n') ? s : (s + '\n');
    try { w.postMessage(s); } catch {}
    try { w.postMessage(sNL); } catch {}
    try { w.postMessage({ cmd: s }); } catch {}
    try { w.postMessage({ type: 'cmd', cmd: s }); } catch {}
    try { w.postMessage({ uci: s }); } catch {}
    try { w.postMessage({ event: 'stdin', data: sNL }); } catch {}
    try { w.postMessage({ stdin: sNL }); } catch {}
  }

  // Prime UCI a few times to wake engines that wait for multiple pings
  let primed = false;
  const prime = () => {
    if (primed) return; primed = true;
    setTimeout(() => { try { postMessage('uci');     } catch {} },  30);
    setTimeout(() => { try { postMessage('isready'); } catch {} }, 120);
    setTimeout(() => { try { postMessage('uci');     } catch {} }, 250);
  };
  prime();

  // Announce so you can see it in the debug console
  setTimeout(() => { for (const fn of listeners) try { fn('[LEGACY] Module worker requested') } catch {} }, 0);

  return {
    postMessage,               // send UCI lines
    addMessageListener,        // subscribe to engine text lines
    terminate: () => { try { w.terminate(); } catch {} }
  };
}

export default FairyStockfish;
