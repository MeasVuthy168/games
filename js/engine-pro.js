// js/engine-pro.js
let _w = null;
let _awaiters = [];

function log(s){ window.dbgLog?.(`[ENGINE] ${s}`); }

export function startEngineWorker(){
  if (_w) return;
  const url = new URL('./engine.worker.js', import.meta.url).href;
  log('Starting worker: ' + url + '?v=' + Date.now());
  _w = new Worker(url, { type: 'module' });

  _w.onmessage = (e) => {
    const { type, line } = e.data || {};
    if (type !== 'uci' || typeof line !== 'string') return;

    // Mirror all UCI lines into debug console
    window.dbgLog?.(`[ENGINE] ${line}`);

    if (line.startsWith('bestmove')) {
      const parts = line.trim().split(/\s+/);
      const uci = parts[1] || '';
      // Guard against bad/placeholder moves
      if (uci === '0000' || uci.length < 4){
        log('Received invalid bestmove (' + uci + '), ignoring.');
        // resolve with null so caller can fallback
        for (const fn of _awaiters) fn(null);
      } else {
        for (const fn of _awaiters) fn(uci);
      }
      _awaiters = [];
    }
  };
}

export function stopEngineWorker(){
  if (_w){ _w.terminate(); _w = null; }
  _awaiters = [];
}

export function positionFromFEN(fen){ return `position fen ${fen}`; }
export function goMoveTime(ms){ return `go movetime ${Math.max(80, ms|0)}`; } // min 80ms

export function setNewGame(){ _w?.postMessage({ cmd: 'ucinewgame' }); }
export function setPositionFEN(fen){ _w?.postMessage({ cmd: positionFromFEN(fen) }); }

export function getEngineBestMove({ fen, movetimeMs = 600 }){
  return new Promise((resolve) => {
    startEngineWorker();
    _awaiters.push((uci)=>resolve(uci));
    _w.postMessage({ cmd: 'ucinewgame' });
    _w.postMessage({ cmd: positionFromFEN(fen) });
    _w.postMessage({ cmd: goMoveTime(movetimeMs) });
  });
}
