// js/engine-pro.js — single classic worker controller
// Provides: getEngineBestMove, setEngineDebugLogger, _debug__peekWorkerURL

let _log = (m)=>console.log(m);
export function setEngineDebugLogger(fn){ _log = typeof fn==='function' ? fn : _log; }

let _worker = null;
let _workerURL = null;
let _readyPinged = false;

// Resolve worker URL relative to this file (robust on GitHub Pages)
try {
  _workerURL = new URL('./engine.worker.js', import.meta.url).href;
} catch {
  // Fallback from page location if import.meta.url is unavailable
  const here = new URL(location.href);
  _workerURL = new URL('js/engine.worker.js', here).href;
}

export function _debug__peekWorkerURL(){ return _workerURL; }

function startWorker(){
  if (_worker) return;
  _log(`[ENGINE] Starting worker: ${_workerURL}`);
  _worker = new Worker(_workerURL); // classic
  _worker.onmessage = (e)=>{
    const line = e?.data;
    if (typeof line === 'string') _log(line);
  };
  _worker.onerror = (err)=>{
    _log(`[ENGINE][ERR] Worker error: ${err?.message||String(err)}`, 'err');
  };

  // quick kick
  if (!_readyPinged){
    _readyPinged = true;
    setTimeout(()=> { try { _worker.postMessage('uci'); } catch{} }, 30);
    setTimeout(()=> { try { _worker.postMessage('isready'); } catch{} }, 120);
  }
}

function send(line){
  try { _worker && _worker.postMessage(line); } catch {}
}

export async function getEngineBestMove({ fen, movetimeMs=600 }){
  startWorker();

  // Drain any old listeners then listen for bestmove
  return new Promise((resolve, reject)=>{
    if (!_worker) return reject(new Error('worker not started'));
    let done = false;
    const timeout = setTimeout(()=>{
      if (done) return;
      done = true;
      reject(new Error('engine timeout'));
    }, Math.max(1200, movetimeMs + 800));

    const onMsg = (e)=>{
      const line = e?.data;
      if (typeof line !== 'string') return;
      // Pass-through to debug console
      _log(line);

      if (/^bestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/i.test(line)){
        const uci = RegExp.$1;
        if (!done){ done = true; cleanup(); resolve(uci); }
      }
      if (/^readyok|uciok|id\s+name/i.test(line)){
        // Nice to see in logs but not required
      }
    };

    const cleanup = ()=>{
      clearTimeout(timeout);
      try { _worker?.removeEventListener('message', onMsg); } catch {}
    };

    _worker.addEventListener('message', onMsg);

    // Send the UCI sequence
    try { send('ucinewgame'); } catch {}
    try { send('isready'); } catch {}
    try { send(`position fen ${fen}`); } catch {}
    try { send(`go movetime ${Math.max(1, +movetimeMs|0)}`); } catch {}
  });
}
