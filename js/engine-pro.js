// engine-pro.js — ask the WASM engine for a best move (Master level)
// API: await getEngineBestMove({ fen, movetimeMs })
let _w = null;
let _awaiters = [];

export function startEngineWorker(){
  if (_w) return;
  _w = new Worker('./js/engine.worker.js', { type: 'module' });
  _w.onmessage = (e) => {
    const { type, line } = e.data || {};
    if (type !== 'uci') return;

    // Resolve bestmove
    if (line.startsWith('bestmove')) {
      const parts = line.split(/\s+/);
      // UCI move like "e3e4"
      const uci = parts[1];
      for (const fn of _awaiters) fn(uci);
      _awaiters = [];
    }
    // You may console.log lines for debugging.
    // console.log('[FSF]', line);
  };
}

export function stopEngineWorker(){
  if (_w){ _w.terminate(); _w = null; }
  _awaiters = [];
}

export function positionFromFEN(fen){
  // Build UCI "position" command from a full FEN (variant-aware)
  return `position fen ${fen}`;
}

export function goMoveTime(ms){
  // Keep short for mobile; tune later if you want stronger play
  return `go movetime ${Math.max(50, ms|0)}`;
}

export function setNewGame(){
  _w?.postMessage({ cmd: 'ucinewgame' });
}

export function setPositionFEN(fen){
  _w?.postMessage({ cmd: positionFromFEN(fen) });
}

export function getEngineBestMove({ fen, movetimeMs = 500 }){
  return new Promise((resolve) => {
    startEngineWorker();
    _awaiters.push((uci)=>resolve(uci));
    _w.postMessage({ cmd: 'ucinewgame' });
    _w.postMessage({ cmd: positionFromFEN(fen) });
    _w.postMessage({ cmd: goMoveTime(movetimeMs) });
  });
}
