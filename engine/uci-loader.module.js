// engine/uci-loader.module.js
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

// Import the ESM engine (should bind a UCI onmessage).
import './fairy-stockfish.js';

try { self.postMessage('[ENGINE][MODULE] online'); } catch {}
