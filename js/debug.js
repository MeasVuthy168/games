// js/debug.js — in-page debug console & buttons
(function(){
  const logEl   = document.getElementById('debug-log');
  const urlEl   = document.getElementById('dbg-worker-url');
  const btnClear= document.getElementById('dbg-clear');
  const btnCopy = document.getElementById('dbg-copy');
  const btnRun  = document.getElementById('dbg-run-checks');
  const btnForce= document.getElementById('dbg-force') || document.getElementById('dbg-engine-test');

  const stamp = ()=> new Date().toTimeString().slice(0,8);
  function write(line, kind){
    const out = `[${stamp()}] ${line}\n`;
    if (logEl){ logEl.textContent += out; logEl.scrollTop = logEl.scrollHeight; }
    (kind==='err' ? console.error : console.log)(out);
  }
  // expose for other modules (ai.js uses window.dbgLog)
  window.__dbglog = write;
  window.dbgLog   = write;

  write('Debug console ready.');

  // ---- Worker URL resolution (robust) ----
  async function peekWorkerURL(){
    // Try via engine-pro helper (preferred)
    try{
      const mod = await import('./engine-pro.js');
      const fromMod = mod?._debug__peekWorkerURL?.();
      if (fromMod) return fromMod;
    }catch(e){
      // ignore; we’ll use fallback below
    }
    // Fallback: resolve relative to the current page + cache-bust
    try{
      const u = new URL('./js/engine.worker.js', window.location.href);
      if (!u.searchParams.has('v')) u.searchParams.set('v', String(Date.now()));
      return u.href;
    }catch{
      return '(unknown)';
    }
  }

  // Show Worker URL immediately
  (async ()=>{
    const url = await peekWorkerURL();
    if (urlEl) urlEl.textContent = url;
  })();

  // ---- Buttons ----
  if (btnClear) btnClear.addEventListener('click', ()=>{ if (logEl) logEl.textContent=''; });
  if (btnCopy){
    btnCopy.addEventListener('click', async ()=>{
      try{
        await navigator.clipboard.writeText(logEl?.textContent||'');
        write('Copied to clipboard.', 'ok');
      }catch(e){ write('Copy failed: '+(e?.message||e),'err'); }
    });
  }

  if (btnRun){
    btnRun.addEventListener('click', async ()=>{
      write('Running path checks...');
      // 1) JS
      try{
        const r = await fetch('engine/fairy-stockfish.js', { cache:'no-store' });
        write(`JS fetch engine/fairy-stockfish.js -> ${r.status} ${r.ok?'OK':'ERR'}`);
      }catch(e){ write(`JS fetch failed: ${e?.message||e}`, 'err'); }
      // 2) WASM
      try{
        const r = await fetch('engine/fairy-stockfish.wasm', { cache:'no-store' });
        write(`WASM fetch engine/fairy-stockfish.wasm -> ${r.status} ${r.ok?'OK':'ERR'}`);
      }catch(e){ write(`WASM fetch failed: ${e?.message||e}`, 'err'); }
      // 3) Worker URL (same logic as initial render)
      try{
        const url = await peekWorkerURL();
        write(`Worker URL resolved to: ${url}`);
        if (urlEl) urlEl.textContent = url;
      }catch(e){
        write(`worker URL resolve failed: ${e?.message||e}`, 'err');
      }
    });
  }

  // Optional: Force Engine Test (if the button exists in the page)
  if (btnForce){
    btnForce.addEventListener('click', async ()=>{
      try{
        const { getEngineBestMove } = await import('./engine-pro.js');
        write('[ENGINE] Forcing self-test…');
        // simple opening-like FEN for test
        const fen = 'rnbqkbnr/8/pppppppp/8/4P3/PPPP1PPP/8/RNBKQBNR b - - 0 1';
        const uci = await getEngineBestMove({ fen, movetimeMs: 600 });
        write(`[ENGINE] Self-test bestmove: ${uci}`);
      }catch(e){
        write(`[ENGINE] Self-test error: ${e?.message||e}`, 'err');
      }
    });
  }
})();
