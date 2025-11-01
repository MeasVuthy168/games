/* engine.worker.js — module worker wrapping legacy Fairy-Stockfish worker
   Requires:
   - engine/fairy-stockfish.js
   - engine/fairy-stockfish.wasm
   - engine/fairy-stockfish.factory.js (ESM shim)
*/

let eng = null;                 // bridge { postMessage, addMessageListener, terminate }
let ready = false;
const queue = [];
const log  = (t) => postMessage({ type: 'uci',  line: t });
const note = (t) => postMessage({ type: 'note', line: t });

function send(cmd){
  if (!eng) { queue.push(cmd); return; }
  eng.postMessage(cmd);
}

onmessage = (e) => {
  const { cmd, _selftest } = e.data || {};
  if (_selftest){
    note('[WORKER] Self-test: requesting bestmove…');
    send('ucinewgame');
    send('position fen rnbqkbnr/8/pppppppp/8/4P3/PPPP1PPP/8/RNBKQBNR b - - 0 1');
    send('go movetime 600');
    return;
  }
  if (cmd) send(cmd);
};

(async function boot(){
  try{
    note('[WORKER] Booting…');

    const { FairyStockfish } = await import('../engine/fairy-stockfish.factory.js');

    note('[WORKER] Loading legacy engine via factory shim…');
    eng = await FairyStockfish({
      wasmPath: new URL('../engine/fairy-stockfish.wasm', self.location.href).href
    });

    // Pipe engine -> main thread
    eng.addMessageListener((line) => {
      // Ensure visibility in page debug panel
      postMessage({ type: 'uci', line: String(line) });
    });

    // Safety boot sequence (some builds want an early 'uci' before any setoption)
    send('uci');
    send('setoption name UCI_Variant value Ouk Chatrang');
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

// Optional cleanup
self.addEventListener('close', ()=>{ try{ eng?.terminate?.(); }catch{} });
