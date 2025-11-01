// engine/uci-loader.module.js
// ES module loader for Emscripten build: sets locateFile + stdout and imports the engine.

const params = new URL(self.location.href).searchParams;
const wasmAbs = params.get('wasm') || '';

self.Module = {
  locateFile(p) {
    if (wasmAbs && typeof p === 'string' && p.endsWith('.wasm')) return wasmAbs;
    return p;
  },
  print(line)    { try { self.postMessage(String(line)); } catch {} },
  printErr(line) { try { self.postMessage(String(line)); } catch {} },
};

// NOTE: The ESM build should itself wire UCI (stdin via onmessage, stdout via print)
// If it instead exports a factory, the outer bridge will fallback to the classic shim.
import './fairy-stockfish.js';

// Nudge slow initializers a bit (harmless if already active)
setTimeout(() => {
  try { self.postMessage('[ENGINE][MODULE] online'); } catch {}
  try { self.postMessage('uci'); } catch {}
  try { self.postMessage('isready'); } catch {}
}, 0);
