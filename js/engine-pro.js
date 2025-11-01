// engine-pro.js — WASM engine bridge (Makruk). With debug taps.

let _w = null;
let _awaiters = [];
let DBG = (msg)=>{}; // no-op until set
let DBG_KIND = (msg, kind)=>{ DBG(`[ENGINE] ${msg}`, kind); };

// expose to debug.js
export function setEngineDebugLogger(fn){ if (typeof fn==='function') DBG = fn; }
export function _debug__peekWorkerURL(){ return new URL('./engine.worker.js', import.meta.url).toString(); }

// Use classic worker so worker can importScripts()
function workerURL(){ return new URL('./engine.worker.js', import.meta.url); }

export function startEngineWorker(){
  if (_w) return;

  const url = workerURL();
  DBG_KIND(`Starting worker: ${url}`, 'warn');

  _w = new Worker(url, { /* classic */ });

  _w.addEventListener('error', (e)=>{
    DBG_KIND(`Worker error: ${e.message || e.filename || e.type}`, 'err');
  });
  _w.addEventListener('messageerror', (e)=>{
    DBG_KIND(`Worker messageerror: ${e.type}`, 'err');
  });

  _w.onmessage = (e) => {
    const { type, line, note } = e.data || {};

    if (note) DBG_KIND(`Worker note: ${note}`, 'warn');

    if (type === 'uci' && line){
      // Show all raw engine lines in debug
      DBG_KIND(`UCI: ${line}`);
      if (line.startsWith('bestmove')){
        const parts = line.split(/\s+/);
        const uci = parts[1];
        for (const fn of _awaiters) fn(uci);
        _awaiters = [];
      }
    }
  };
}

export function stopEngineWorker(){
  if (_w){ DBG_KIND('Terminating worker.'); _w.terminate(); _w = null; }
  _awaiters = [];
}

export function positionFromFEN(fen){ return `position fen ${fen}`; }
export function goMoveTime(ms){ return `go movetime ${Math.max(50, (ms|0))}`; }

export function setNewGame(){ _w?.postMessage({ cmd: 'ucinewgame' }); }
export function setPositionFEN(fen){ _w?.postMessage({ cmd: positionFromFEN(fen) }); }

export function getEngineBestMove({ fen, movetimeMs = 600 }){
  return new Promise((resolve) => {
    startEngineWorker();
    DBG_KIND(`Request bestmove: movetime=${movetimeMs}ms, FEN=${fen.slice(0,80)}...`);
    _awaiters.push((uci)=>{
      DBG_KIND(`Resolved bestmove: ${uci}`);
      resolve(uci);
    });
    _w.postMessage({ cmd: 'ucinewgame' });
    _w.postMessage({ cmd: positionFromFEN(fen) });
    _w.postMessage({ cmd: goMoveTime(movetimeMs) });
  });
}
