// js/engine.worker.js  — UCI wrapper for Fairy-Stockfish (Ouk Chatrang)
// Works with either a factory-style ESM build or a worker-compatible script.
// It will auto-fallback to a nested Worker proxy if no factory export exists.

let mode = 'boot';
let engine = null;        // factory object OR nested worker
let ready = false;

const WRAP_URL = new URL('../engine/fairy-stockfish.js', import.meta.url).href;
const WASM_URL = new URL('../engine/fairy-stockfish.wasm', import.meta.url).href;

function note(s){ try{ postMessage({ type:'uci', line:`[WORKER] ${s}` }); }catch{} }
function emit(line){ try{ postMessage({ type:'uci', line }); }catch{} }

// Forward a UCI command to the active engine (factory or nested)
function forward(cmd){
  if(!engine){ return; }
  if(mode==='factory'){
    // FairyStockfish factory object uses postMessage(string)
    engine.postMessage(cmd);
  }else{
    // nested Worker: just relay
    engine.postMessage(cmd);
  }
}

// Try to init as ESM factory first; fallback to nested worker if not found
(async function boot(){
  note('Booting…');
  note('Loading WASM wrapper: ' + WRAP_URL);
  note('WASM URL: ' + WASM_URL);

  try{
    // Load as ESM
    const mod = await import(/* @vite-ignore */ WRAP_URL);
    // Typical emscripten builds export a function named Stockfish/FairyStockfish/Module
    const factory =
      (typeof mod?.default === 'function' && mod.default) ||
      (typeof mod?.FairyStockfish === 'function' && mod.FairyStockfish) ||
      (typeof mod?.Stockfish === 'function' && mod.Stockfish) ||
      null;

    if (!factory){
      note('Wrapper loaded as ES module, but no factory export found — switching to nested worker mode…');
      return startNestedWorker();
    }

    mode = 'factory';
    note('Factory export detected. Initializing engine…');

    engine = await factory({
      locateFile: (p) => (p.endsWith('.wasm') ? WASM_URL : p)
    });

    // Some builds add an event pipe:
    if (engine.addMessageListener) {
      engine.addMessageListener((line)=> emit(line));
    } else if (engine.onmessage === undefined && engine.postMessage) {
      // emulate addMessageListener if only postMessage exists (rare)
      // No way to subscribe -> nothing to do here; most builds have addMessageListener
    }

    // Kick standard UCI init for variant
    forward('uci');
    forward('setoption name UCI_Variant value Ouk Chatrang');
    // Optional counting rule if supported by your build:
    forward('setoption name CountingRule value cambodian');
    forward('isready');

    ready = true;
    note('Engine ready (factory mode).');
  }catch(e){
    note('ESM/factory init failed: ' + (e?.message||e));
    startNestedWorker();
  }
})();

function startNestedWorker(){
  try{
    mode = 'nested';
    // Start wrapper as a dedicated worker (most stockfish/FSF builds support this)
    engine = new Worker(WRAP_URL);
    engine.onmessage = (e) => {
      // Fairy-Stockfish worker posts plain strings (UCI lines) or {data:'...'}
      const d = e?.data;
      const line = (typeof d === 'string') ? d
                 : (typeof d?.data === 'string') ? d.data
                 : null;
      if (line) emit(line);
    };
    // Standard UCI init sequence
    engine.postMessage('uci');
    engine.postMessage('setoption name UCI_Variant value Ouk Chatrang');
    engine.postMessage('setoption name CountingRule value cambodian');
    engine.postMessage('isready');

    ready = true;
    note('Nested worker mode engaged (JS acts as UCI engine).');
    note('Engine ready (nested worker mode).');
  }catch(e){
    note('Nested worker init failed: ' + (e?.message||e));
  }
}

// Messages from the page
onmessage = (e) => {
  const { cmd } = e.data || {};
  if (typeof cmd === 'string'){
    if(!ready) note('Command queued before ready: ' + cmd);
    forward(cmd);
  }
};
