// js/engine-pro.js
let _log = () => {};
export function setEngineDebugLogger(fn){ _log = typeof fn === 'function' ? fn : () => {}; }

// Resolve the worker URL RELATIVE to the page, and add a cache buster
function _resolveWorkerURL(){
  const u = new URL('./js/engine.worker.js', window.location.href);
  // cache-bust so old SW-cached workers don't linger
  if (!u.searchParams.has('v')) u.searchParams.set('v', String(Date.now()));
  return u.href;
}
const WORKER_URL = _resolveWorkerURL();

// expose for the debug panel
export function _debug__peekWorkerURL(){ return WORKER_URL; }

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
    if(/id name|option|uciok|readyok|bestmove/i.test(line)) _ready = true;

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
  send('uci'); await sleep(80); sendNL('uci');
  send('setoption name UCI_Variant value makruk'); // ok if ignored
  send('setoption name UCI_Variant value ouk');    // ok if ignored
  send('isready');

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
