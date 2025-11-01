// engine/uci-loader.module.js
// ESM loader that:
// 1) injects locateFile() so WASM can be loaded from an absolute URL
// 2) imports the raw Emscripten build (fairy-stockfish.js)
// 3) imports a small factory-detector shim (fairy-stockfish.factory.js)
// 4) imports a UCI bridge that binds engine <-> worker messaging
// After the bridge is active, we nudge the engine with "uci"/"isready".

const params  = new URL(self.location.href).searchParams;
const wasmAbs = params.get('wasm') || '';

self.Module = {
  locateFile(path) {
    if (wasmAbs && typeof path === 'string' && path.endsWith('.wasm')) return wasmAbs;
    return path;
  },
  print   : (line) => { try { self.postMessage(String(line)); } catch {} },
  printErr: (line) => { try { self.postMessage(String(line)); } catch {} },
};

// 1) Load the Emscripten output (this usually registers a global factory or Module)
import './fairy-stockfish.js';

// 2) Detect whichever global the build exposed and save as __FS_FACTORY__
import './fairy-stockfish.factory.js';

// 3) Install the UCI bridge that creates/awaits the engine instance and wires onmessage
import './fairy-stockfish.bridge.js';

// 4) Small nudge so outer wrapper sees activity quickly
try { self.postMessage('[ENGINE][MODULE] online'); } catch {}
try { self.postMessage('uci'); } catch {}
try { self.postMessage('isready'); } catch {}
