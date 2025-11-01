// js/debug.js
const $log   = document.getElementById('debug-log');
const $run   = document.getElementById('dbg-run-checks');
const $force = document.getElementById('dbg-force');
const $copy  = document.getElementById('dbg-copy');
const $clear = document.getElementById('dbg-clear');

function now(){
  const d=new Date();
  return `[${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}.${String(d.getMilliseconds()).padStart(3,'0')}]`;
}
export function dbgLog(msg){
  if(!$log) return;
  const line = `${now()} ${msg}`;
  $log.textContent += ($log.textContent?'\n':'') + line;
  $log.scrollTop = $log.scrollHeight;
  console.log(line);
}
window.dbgLog = dbgLog;
dbgLog('Debug console ready.');

function resolved(href){ return new URL(href, location.href).href; }
async function head(url){
  try{ const r=await fetch(url,{method:'GET',cache:'no-store'}); return `${r.status} ${r.ok?'OK':r.statusText}`; }
  catch(e){ return 'ERROR '+(e?.message||e); }
}

async function runPathChecks(){
  dbgLog('Running path checks...');
  dbgLog(`JS fetch engine/fairy-stockfish.js -> ${await head(resolved('engine/fairy-stockfish.js'))}`);
  dbgLog(`WASM fetch engine/fairy-stockfish.wasm -> ${await head(resolved('engine/fairy-stockfish.wasm'))}`);
  dbgLog(`Worker URL resolved to: ${resolved('js/engine.worker.js?v='+Date.now())}`);
}

async function selfTest(){
  try{
    dbgLog('[ENGINE] Forcing self-test…');
    const { getEngineBestMove, startEngineWorker } = await import('./engine-pro.js');
    startEngineWorker?.();
    const fen = 'rnbqkbnr/8/pppppppp/8/4P3/PPPP1PPP/8/RNBKQBNR b - - 0 1';
    dbgLog('[ENGINE] Request bestmove: movetime=600ms, FEN=' + fen.slice(0,80) + '...');
    const uci = await getEngineBestMove({ fen, movetimeMs: 600 });
    dbgLog('[ENGINE] bestmove -> ' + (uci || '(null)'));
  }catch(e){
    dbgLog('[ENGINE] Self-test error: ' + (e?.message||e));
  }
}

$run?.addEventListener('click', async ()=>{ await runPathChecks(); });
$force?.addEventListener('click', async ()=>{ await selfTest(); });
$copy?.addEventListener('click', async ()=>{
  try{ await navigator.clipboard.writeText($log?.textContent||''); dbgLog('Copied to clipboard.'); }
  catch(e){ dbgLog('Copy failed: ' + (e?.message||e)); }
});
$clear?.addEventListener('click', ()=>{ if($log) $log.textContent=''; });

// Listen for UCI echoes from worker (engine-pro also mirrors them)
window.addEventListener('message', (e)=>{
  const d=e?.data;
  if(d && typeof d==='object' && d.type==='uci' && typeof d.line==='string'){
    dbgLog(`UCI: ${d.line}`);
  }
});
