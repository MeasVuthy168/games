/* engine.worker.js — module worker that wraps Fairy-Stockfish legacy worker
   Files expected (same origin):
   - engine/fairy-stockfish.js      (vendor, classic worker capable)
   - engine/fairy-stockfish.wasm    (next to the JS)
   - engine/fairy-stockfish.factory.js (this repo: ESM shim below)
*/

let eng = null;           // engine bridge { postMessage, addMessageListener, terminate }
let ready = false;
const queue = [];
const log = (t) => postMessage({ type: 'uci', line: t });
const note = (t) => postMessage({ type: 'note', line: t });

function send(cmd){
  if(!eng){ queue.push(cmd); return; }
  eng.postMessage(cmd);
}

// Handle commands from main thread
onmessage = (e) => {
  const { cmd, _selftest } = e.data || {};
  if (_selftest){
    // Simple self test: ask bestmove on a fixed FEN
    note('[WORKER] Self-test: requesting bestmove…');
    send('ucinewgame');
    send('position fen rnbqkbnr/8/pppppppp/8/4P3/PPPP1PPP/8/RNBKQBNR b - - 0 1');
    send('go movetime 600');
    return;
  }
  if (cmd) send(cmd);
};

// Boot
(async function boot(){
  try{
    note('[WORKER] Booting…');

    // Dynamically import the ESM shim that returns a classic-worker bridge
    const { FairyStockfish } = await import('../engine/fairy-stockfish.factory.js');

    // Create the engine (it internally spawns classic worker: fairy-stockfish.js)
    note('[WORKER] Loading legacy engine via factory shim…');
    eng = await FairyStockfish({
      wasmPath: new URL('../engine/fairy-stockfish.wasm', self.location.href).href
    });

    // Pipe engine -> out
    eng.addMessageListener((line) => {
      // Make sure everything shows in your debug console
      postMessage({ type: 'uci', line });
    });

    // Initialize UCI + variant (Ouk Chatrang)
    send('uci');
    // Some builds only accept setoption after "uci", but we can send early safely
    send('setoption name UCI_Variant value Ouk Chatrang');
    // If your build recognizes a Cambodian counting rule name, keep it; otherwise harmless
    send('setoption name CountingRule value cambodian');
    send('isready');

    ready = true;
    while (queue.length) eng.postMessage(queue.shift());

    note('[WORKER] Engine ready (legacy classic worker bridged).');
  } catch (err){
    note('[WORKER] FATAL: Unable to initialize engine factory shim.');
    log(`[WORKER] ERROR: ${err?.message || err}`);
  }
})();

// Cleanup (optional, if your app ever terminates the worker)
self.addEventListener('close', ()=> { try{ eng?.terminate?.(); }catch{} });
