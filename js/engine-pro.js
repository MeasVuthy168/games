// engine-pro.js — Master level bridge to the WASM engine

let _w = null;
let _awaiters = [];
let _dbg = null;

function dbg(msg, kind){ (_dbg ? _dbg : console.log)(msg, kind); }

export function setEngineDebugLogger(fn){ _dbg = fn; }
function workerURL(){
  // Resolve relative to this module file
  const url = new URL('./engine.worker.js', import.meta.url);
  // Cache-bust to avoid SW/GP caches during debug
  url.searchParams.set('v', String(Date.now()));
  return url.href;
}
export function _debug__peekWorkerURL(){ return workerURL(); }

export function startEngineWorker(){
  if (_w) return;
  const url = workerURL();
  dbg(`[ENGINE] Starting worker: ${url}`);
  _w = new Worker(url, { type: 'module' });

  _w.onmessage = (e) => {
    const { type, line } = e.data || {};
    if (type !== 'uci') return;

    // Debug pipe to UI
    if (line && _dbg) _dbg(`[ENGINE] ${line}`);

    // Capture bestmove
    if (typeof line === 'string' && line.startsWith('bestmove')){
      const parts = line.split(/\s+/);
      const uci = parts[1] || '';
      for (const fn of _awaiters) { try{ fn(uci); }catch{} }
      _awaiters = [];
    }
  };
}

export function stopEngineWorker(){
  if (_w){ try{ _w.terminate(); }catch{} _w = null; }
  _awaiters = [];
}

export function positionFromFEN(fen){ return `position fen ${fen}`; }
export function goMoveTime(ms){ return `go movetime ${Math.max(50, ms|0)}`; }
export function setNewGame(){ _w?.postMessage({ cmd: 'ucinewgame' }); }
export function setPositionFEN(fen){ _w?.postMessage({ cmd: positionFromFEN(fen) }); }

export function getEngineBestMove({ fen, movetimeMs = 600 }){
  return new Promise((resolve, reject)=>{
    try{
      startEngineWorker();
      _awaiters.push(resolve);
      _w.postMessage({ cmd:'ucinewgame' });
      _w.postMessage({ cmd: positionFromFEN(fen) });
      _w.postMessage({ cmd: goMoveTime(movetimeMs) });
      dbg(`[ENGINE] Request bestmove: movetime=${movetimeMs}ms, FEN=${fen.slice(0,64)}...`);
    }catch(e){
      reject(e);
    }
  });
}
