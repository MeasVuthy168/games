// js/engine-pro.js
// Single-controller for the UCI engine with strict handshake & adaptive send.
// Exposes: setEngineDebugLogger(fn), getEngineBestMove({ fen, movetimeMs }), _debug__peekWorkerURL()

let _log = () => {};
export function setEngineDebugLogger(fn){ _log = typeof fn === 'function' ? fn : () => {}; }

const WORKER_URL = new URL('./js/engine.worker.js', self.location.href).href;
export function _debug__peekWorkerURL(){ return WORKER_URL; }

let _w = null;
let _ready = false;
let _msgHandlersBound = false;
let _pending = null;   // {resolve,reject,kind:'bestmove', timer}
let _buffer = [];      // early lines before listeners bound
let _seenUciOk = false;
let _seenReadyOk = false;

// Send line adaptively (first without '\n', then with '\n' if needed)
function sendLine(line){
  if (!_w || !line) return;
  try { _w.postMessage(line); } catch {}
}

function sendLineNL(line){
  if (!_w || !line) return;
  const s = line.endsWith('\n') ? line : line + '\n';
  try { _w.postMessage(s); } catch {}
}

function ensureWorker(){
  if (_w) return;
  _w = new Worker(WORKER_URL, { name:'khmer-chess-engine-bridge' });
  _log(`[ENGINE] Starting worker: ${WORKER_URL}`);

  _w.onmessage = (e)=>{
    const d = e?.data;
    const line = (typeof d === 'string') ? d : (d?.data || d?.line || d?.stdout || '');
    if (!line) return;

    // Tap into the debug panel
    _log(line);

    // Buffer only until we bound specific handlers; for safety we don’t need to replay.
    // Parse key UCI tokens:
    if (/^uciok\b/i.test(line)) _seenUciOk = true;
    if (/^readyok\b/i.test(line)) _seenReadyOk = true;

    // Mark engine as "live" if we see any reasonable UCI line
    if (/^(id|option|uciok|readyok|bestmove)\b/i.test(line)) _ready = true;

    // Route bestmove to pending promise
    if (_pending && _pending.kind === 'bestmove'){
      const m = line.match(/^bestmove\s+([a-h][1-8][a-h][1-8][qrbn]?|0000)\b/i);
      if (m){
        const mv = m[1];
        clearTimeout(_pending.timer);
        const r = _pending.resolve; _pending = null;
        r(mv);
      }
    }
  };

  _w.onerror = (err) => {
    _log(`[ENGINE][ERR] Worker error: ${err?.message||String(err)}`);
    if (_pending){ try{ _pending.reject(err); }catch{} _pending = null; }
    try { _w.terminate(); } catch {}
    _w = null; _ready=false; _seenUciOk=false; _seenReadyOk=false;
  };
}

async function handshake(timeoutMs=1200){
  ensureWorker();
  if (_ready && _seenUciOk && _seenReadyOk) return; // already handshaked

  // We run a cautious handshake once:
  // 1) uci (no NL), wait a little; if no output, try with NL.
  // 2) isready (same approach) until we see readyok.
  const t0 = Date.now();

  // Step 1: UCI
  _seenUciOk = false;
  sendLine('uci');
  await waitSmall(120);
  if (!_seenUciOk){ sendLineNL('uci'); }

  // Step 2: ISREADY
  _seenReadyOk = false;
  sendLine('isready');
  let loop = 0;
  while (!_seenReadyOk){
    await waitSmall(60);
    loop++;
    if (_seenReadyOk) break;
    if ((Date.now() - t0) > timeoutMs) throw new Error('engine timeout');
    if (loop % 5 === 0) sendLine('isready'); // gentle retry every ~300ms
  }
  _ready = true;
}

function waitSmall(ms){ return new Promise(res => setTimeout(res, ms)); }

function requestBestMove({ fen, movetimeMs=600 }){
  if (!_w) throw new Error('engine not started');
  if (_pending) throw new Error('engine busy');

  // Prepare a single in-flight request
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (_pending){ _pending = null; reject(new Error('engine timeout')); }
    }, Math.max(400, movetimeMs + 400)); // small cushion over movetime

    _pending = { resolve, reject, timer, kind: 'bestmove' };

    // Clean sequence ONCE:
    sendLine('ucinewgame');
    sendLine('isready');
    sendLineNL(`position fen ${fen}`);
    sendLine(`go movetime ${movetimeMs}`);
  });
}

/** Public API */
export async function getEngineBestMove({ fen, movetimeMs=600 }){
  await handshake(1500).catch(e=>{
    _log(`[ENGINE] Handshake failed: ${e?.message||e}`);
    throw e;
  });
  return await requestBestMove({ fen, movetimeMs });
}
