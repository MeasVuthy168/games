/* engine/fairy-stockfish.bridge.js
   Classic worker shim to preset Emscripten Module *before* loading the engine.
   It passes the .wasm absolute URL via the worker URL query (?wasm=...).
*/

(function(){
  const url = new URL(self.location.href);
  const wasmAbs = url.searchParams.get('wasm'); // absolute wasm url from factory

  // Preconfigure Emscripten before engine loads
  self.Module = {
    locateFile(path){
      // When the engine asks for its .wasm, give our absolute URL
      if (wasmAbs && typeof path === 'string' && path.endsWith('.wasm')) return wasmAbs;
      return path;
    },
    // If this port uses print/printErr, forward them to main thread
    print:   (line)=>{ try{ self.postMessage(String(line)); }catch{} },
    printErr:(line)=>{ try{ self.postMessage(String(line)); }catch{} },
  };

  // Load the legacy classic worker script AFTER Module is set
  importScripts('./fairy-stockfish.js');
})();
