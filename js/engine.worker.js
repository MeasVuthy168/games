/* engine.worker.js — UCI worker wrapper for Fairy-Stockfish (Ouk Chatrang)
   Loads both ESM and classic builds, detects multiple factory names,
   and wires stdout to postMessage.

   Expected files (relative to /games/):
   - engine/fairy-stockfish.js
   - engine/fairy-stockfish.wasm
*/

let engine = null;
let loadPromise = null;
const pending = [];

// small logger into the main page debug console
function note(msg){ postMessage({ type:'uci', line: `[WORKER] ${msg}` }); }

function wasmURL(){ return new URL('../engine/fairy-stockfish.wasm', self.location).href; }
function jsURL(){   return new URL('../engine/fairy-stockfish.js',  self.location).href; }

async function loadEngine(){
  note('Booting…');
  const wrapURL = jsURL();
  const wURL    = wasmURL();
  note(`Loading WASM wrapper: ${wrapURL}`);
  note(`WASM URL: ${wURL}`);

  let mod;
  // Try as ES module first
  try{
    mod = await import(/* @vite-ignore */ wrapURL);
    note('Wrapper loaded as ES module.');
  }catch(e){
    note(`ESM import failed (${e?.message || e}). Trying classic importScripts…`);
    try{
      // Classic script defines globals on self
      importScripts(wrapURL);
      mod = self;
      note('Wrapper loaded via classic importScripts.');
    }catch(e2){
      throw new Error(`Failed to load fairy-stockfish.js: ${e2?.message || e2}`);
    }
  }

  // Detect the factory function under common names
  const factory = (
    mod?.default ||
    mod?.FairyStockfish ||
    mod?.Stockfish ||
    self.FairyStockfish ||
    self.Stockfish
  );

  if (typeof factory !== 'function'){
    throw new Error('Could not find engine factory export on fairy-stockfish.js');
  }

  // Instantiate the engine object
  const inst = await factory({
    locateFile: (p) => (p.endsWith('.wasm') ? wURL : p)
  });

  // Wire output -> main thread
  if (typeof inst.addMessageListener === 'function'){
    inst.addMessageListener((line)=> postMessage({ type:'uci', line }));
  } else if (typeof inst.onmessage === 'function'){
    // Some builds expose onmessage setter
    const old = inst.onmessage;
    inst.onmessage = (line)=> {
      try{ postMessage({ type:'uci', line }); }catch{}
      if (old) old(line);
    };
  } else if (typeof inst.addEventListener === 'function'){
    inst.addEventListener('message', (e)=> postMessage({ type:'uci', line: e.data }));
  }

  engine = inst;

  // Variant + options
  send('uci');
  send('setoption name UCI_Variant value Ouk Chatrang');
  // If the build supports this, good; if not, harmless:
  send('setoption name CountingRule value cambodian');
  send('isready');

  // Flush any queued commands sent before ready
  while (pending.length) inst.postMessage(pending.shift());

  note('Engine ready.');
}

function send(cmd){
  if (engine) engine.postMessage(cmd);
  else pending.push(cmd);
}

self.onmessage = (e) => {
  const { cmd } = e.data || {};
  if (!loadPromise){
    loadPromise = loadEngine().catch(err=>{
      note(`ERROR: ${err?.message || err}`);
    });
  }
  if (cmd) send(cmd);
};

// Kick load immediately so first command doesn’t race
loadPromise = loadEngine().catch(err=>{
  note(`ERROR: ${err?.message || err}`);
});
