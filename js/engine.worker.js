/* engine.worker.js — module worker wrapping legacy Fairy-Stockfish worker
   Requires:
   - engine/fairy-stockfish.js
   - engine/fairy-stockfish.wasm
   - engine/fairy-stockfish.factory.js (ESM shim)
*/

let eng = null;                 // { postMessage, addMessageListener, terminate }
let ready = false;
const queue = [];
const postUCI = (t) => postMessage({ type: 'uci',  line: String(t) });
const postNote= (t) => postMessage({ type: 'note', line: String(t) });

function send(cmd){
  if (!eng) { queue.push(cmd); return; }
  eng.postMessage(cmd);
}

onmessage = (e) => {
  const d = e.data || {};
  if (d._selftest){
    postNote('[WORKER] Self-test: requesting bestmove…');
    send('ucinewgame');
    send('position fen rnbqkbnr/8/pppppppp/8/4P3/PPPP1PPP/8/RNBKQBNR b - - 0 1');
    send('go movetime 600');
    return;
  }
  if (d.cmd) send(d.cmd);
};

(async function boot(){
  try{
    postNote('[WORKER] Booting…');

    const { FairyStockfish } = await import('../engine/fairy-stockfish.factory.js');

    postNote('[WORKER] Loading legacy engine via factory shim…');
    eng = await FairyStockfish({
      wasmPath: new URL('../engine/fairy-stockfish.wasm', self.location.href).href
    });

    // Pipe engine -> main thread (all lines)
    eng.addMessageListener((line) => {
      postUCI(line);
      // Heuristics to mark "ready"
      if (!ready && /uciok|readyok|^id\s+name|^option\s+name/i.test(line)) {
        ready = true;
      }
    });

    // Initial prod; some builds ignore first message; the factory also pokes
    send('uci');
    send('isready');

    // Retry until we see some UCI sign of life
    let tries = 0;
    const tick = setInterval(()=>{
      if (ready) { clearInterval(tick); return; }
      tries++;
      if (tries <= 8){
        postNote(`[WORKER] Nudge #${tries}: sending 'uci' in multiple formats`);
        send('uci');
        send('isready');
      } else {
        clearInterval(tick);
        postNote('[WORKER] No UCI response after multiple nudges — engine may still only accept object-stdin; continuing anyway.');
      }
    }, 220);

    // Flush any queued commands
    while (queue.length) eng.postMessage(queue.shift());

    postNote('[WORKER] Engine bridge active (waiting for UCI response).');
  } catch (err){
    postNote('[WORKER] FATAL: Unable to initialize engine factory shim.');
    postUCI(`[WORKER] ERROR: ${err?.message || err}`);
  }
})();

// Optional cleanup
self.addEventListener('close', ()=>{ try{ eng?.terminate?.(); }catch{} });
