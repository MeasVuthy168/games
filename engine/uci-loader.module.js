// engine/uci-loader.module.js
// ESM loader: sets locateFile and stdout; no auto-kicks.

const params = new URL(self.location.href).searchParams;
const wasmAbs = params.get('wasm') || '';

self.Module = {
  locateFile(p){ return (wasmAbs && typeof p==='string' && p.endsWith('.wasm')) ? wasmAbs : p; },
  print(l){ try{ self.postMessage(String(l)); }catch{} },
  printErr(l){ try{ self.postMessage(String(l)); }catch{} },
};

// Import ESM engine. It may install its own onmessage handler.
import './fairy-stockfish.js';
