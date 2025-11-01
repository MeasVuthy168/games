/* engine.worker.js — wraps Fairy-Stockfish WASM as a UCI worker (Makruk / Ouk Chatrang)
   Expected files (relative to this worker file):
   ../engine/fairy-stockfish.js
   ../engine/fairy-stockfish.wasm
*/

let mod = null;
let ready = false;
const queue = [];

// Load the WASM module (classic worker)
importScripts('../engine/fairy-stockfish.js'); // <-- path is from /js/ to /engine

(async () => {
  // Init module; tell it where to find the .wasm
  mod = await FairyStockfish({
    locateFile: (p) => p.endsWith('.wasm') ? '../engine/fairy-stockfish.wasm' : p
  });

  // Pipe engine stdout -> main thread
  mod.addMessageListener?.((line) => {
    postMessage({ type: 'uci', line });
    if (line === 'readyok') ready = true;
  });

  // Standard UCI init
  send('uci');

  // IMPORTANT: Makruk is the variant Fairy-Stockfish expects (covers Ouk Chatrang rules)
  // Use lowercase exactly as below.
  send('setoption name UCI_Variant value makruk');

  // If your build supports counting options you can add them; otherwise omit to avoid errors.
  // send('setoption name CountingRule value cambodian');

  send('isready');
})();

function send(cmd){
  if (!mod) { queue.push(cmd); return; }
  mod.postMessage(cmd);
}

onmessage = (e) => {
  const { cmd } = e.data || {};
  if (!cmd) return;

  // If engine not created yet, queue
  if (!mod) { queue.push(cmd); return; }

  // Flush queue once module exists
  if (queue.length){
    while (queue.length) mod.postMessage(queue.shift());
  }

  // Forward command
  mod.postMessage(cmd);
};
