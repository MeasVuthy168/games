// engine/uci-loader.module.js
// Module worker that sets Emscripten's Module hooks, then imports the ESM engine.
// It relies on the parent (outer) worker to send UCI commands like 'uci', 'isready', etc.

const params  = new URL(self.location.href).searchParams;
const wasmAbs = params.get('wasm') || '';

self.Module = {
  locateFile(path) {
    if (wasmAbs && typeof path === 'string' && path.endsWith('.wasm')) return wasmAbs;
    return path;
  },
  print:    (line) => { try { self.postMessage(String(line)); } catch {} },
  printErr: (line) => { try { self.postMessage(String(line)); } catch {} },
};

// Import the ESM engine. It should register its own self.onmessage handler (UCI).
import './fairy-stockfish.js';

// Let parent know we’re alive.
try { self.postMessage('[ENGINE][MODULE] online'); } catch {}
