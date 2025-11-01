/* engine.worker.js — wraps Fairy-Stockfish WASM as a UCI worker (Ouk Chatrang)
   Expected files (relative to HTML):
   - engine/fairy-stockfish.js
   - engine/fairy-stockfish.wasm
*/

let mod = null;
let ready = false;
let pending = [];

// Load the WASM module
importScripts('../engine/fairy-stockfish.js'); // adapt path if needed

(async () => {
  // fairy-stockfish exposes a global function "FairyStockfish" that returns a UCI-like object
  mod = await FairyStockfish({
    locateFile: (p) => p.endsWith('.wasm') ? '../engine/fairy-stockfish.wasm' : p
  });

  // Pipe engine stdout -> worker postMessage
  mod.addMessageListener?.((line) => {
    postMessage({ type: 'uci', line });
  });

  // Initialize UCI + variant
  send('uci');
  send('setoption name UCI_Variant value Ouk Chatrang'); // Khmer/Cambodian chess
  // Optional (if your build lists it): Counting rule set to Cambodian
  send('setoption name CountingRule value cambodian');
  send('isready');

  ready = true;
  for (const msg of pending) mod.postMessage(msg);
  pending = [];
})();

function send(cmd){
  if (!mod) { pending.push(cmd); return; }
  mod.postMessage(cmd);
}

onmessage = (e) => {
  const { cmd } = e.data;
  send(cmd);
};
