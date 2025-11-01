/* fairy-stockfish.factory.js — ESM shim exposing a factory that returns a
   bridge to the legacy classic Worker (engine/fairy-stockfish.js).
   It normalizes both input (stdin) and output lines for many FS ports.
*/

export async function FairyStockfish(options = {}){
  const wasmURL = options.wasmPath || null;

  // Spawn vendor worker in *classic* mode
  const workerURL = new URL('./fairy-stockfish.js', import.meta.url);
  const w = new Worker(workerURL, { type: 'classic', name: 'fairy-stockfish-legacy' });

  // Try to hint WASM path (different ports look for different keys)
  try { if (wasmURL) w.postMessage({ type: 'wasmPath', path: wasmURL }); } catch {}
  try { if (wasmURL) w.postMessage({ wasmPath: wasmURL }); } catch {}

  // Observers
  const listeners = new Set();
  const addMessageListener = (fn) => { if (typeof fn === 'function') listeners.add(fn); };

  // Normalize outputs to plain "line" strings for the page debug console
  w.addEventListener('message', (e)=>{
    let d = e?.data;

    // Most ports already post raw strings
    if (typeof d === 'string'){
      for (const fn of listeners) try{ fn(d) }catch{}
      return;
    }

    // Common object patterns
    if (d && typeof d === 'object'){
      if (typeof d.data === 'string'){            // { data: '...' }
        for (const fn of listeners) try{ fn(d.data) }catch{}
        return;
      }
      if (typeof d.line === 'string'){            // { line: '...' }
        for (const fn of listeners) try{ fn(d.line) }catch{}
        return;
      }
      if (typeof d.stdout === 'string'){          // { stdout: '...' }
        for (const fn of listeners) try{ fn(d.stdout) }catch{}
        return;
      }
      // As a last resort, stringify so devs can see shape
      try {
        const s = '[obj] ' + JSON.stringify(d);
        for (const fn of listeners) try{ fn(s) }catch{}
      } catch {}
    }
  });

  // Ultra-robust sender: hammer all known command shapes
  function postMessage(cmd){
    if (typeof cmd !== 'string' || !cmd) return;

    const s      = cmd;
    const sNL    = s.endsWith('\n') ? s : (s + '\n');

    // 1) Plain string
    try { w.postMessage(s); } catch {}
    // 2) String + newline (Emscripten stdin)
    try { w.postMessage(sNL); } catch {}
    // 3) Objects seen in various forks
    try { w.postMessage({ cmd: s }); } catch {}
    try { w.postMessage({ type: 'cmd', cmd: s }); } catch {}
    try { w.postMessage({ uci: s }); } catch {}
    try { w.postMessage({ event: 'stdin', data: sNL }); } catch {}
    try { w.postMessage({ stdin: sNL }); } catch {}
  }

  // Hello ping so you know the bridge is alive
  setTimeout(()=>{
    for (const fn of listeners) try{ fn('[LEGACY] Classic worker online') }catch{}
  }, 0);

  // Some ports need multiple early pokes before they start emitting UCI
  let primed = false;
  const prime = () => {
    if (primed) return;
    primed = true;
    setTimeout(()=>{ try { postMessage('uci');     } catch {} },  10);
    setTimeout(()=>{ try { postMessage('isready'); } catch {} },  40);
    setTimeout(()=>{ try { postMessage('uci');     } catch {} }, 100);
  };
  prime();

  return {
    postMessage,
    addMessageListener,
    terminate: ()=>{ try{ w.terminate(); }catch{} }
  };
}

export default FairyStockfish;
