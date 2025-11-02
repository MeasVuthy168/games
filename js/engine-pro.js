// js/engine-pro.js
// Handshake & bestmove request with support for classic/global engine workers.

let _log = () => {};
export function setEngineDebugLogger(fn){ _log = typeof fn === 'function' ? fn : () => {}; }

const WORKER_URL = new URL('./js/engine.worker.js', self.location.href).href;
export function _debug__peekWorkerURL(){ return WORKER_URL; } // so UI won’t show (unknown)

let _w = null;
let _ready = false;
let _pending = null;
let _seenUciOk = false;
let _seenReadyOk = false;

function send(line){ if(_w) _w.postMessage(line); }
function sendNL(line){ if(_w) _w.postMessage(line.endsWith('\n')?line:line+'\n'); }
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));

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

    if(/id name|option|uciok|readyok|bestmove/i.test(line)) {
      _ready = true;
    }

    // Capture bestmove
    const m = /^bestmove\s+([a-h][1-8][a-h][1-8]|0000)/i.exec(line);
    if(m && _pending){
      clearTimeout(_pending.timer);
      _pending.resolve(m[1]); _pending = null;
    }
  };
  _w.onerror = (err)=>{ _log(`[ENGINE][ERR] ${err?.message||err}`); try{_w.terminate();}catch{} _w=null; };
}

async function handshake(timeoutMs=2500){
  ensureWorker();
  if(_ready && _seenReadyOk) return;
  _log('[ENGINE] Handshake starting (global-mode extension)...');

  const t0 = Date.now();

  // 1) uci (both raw & newline forms)
  send('uci'); await sleep(80); sendNL('uci');

  // 2) try variants used by Fairy-Stockfish ports
  send('setoption name UCI_Variant value makruk');
  send('setoption name UCI_Variant value ouk');

  // 3) readiness
  send('isready');

  // wait loop
  while((!_seenUciOk || !_seenReadyOk) && (Date.now()-t0)<timeoutMs){
    await sleep(100);
  }

  _ready = true;
  _log('[ENGINE] Handshake complete.');
}

function requestBestMove({fen,movetimeMs=600}){
  return new Promise((resolve,reject)=>{
    const timer = setTimeout(()=>{
      if(_pending){ _pending=null; reject(new Error('engine timeout')); }
    }, movetimeMs + 1200);
    _pending = { resolve, reject, timer };
    send('ucinewgame');
    send('isready');
    send(`position fen ${fen}`);
    send(`go movetime ${movetimeMs}`);
  });
}

export async function getEngineBestMove({ fen, movetimeMs = 600 }){
  await handshake().catch(e=>{ _log(`[ENGINE] Handshake failed: ${e?.message||e}`); throw e; });
  return await requestBestMove({ fen, movetimeMs });
}
