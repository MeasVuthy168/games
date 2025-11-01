/* engine.worker.js — resilient UCI bridge for Fairy-Stockfish (Ouk Chatrang)
   Tries ESM factory first; if missing, falls back to spawning the JS as a worker.
   Handles BOTH string and object message protocols when nested-worker is used.
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

// Send a command to engine.
// In nested-worker mode we *fan out* both raw string and {cmd:...} to cover both protocols.
function send(cmd){
  if (!cmd) return;

  if (engine && typeof engine.postMessage === 'function') {
    engine.postMessage(cmd);
    return;
  }
  if (innerWorker) {
    try { innerWorker.postMessage(cmd); } catch {}
    try { innerWorker.postMessage({ cmd }); } catch {}
    return;
  }
  pending.push(cmd);
}

async function loadAsFactory(wrapURL, wURL){
  let mod;
  try{
    mod = await import(/* @vite-ignore */ wrapURL);
    note('Wrapper loaded as ES module.');
  }catch(e){
    note(`ESM import failed: ${e?.message || e}`);
    return null;
  }

  // Log exports for traceability
  try{
    const keys = Object.keys(mod || {});
    note(`ESM exports: ${keys.length ? keys.join(', ') : '(none)'}`);
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

  // Pipe stdout-ish lines to main thread
  if (typeof inst.addMessageListener === 'function'){
    inst.addMessageListener((line)=> postMessage({ type:'uci', line }));
  } else if (typeof inst.onmessage === 'function'){
    const prev = inst.onmessage;
    inst.onmessage = (line)=>{ try{ postMessage({ type:'uci', line }); }catch{} prev && prev(line); };
  } else if (typeof inst.addEventListener === 'function'){
    inst.addEventListener('message', (e)=> postMessage({ type:'uci', line: e?.data ?? '' }));
  }

  return inst;
}

async function loadAsNestedWorker(wrapURL){
  try{
    // Classic worker (most FSF distros are classic-worker scripts)
    innerWorker = new Worker(wrapURL);
    innerWorker.onmessage = (e)=>{
      // Many builds send strings; some send {type:'stdout', data:'...'}
      const data = e?.data;
      const line =
        (typeof data === 'string') ? data
        : (data && typeof data.data === 'string') ? data.data
        : (data && typeof data.stdout === 'string') ? data.stdout
        : (data && typeof data.line === 'string') ? data.line
        : (data != null ? String(data) : '');
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

  // 1) Prefer factory-based ESM (if the build supports it)
  const inst = await loadAsFactory(wrapURL, wURL);
  if (inst) {
    engine = inst;
    // Init UCI + variant (harmless if some options are unknown)
    send('uci');
    send('setoption name UCI_Variant value Ouk Chatrang');
    send('setoption name CountingRule value cambodian');
    send('isready');

    // Flush queued
    while (pending.length) engine.postMessage(pending.shift());
    note('Engine ready (factory mode).');
    return;
  }

  note('Factory export not found; trying nested worker fallback…');

  // 2) Nested worker: spawn the JS as a worker and bridge messages
  const ok = await loadAsNestedWorker(wrapURL);
  if (!ok) throw new Error('Could not initialize engine in any mode');

  // Initial UCI handshake; also send object-form to satisfy both protocols
  send('uci');                        send({ cmd: 'uci' });
  send('setoption name UCI_Variant value Ouk Chatrang'); send({ cmd: 'setoption name UCI_Variant value Ouk Chatrang' });
  send('setoption name CountingRule value cambodian');   send({ cmd: 'setoption name CountingRule value cambodian' });
  send('isready');                    send({ cmd: 'isready' });

  // Flush queued UCI lines in both forms
  while (pending.length){
    const p = pending.shift();
    try { innerWorker.postMessage(p); } catch {}
    try { innerWorker.postMessage({ cmd: p }); } catch {}
  }
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
