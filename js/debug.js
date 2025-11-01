// js/debug.js  — lightweight in-page debug console for Worker/WASM

// ---------- DOM ----------
const $log   = document.getElementById('debug-log');
const $run   = document.getElementById('dbg-run-checks');
const $copy  = document.getElementById('dbg-copy');
const $clear = document.getElementById('dbg-clear');

// Basic style in case .debug-log has no CSS yet
if ($log) {
  $log.style.minHeight = '180px';
  $log.style.maxHeight = '36vh';
  $log.style.overflowY = 'auto';
  $log.style.background = '#0b1220';
  $log.style.color = '#e6f0ff';
  $log.style.padding = '10px';
  $log.style.borderRadius = '10px';
  $log.style.font = '12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  $log.style.whiteSpace = 'pre-wrap';
}

// ---------- Logger ----------
function now() {
  try {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    const ss = String(d.getSeconds()).padStart(2,'0');
    const ms = String(d.getMilliseconds()).padStart(3,'0');
    return `[${hh}:${mm}:${ss}.${ms}]`;
  } catch { return ''; }
}

export function dbgLog(msg) {
  if (!$log) return;
  const line = `${now()} ${msg}`;
  $log.textContent += ( $log.textContent ? '\n' : '' ) + line;
  $log.scrollTop = $log.scrollHeight;
  // also mirror to console for devtools
  // eslint-disable-next-line no-console
  console.log(line);
}

// expose globally so engine-pro / workers can use window.dbgLog?.('...')
window.dbgLog = dbgLog;

// greet
dbgLog('Debug console ready.');

// ---------- Helpers ----------
async function fetchHead(url) {
  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store' });
    return `${res.status} ${res.ok ? 'OK' : res.statusText || ''}`;
  } catch (e) {
    return `ERROR ${e?.message || e}`;
  }
}

function resolved(href) {
  return new URL(href, location.href).href;
}

// ---------- Path checks ----------
async function runPathChecks() {
  dbgLog('Running path checks...');
  const jsUrl  = resolved('engine/fairy-stockfish.js');
  const wasmUrl= resolved('engine/fairy-stockfish.wasm');
  const wUrl   = resolved('js/engine.worker.js');

  const jsStat   = await fetchHead(jsUrl);
  dbgLog(`JS fetch engine/fairy-stockfish.js -> ${jsStat}`);

  const wasmStat = await fetchHead(wasmUrl);
  dbgLog(`WASM fetch engine/fairy-stockfish.wasm -> ${wasmStat}`);

  dbgLog(`Worker URL resolved to: ${wUrl}`);
}

// ---------- Self-test (optional) ----------
async function selfTest() {
  try {
    dbgLog('[ENGINE] Forcing self-test…');
    const { getEngineBestMove, startEngineWorker } = await import('./engine-pro.js');
    startEngineWorker?.();
    // Simple test FEN (same one you used)
    const fen = 'rnbqkbnr/8/pppppppp/8/4P3/PPPP1PPP/8/RNBKQBNR b - - 0 1';
    dbgLog('[ENGINE] Request bestmove: movetime=600ms, FEN=' + fen.slice(0,80) + '...');
    const uci = await getEngineBestMove({ fen, movetimeMs: 600 });
    dbgLog('[ENGINE] bestmove -> ' + (uci || '(none)'));
  } catch (e) {
    dbgLog('[ENGINE] Self-test error: ' + (e?.message || e));
  }
}

// ---------- Wire buttons ----------
$run?.addEventListener('click', async () => {
  await runPathChecks();
  // kick a quick engine test after checks
  await selfTest();
});

$copy?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($log?.textContent || '');
    dbgLog('Copied to clipboard.');
  } catch (e) {
    dbgLog('Copy failed: ' + (e?.message || e));
  }
});

$clear?.addEventListener('click', () => {
  if ($log) $log.textContent = '';
});

// ---------- Listen to worker-originated notes (optional) ----------
// If your engine worker posts {type:'uci', line:'...'} (as in engine.worker.js), mirror here.
window.addEventListener('message', (e) => {
  try {
    const d = e?.data;
    if (d && typeof d === 'object' && d.type === 'uci' && typeof d.line === 'string') {
      dbgLog(`UCI: ${d.line}`);
    }
  } catch {}
});
