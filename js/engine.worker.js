/* engine.worker.js — resilient UCI bridge for Fairy-Stockfish (Ouk Chatrang)
   Tries ESM factory first; if missing, falls back to spawning the JS as a worker.
   Expected files (relative to /games/):
     engine/fairy-stockfish.js
     engine/fairy-stockfish.wasm
*/

let engine = null;           // factory-based instance (if any)
let innerWorker = null;      // fallback: nested worker
let loadPromise = null;
const pending = [];

function note(msg){ postMessage({ type:'uci', line: `[WORKER] ${msg}` }); }

function wasmURL(){ return new URL('../engine/fairy-stockfish.wasm', self.location).href; }
function jsURL(){   return new URL('../engine/fairy-stockfish.js',  self.location).href; }

function send(cmd){
  if (engine && typeof engine.postMessage === 'function') {
    engine.postMessage(cmd);
  } else if (innerWorker) {
    innerWorker.postMessage(cmd); // direct UCI line
  } else {
    pending.push(cmd);
  }
}

async function loadAsFactory(wrapURL, wURL){
  let mod;
  // Try ESM import
  try{
    mod = await import(/* @vite-ignore */ wrapURL);
    note('Wrapper loaded as ES module.');
  }catch(e){
    note(`ESM import failed: ${e?.message || e}`);
    return null;
  }

  // Dump available exports for debugging
  try{
    const keys = Object.keys(mod || {});
    note(`ESM exports: ${keys.length ? keys.join(', ') : '(none)'}`);
    // Also log typeof for the common suspects
    const suspects = {
      default: typeof mod?.default,
      FairyStockfish: typeof mod?.FairyStockfish,
      Stockfish: typeof mod?.Stockfish
    };
    note(`ESM suspects typeof: default=${suspects.default}, FairyStockfish=${suspects.FairyStockfish}, Stockfish=${suspects.Stockfish}`);
  }catch{}

  const factory =
    (typeof mod?.default        === 'function' && mod.default) ||
    (typeof mod?.FairyStockfish === 'function' && mod.FairyStockfish) ||
    (typeof mod?.Stockfish      === 'function' && mod.Stockfish) ||
    (typeof self.FairyStockfish === 'function' && self.FairyStockfish) ||
    (typeof self.Stockfish      === 'function' && self.Stockfish) || null;

  if (!factory) return null;

  const inst = await factory({
    locateFile: (p) => (p.endsWith('.wasm') ? wURL : p)
  });

  // Wire output
  if (typeof inst.addMessageListener === 'function'){
    inst.addMessageListener((line)=> postMessage({ type:'uci', line }));
  } else if (typeof inst.onmessage === 'function'){
    const prev = inst.onmessage;
    inst.onmessage = (line)=>{ try{ postMessage({ type:'uci', line }); }catch{} prev && prev(line); };
  } else if (typeof inst.addEventListener === 'function'){
    inst.addEventListener('message', (e)=> postMessage({ type:'uci', line: e.data }));
  }

  return inst;
}

async function loadAsNestedWorker(wrapURL){
  try{
    // Spawn the stockfish JS as its own worker; many builds are worker scripts.
    innerWorker = new Worker(wrapURL); // classic worker
    innerWorker.onmessage = (e)=>{
      const line = (e && e.data) || '';
      postMessage({ type:'uci', line });
    };
    note('Nested worker mode engaged (JS acts as UCI engine).');
    return true;
  }catch(e){
    note(`Nested worker failed: ${e?.message || e}`);
    return false;
  }
}

async function loadEngine(){
  note('Booting…');
  const wrapURL = jsURL();
  const wURL    = wasmURL();
  note(`Loading WASM wrapper: ${wrapURL}`);
  note(`WASM URL: ${wURL}`);

  // 1) Try factory-based engine via ESM
  const inst = await loadAsFactory(wrapURL, wURL);
  if (inst) {
    engine = inst;
    // Init UCI + variant
    send('uci');
    send('setoption name UCI_Variant value Ouk Chatrang');
    // optional, harmless if unsupported
    send('setoption name CountingRule value cambodian');
    send('isready');

    // Flush queued commands
    while (pending.length) engine.postMessage(pending.shift());
    note('Engine ready (factory mode).');
    return;
  }

  note('Factory export not found; trying nested worker fallback…');

  // 2) Fallback: spawn the JS as a worker and bridge
  const ok = await loadAsNestedWorker(wrapURL);
  if (!ok) throw new Error('Could not initialize engine in any mode');

  // In nested worker mode, we still send init lines (many builds accept them)
  send('uci');
  send('setoption name UCI_Variant value Ouk Chatrang');
  send('setoption name CountingRule value cambodian');
  send('isready');

  // Flush queued UCI lines
  while (pending.length) innerWorker.postMessage(pending.shift());
  note('Engine ready (nested worker mode).');
}

self.onmessage = (e)=>{
  const { cmd } = e.data || {};
  if (!loadPromise){
    loadPromise = loadEngine().catch(err=>{
      note(`ERROR: ${err?.message || err}`);
    });
  }
  if (cmd) send(cmd);
};

// Kick immediately
loadPromise = loadEngine().catch(err=> note(`ERROR: ${err?.message || err}`));
