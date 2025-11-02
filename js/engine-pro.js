// js/engine-pro.js
// Extended handshake for Fairy-Stockfish global-mode (Makruk/Ouk builds)

let _log = () => {};
export function setEngineDebugLogger(fn){ _log = typeof fn === 'function' ? fn : () => {}; }

const WORKER_URL = new URL('./js/engine.worker.js', self.location.href).href;
let _w = null;
let _ready = false;
let _pending = null;
let _seenUciOk = false;
let _seenReadyOk = false;

function send(line){ if(_w) _w.postMessage(line); }
function sendNL(line){ if(_w) _w.postMessage(line.endsWith('\n')?line:line+'\n'); }

function ensureWorker(){
  if(_w) return;
  _w = new Worker(WORKER_URL, { name:'khmer-chess-engine-bridge' });
  _log(`[ENGINE] Starting worker: ${WORKER_URL}`);
  _w.onmessage = (e)=>{
    const d = e?.data;
    const line = (typeof d === 'string') ? d : (d?.data||d?.line||d?.stdout||'');
    if(!line) return;
    _log(line);
    if(/uciok/i.test(line)) _seenUciOk = true;
    if(/readyok/i.test(line)) _seenReadyOk = true;
    if(/id name|option|uciok|readyok|bestmove/i.test(line)) _ready = true;
    if(_pending && /^bestmove\s+([a-h][1-8][a-h][1-8]|0000)/i.test(line)){
      clearTimeout(_pending.timer);
      const mv = line.split(/\s+/)[1];
      _pending.resolve(mv); _pending=null;
    }
  };
  _w.onerror = (err)=>{ _log(`[ENGINE][ERR] ${err?.message||err}`); try{_w.terminate();}catch{} _w=null; };
}

function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function handshake(timeoutMs=2500){
  ensureWorker();
  if(_ready && _seenReadyOk) return;
  _log('[ENGINE] Handshake starting (global-mode extension)...');
  const t0 = Date.now();

  // 1) uci
  send('uci'); await wait(100); sendNL('uci');
  // 2) variant setup (both makruk & ouk for compatibility)
  send('setoption name UCI_Variant value makruk');
  send('setoption name UCI_Variant value ouk');
  // 3) readiness
  send('isready');
  while(!_seenUciOk && !_seenReadyOk && (Date.now()-t0)<timeoutMs){
    await wait(100);
  }
  _ready = true;
  _log('[ENGINE] Handshake complete.');
}

function requestBestMove({fen,movetimeMs=600}){
  return new Promise((resolve,reject)=>{
    const timer = setTimeout(()=>{ if(_pending){_pending=null;reject(new Error('engine timeout'));}}, movetimeMs+800);
    _pending={resolve,reject,timer};
    send('ucinewgame');
    send('isready');
    send(`position fen ${fen}`);
    send(`go movetime ${movetimeMs}`);
  });
}

export async function getEngineBestMove({fen,movetimeMs=600}){
  await handshake().catch(e=>{_log(`[ENGINE] Handshake failed: ${e}`); throw e;});
  return await requestBestMove({fen,movetimeMs});
}
