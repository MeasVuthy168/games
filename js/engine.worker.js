// engine.worker.js — MODULE worker (not classic)
// Loads Fairy-Stockfish as an ES module and supports multiple export styles.

postMessage({ note: 'Worker booting…' });

// Resolve and import the engine module relative to this worker file
const engineURL = new URL('../engine/fairy-stockfish.js', import.meta.url);

let EngineFactory = null;
let mod = null;

async function loadEngineFactory(){
  postMessage({ note: `Loading WASM wrapper: ${engineURL}` });
  const m = await import(engineURL);

  // Try common shapes: default, FairyStockfish, Stockfish, createEngine
  const cand =
    m?.default ||
    m?.FairyStockfish ||
    m?.Stockfish ||
    m?.createEngine ||
    null;

  if (!cand) {
    // Some UMD builds set global on self; check just in case
    // (In module workers, the global is 'self' too.)
    // eslint-disable-next-line no-undef
    if (typeof self !== 'undefined' && typeof self.FairyStockfish === 'function') {
      return self.FairyStockfish;
    }
    throw new Error('Could not find engine factory export on fairy-stockfish.js');
  }
  return cand;
}

(async () => {
  try{
    EngineFactory = await loadEngineFactory();

    // Instantiate; pass locateFile so the .wasm path resolves correctly
    mod = await EngineFactory({
      locateFile: (p) => p.endsWith('.wasm') ? '../engine/fairy-stockfish.wasm' : p
    });

    // Pipe engine stdout -> main thread
    if (typeof mod.addMessageListener === 'function'){
      mod.addMessageListener((line) => postMessage({ type:'uci', line }));
    } else {
      // Some builds echo via onmessage-like handler; try a fallback tap
      const orig = mod.onmessage;
      mod.onmessage = (e)=>{ try{ postMessage({ type:'uci', line:String(e.data||e) }); }catch{}; orig?.(e); };
    }

    // Init UCI
    postMessage({ note: 'Sending UCI init…' });
    mod.postMessage?.('uci');

    // Variant: Makruk (Thai/Khmer family). If your build supports "ouk chatrang", use that string instead.
    mod.postMessage?.('setoption name UCI_Variant value makruk');

    // If your build has it you can enable: counting rule etc. (else skip to avoid noise)
    // mod.postMessage?.('setoption name CountingRule value cambodian');

    mod.postMessage?.('isready');
  }catch(err){
    postMessage({ note:`Init failed: ${err?.message || String(err)}` });
  }
})();

onmessage = (e) => {
  const { cmd } = e.data || {};
  if (!mod || !cmd) return;
  try{
    mod.postMessage(cmd);
  }catch(err){
    postMessage({ note:`postMessage error: ${String(err)}` });
  }
};
