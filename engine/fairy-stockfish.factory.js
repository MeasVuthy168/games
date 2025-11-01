/* fairy-stockfish.factory.js — ESM shim that exposes a factory returning a
   bridge to the legacy classic Worker (engine/fairy-stockfish.js).

   Why: Your vendor file is classic-worker-ready but has **no ESM exports**.
   This shim lets engine.worker.js (an ESM worker) load it safely and still
   talk UCI with it.

   Returns:
     FairyStockfish(options) -> Promise<{
       postMessage: (cmd:string)=>void,
       addMessageListener: (fn:(line:string)=>void)=>void,
       terminate: ()=>void
     }>
*/

export async function FairyStockfish(options = {}){
  const wasmURL = options.wasmPath || null;

  // Spawn the legacy classic Worker directly
  const workerURL = new URL('./fairy-stockfish.js', import.meta.url);
  const w = new Worker(workerURL, { type: 'classic', name: 'fairy-stockfish-legacy' });

  // If your build supports configuring wasm path via message, do it.
  // Many stockfish/fairy builds auto-resolve .wasm next to .js, so this is optional.
  if (wasmURL){
    try {
      // Several ports accept this convention:
      //   w.postMessage({ type:'wasmPath', path: wasmURL })
      // If your build ignores it, it's harmless.
      w.postMessage({ type: 'wasmPath', path: wasmURL });
    } catch {}
  }

  // Bridge: convert Worker 'message' events into plain lines for UCI
  const listeners = new Set();
  const addMessageListener = (fn) => { if (typeof fn === 'function') listeners.add(fn); };

  w.addEventListener('message', (e)=>{
    let line = e?.data;
    // Some builds send objects; normalize to string if needed
    if (typeof line === 'object' && line !== null){
      if (typeof line.line === 'string') line = line.line;
      else line = JSON.stringify(line);
    }
    if (typeof line !== 'string') return;
    for (const fn of listeners) { try{ fn(line); }catch{} }
  });

  // Post UCI commands (string form)
  const postMessage = (cmd) => {
    if (typeof cmd !== 'string') return;
    w.postMessage(cmd);
  };

  // Small hello so your debug console can confirm boot
  // (This will appear as a normal UCI line on the outer worker)
  // We mimic a friendly preface:
  setTimeout(()=> {
    for (const fn of listeners) { try{ fn('[LEGACY] Classic worker online'); }catch{} }
  }, 0);

  return {
    postMessage,
    addMessageListener,
    terminate: ()=> { try{ w.terminate(); }catch{} }
  };
}

export default FairyStockfish;
