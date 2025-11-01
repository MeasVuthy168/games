// engine-pro.js — ask the Fairy-Stockfish (Makruk) worker for a best move
// API: await getEngineBestMove({ fen, movetimeMs })

let _w = null;
let _awaiters = [];

// Use classic worker (NOT module). Resolve path relative to this file.
function workerURL() {
  return new URL('./engine.worker.js', import.meta.url);
}

export function startEngineWorker(){
  if (_w) return;

  // Classic worker so engine.worker.js can use importScripts(...)
  _w = new Worker(workerURL(), { /* classic */ });

  _w.onmessage = (e) => {
    const { type, line } = e.data || {};
    if (type !== 'uci' || !line) return;

    if (line.startsWith('bestmove')) {
      const parts = line.split(/\s+/);
      const uci = parts[1];
      for (const fn of _awaiters) fn(uci);
      _awaiters = [];
    }

    // Uncomment to debug engine lines:
    // console.log('[FSF]', line);
  };
}

export function stopEngineWorker(){
  if (_w){ _w.terminate(); _w = null; }
  _awaiters = [];
}

export function positionFromFEN(fen){
  return `position fen ${fen}`;
}

export function goMoveTime(ms){
  return `go movetime ${Math.max(50, (ms|0))}`;
}

export function setNewGame(){
  _w?.postMessage({ cmd: 'ucinewgame' });
}

export function setPositionFEN(fen){
  _w?.postMessage({ cmd: positionFromFEN(fen) });
}

export function getEngineBestMove({ fen, movetimeMs = 600 }){
  return new Promise((resolve) => {
    startEngineWorker();
    _awaiters.push((uci)=>resolve(uci));
    _w.postMessage({ cmd: 'ucinewgame' });
    _w.postMessage({ cmd: positionFromFEN(fen) });
    _w.postMessage({ cmd: goMoveTime(movetimeMs) });
  });
}
