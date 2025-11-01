/* fairy-stockfish.factory.js — ESM shim that exposes a factory returning a
   bridge to the legacy classic Worker (engine/fairy-stockfish.js).
   It normalizes command formats for various FSF builds.

   Returns a Promise of:
     {
       postMessage(cmd:string): void,      // send UCI command
       addMessageListener(fn): void,       // subscribe to stdout lines
       terminate(): void
     }
*/

export async function FairyStockfish(options = {}){
  const wasmURL = options.wasmPath || null;

  // Spawn vendor worker (classic)
  const workerURL = new URL('./fairy-stockfish.js', import.meta.url);
  const w = new Worker(workerURL, { type: 'classic', name: 'fairy-stockfish-legacy' });

  // Hint wasm path (ignored by some builds; harmless if so)
  if (wasmURL){
    try { w.postMessage({ type: 'wasmPath', path: wasmURL }); } catch {}
    try { w.postMessage({ wasmPath: wasmURL }); } catch {}
  }

  // Listeners
  const listeners = new Set();
  const addMessageListener = (fn) => { if (typeof fn === 'function') listeners.add(fn); };

  // Normalize outputs to "line" strings
  w.addEventListener('message', (e)=>{
    let line = e?.data;

    // Many ports send raw strings already; keep them
    if (typeof line === 'string') {
      for (const fn of listeners) { try{ fn(line); }catch{} }
      return;
    }

    // Some send objects like { type:'stdout', data:'...' }
    if (line && typeof line === 'object'){
      if (typeof line.data === 'string') {
        for (const fn of listeners) { try{ fn(line.data); }catch{} }
        return;
      }
      // Or { line:'...' }
      if (typeof line.line === 'string'){
        for (const fn of listeners) { try{ fn(line.line); }catch{} }
        return;
      }
      // Last resort: show JSON for visibility
      try {
        const s = JSON.stringify(line);
        for (const fn of listeners) { try{ fn(s); }catch{} }
      } catch {}
    }
  });

  // Robust command sender: try multiple formats many FSF builds accept
  function postMessage(cmd){
    if (typeof cmd !== 'string' || !cmd) return;

    // 1) Plain string
    try { w.postMessage(cmd); } catch {}

    // 2) String + newline (some parsers prefer \n)
    try { w.postMessage(cmd.endsWith('\n') ? cmd : (cmd + '\n')); } catch {}

    // 3) Emscripten-style objects seen in some forks
    try { w.postMessage({ cmd }); } catch {}
    try { w.postMessage({ type: 'cmd', cmd }); } catch {}
    try { w.postMessage({ uci: cmd }); } catch {}
  }

  // Small hello so you can confirm the shim is alive
  setTimeout(()=>{
    for (const fn of listeners) { try{ fn('[LEGACY] Classic worker online'); }catch{} }
  }, 0);

  // Optional: kick the engine (harmless if duplicates come later)
  setTimeout(()=>{
    // Some builds are passive until first input; this wakes them.
    try { postMessage('uci'); } catch {}
  }, 30);

  return {
    postMessage,
    addMessageListener,
    terminate: ()=>{ try{ w.terminate(); }catch{} }
  };
}

export default FairyStockfish;
