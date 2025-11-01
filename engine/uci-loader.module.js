// engine/uci-loader.module.js
// Module worker that preconfigures Emscripten Module + imports the ESM engine.
// Receives ?wasm=<abs-url> in the query; uses postMessage to echo stdout for debug.

const params = new URL(self.location.href).searchParams;
const wasmAbs = params.get('wasm');

self.Module = {
  locateFile(path) {
    if (wasmAbs && typeof path === 'string' && path.endsWith('.wasm')) return wasmAbs;
    return path;
  },
  print:   (line) => { try { self.postMessage(String(line)); } catch {} },
  printErr:(line) => { try { self.postMessage(String(line)); } catch {} },
};

// Import the ESM build. It should install its own onmessage UCI handler.
import './fairy-stockfish.js';

// Nudge slow initializers
setTimeout(() => {
  try { self.postMessage('[ENGINE][MODULE] online'); } catch {}
  try { self.postMessage('uci'); } catch {}
  try { self.postMessage('isready'); } catch {}
}, 0);
