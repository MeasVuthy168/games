// engine-pro.js — WASM/Worker bridge for Master level
// API: await getEngineBestMove({ fen, movetimeMs })

let _w = null;
let _awaiters = [];
let _readyWaiters = [];
let _readySeen = false;

function log(line){
  // Forward to your in-page debug console if present:
  try{
    const ev = new CustomEvent('uci-log', { detail: line });
    self?.dispatchEvent?.(ev);
  }catch{}
}

export function startEngineWorker(){
  if (_w) return;
  const url = new URL('./engine.worker.js', import.meta.url).href;
  _w = new Worker(url, { type: 'module' });

  _w.onmessage = (e) => {
    const { type, line } = e.data || {};
    if (type !== 'uci') return;
    if (line) log(`[ENGINE] ${line}`);

    const l = String(line || '');

    // Ready detection
    if (/\breadyok\b/i.test(l)) {
      _readySeen = true;
      _readyWaiters.splice(0).forEach(fn => { try{ fn(); }catch{} });
    }

    // Resolve bestmove lines
    if (/^bestmove\s+\S+/i.test(l)) {
      const parts = l.trim().split(/\s+/);
      const uci = parts[1] || '0000';
      _awaiters.splice(0).forEach(fn => { try{ fn(uci); }catch{} });
    }
  };
}

export function stopEngineWorker(){
  if (_w){ _w.terminate(); _w = null; }
  _awaiters = [];
  _readyWaiters = [];
  _readySeen = false;
}

export function positionFromFEN(fen){
  return `position fen ${fen}`;
}
export function goMoveTime(ms){
  return `go movetime ${Math.max(50, ms|0)}`;
}
export function setNewGame(){
  _w?.postMessage({ cmd: 'ucinewgame' });
}

function waitReady(ms=800){
  if (_readySeen) return Promise.resolve();
  return new Promise((resolve)=>{
    const tid = setTimeout(()=> resolve(), ms);
    _readyWaiters.push(()=>{
      clearTimeout(tid);
      resolve();
    });
  });
}

export async function getEngineBestMove({ fen, movetimeMs = 600 }){
  startEngineWorker();

  // Light wait for readyok; don't block UX too long
  await waitReady(800);

  // Send commands in both styles just in case the nested-worker wants {cmd:...}
  _w.postMessage({ cmd: 'ucinewgame' });
  _w.postMessage('ucinewgame');

  _w.postMessage({ cmd: positionFromFEN(fen) });
  _w.postMessage(positionFromFEN(fen));

  // Promise for the bestmove
  const moveP = new Promise((resolve) => {
    _awaiters.push(resolve);
  });

  // Kick search
  const go = goMoveTime(movetimeMs);
  _w.postMessage({ cmd: go });
  _w.postMessage(go);

  // Safety timeout: if no bestmove in time, resolve with "0000"
  const timeoutP = new Promise((resolve)=> setTimeout(()=> resolve('0000'), Math.max(1200, movetimeMs + 500)));

  const uci = await Promise.race([moveP, timeoutP]);
  return uci;
}
