// engine/uci-loader.module.js
// A tiny *module worker* that pre-sets Emscripten Module, then imports the ESM engine.

const url = new URL(self.location.href);
const wasmAbs = url.searchParams.get('wasm'); // absolute .wasm URL passed by factory

// 1) Preconfigure Emscripten *before* the engine module is imported
self.Module = {
  locateFile(path) {
    if (wasmAbs && typeof path === 'string' && path.endsWith('.wasm')) return wasmAbs;
    return path;
  },
  // Optional logging passthrough for debug panel:
  print:   (line) => { try { self.postMessage(String(line)); } catch {} },
  printErr:(line) => { try { self.postMessage(String(line)); } catch {} },
};

// 2) Import the engine ESM (this file must be ESM-compatible)
import './fairy-stockfish.js';

// 3) Nudge UCI on slow ports (engine should have installed its onmessage by now)
setTimeout(() => {
  try { self.postMessage('[LEGACY] Module worker online'); } catch {}
  // Many Emscripten UCI builds respond to string commands sent via postMessage
  try { self.onmessage?.({ data: 'uci' }); } catch {}
  // If the engine expects messages *from main thread only*, our factory will send them.
}, 0);
