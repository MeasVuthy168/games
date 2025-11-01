/* engine.worker.js — Fairy-Stockfish (Makruk) classic worker */

let mod = null;

// paths are relative to THIS FILE (/js)
importScripts('../engine/fairy-stockfish.js');

postMessage({ note: 'Worker booting…' });

(async () => {
  try{
    postMessage({ note: 'Loading WASM…' });

    mod = await FairyStockfish({
      locateFile: (p) => p.endsWith('.wasm') ? '../engine/fairy-stockfish.wasm' : p
    });

    mod.addMessageListener?.((line) => {
      postMessage({ type: 'uci', line });
    });

    // UCI init
    postMessage({ note: 'Sending UCI init…' });
    mod.postMessage('uci');

    // IMPORTANT: makruk is the variant name Fairy-Stockfish expects here
    mod.postMessage('setoption name UCI_Variant value makruk');

    // Only set options that exist in your build; unknown options are ignored but noisy.
    // mod.postMessage('setoption name CountingRule value cambodian');

    mod.postMessage('isready');
  }catch(err){
    postMessage({ note: `Init failed: ${err && err.message ? err.message : String(err)}` });
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
