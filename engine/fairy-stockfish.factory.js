/* engine/fairy-stockfish.factory.js — ESM shim exposing a factory that returns a
   bridge to the legacy classic Worker. Now launches the classic *bridge* worker
   which pre-sets Emscripten Module.locateFile before loading the engine.
*/

export async function FairyStockfish(options = {}){
  const wasmURL = options.wasmPath || new URL('./fairy-stockfish.wasm', import.meta.url).href;

  // Use the classic bridge with a query that carries the absolute WASM url
  const bridgeURL = new URL('./fairy-stockfish.bridge.js', import.meta.url);
  bridgeURL.searchParams.set('wasm', wasmURL);

  const w = new Worker(bridgeURL, { type: 'classic', name: 'fairy-stockfish-bridge' });

  // Observers
  const listeners = new Set();
  const addMessageListener = (fn) => { if (typeof fn === 'function') listeners.add(fn); };

  // Normalize outputs to plain lines for the debug panel
  w.addEventListener('message', (e)=>{
    let d = e?.data;
    if (typeof d === 'string'){
      for (const fn of listeners) try{ fn(d) }catch{}
      return;
    }
    if (d && typeof d === 'object'){
      const s = d.data || d.line || d.stdout;
      if (typeof s === 'string'){
        for (const fn of listeners) try{ fn(s) }catch{}
        return;
      }
      try{
        const s2 = '[obj] ' + JSON.stringify(d);
        for (const fn of listeners) try{ fn(s2) }catch{}
      }catch{}
    }
  });

  // Ultra-compatible sender: try multiple shapes
  function postMessage(cmd){
    if (typeof cmd !== 'string' || !cmd) return;
    const s   = cmd;
    const sNL = s.endsWith('\n') ? s : (s + '\n');
    try { w.postMessage(s); } catch {}
    try { w.postMessage(sNL); } catch {}
    try { w.postMessage({ cmd: s }); } catch {}
    try { w.postMessage({ type: 'cmd', cmd: s }); } catch {}
    try { w.postMessage({ uci: s }); } catch {}
    try { w.postMessage({ event: 'stdin', data: sNL }); } catch {}
    try { w.postMessage({ stdin: sNL }); } catch {}
  }

  // Hello ping so you see the bridge is alive
  setTimeout(()=>{
    for (const fn of listeners) try{ fn('[LEGACY] Classic worker online') }catch{}
  }, 0);

  // Prime UCI on slow ports
  let primed = false;
  const prime = () => {
    if (primed) return;
    primed = true;
    setTimeout(()=>{ try { postMessage('uci');     } catch {} },  20);
    setTimeout(()=>{ try { postMessage('isready'); } catch {} },  80);
    setTimeout(()=>{ try { postMessage('uci');     } catch {} }, 160);
  };
  prime();

  return {
    postMessage,
    addMessageListener,
    terminate: ()=>{ try{ w.terminate(); }catch{} }
  };
}

export default FairyStockfish;
