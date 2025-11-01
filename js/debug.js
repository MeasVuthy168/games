// js/debug.js — in-page debug console & buttons
(function(){
  const el = document.getElementById('debug-log');
  const stamp = ()=> new Date().toTimeString().slice(0,8);
  function write(line, kind){
    const prefix = `[${stamp()}]`;
    const out = `${prefix} ${line}\n`;
    if (el){ el.textContent += out; el.scrollTop = el.scrollHeight; }
    (kind==='err' ? console.error : console.log)(out);
  }
  window.__dbglog = write;
  write('Debug console ready.');

  const btnClear = document.getElementById('dbg-clear');
  const btnCopy  = document.getElementById('dbg-copy');
  const btnRun   = document.getElementById('dbg-run-checks');

  if (btnClear) btnClear.addEventListener('click', ()=>{ if (el) el.textContent=''; });
  if (btnCopy)  btnCopy.addEventListener('click', async ()=>{
    try{ await navigator.clipboard.writeText(el?.textContent||''); write('Copied to clipboard.', 'ok'); }catch(e){ write('Copy failed: '+(e?.message||e),'err'); }
  });

  if (btnRun) btnRun.addEventListener('click', async ()=>{
    write('Running path checks...');
    try{
      const js = await fetch('engine/fairy-stockfish.js', { cache:'no-store' });
      write(`JS fetch engine/fairy-stockfish.js -> ${js.status} ${js.ok?'OK':'ERR'}`);
    }catch(e){ write(`JS fetch failed: ${e?.message||e}`,'err'); }

    try{
      const wasm = await fetch('engine/fairy-stockfish.wasm', { cache:'no-store' });
      write(`WASM fetch engine/fairy-stockfish.wasm -> ${wasm.status} ${wasm.ok?'OK':'ERR'}`);
    }catch(e){ write(`WASM fetch failed: ${e?.message||e}`,'err'); }

    try{
      // Show resolved absolute worker URL in UI (engine-pro computes it)
      import('./engine-pro.js').then(mod=>{
        const url = mod._debug__peekWorkerURL?.() || '(unknown)';
        write(`Worker URL resolved to: ${url}`);
        const span = document.getElementById('dbg-worker-url'); if (span) span.textContent = url;
      });
    }catch(e){
      write(`worker URL resolve failed: ${e?.message||e}`, 'err');
    }
  });
})();
