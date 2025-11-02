// js/debug.js — lightweight in-page console (no worker)
// Plan B: pure-JS AI only

(function(){
  const el = document.getElementById('debug-log');
  const stamp = ()=> new Date().toTimeString().slice(0,8);

  function write(line, kind){
    const prefix = `[${stamp()}]`;
    const out = `${prefix} ${line}\n`;
    if (el){ el.textContent += out; el.scrollTop = el.scrollHeight; }
    (kind==='err' ? console.error : console.log)(out);
  }

  // expose for other modules (ai.js uses dbgLog)
  window.__dbglog = write;
  window.dbgLog = write;

  write('Debug console ready.');

  const btnClear = document.getElementById('dbg-clear');
  const btnCopy  = document.getElementById('dbg-copy');
  const btnRun   = document.getElementById('dbg-run-checks');
  const btnAITest= document.getElementById('dbg-ai-test'); // <- new id

  if (btnClear) btnClear.addEventListener('click', ()=>{ if (el) el.textContent=''; });
  if (btnCopy)  btnCopy.addEventListener('click', async ()=>{
    try{
      await navigator.clipboard.writeText(el?.textContent||'');
      write('Copied to clipboard.', 'ok');
    }catch(e){
      write('Copy failed: '+(e?.message||e),'err');
    }
  });

  // Quick environment checks for Plan B
  if (btnRun) btnRun.addEventListener('click', async ()=>{
    write('Running path checks (Plan B: pure-JS)...');

    // 1) Opening book (optional)
    try{
      const r = await fetch('assets/book-khmer.json', {cache:'no-store'});
      write(`Book fetch assets/book-khmer.json -> ${r.status} ${r.ok?'OK':'ERR'}`);
    }catch(e){
      write(`Book fetch failed: ${e?.message||e}`, 'err');
    }

    // 2) ai.js can be imported
    try{
      const m = await import('./ai.js');
      const keys = Object.keys(m||{});
      write(`ai.js imported: exports = [${keys.join(', ')}]`);
    }catch(e){
      write(`ai.js import failed: ${e?.message||e}`, 'err');
    }

    // 3) Warn if Pro-engine files still exist (you chose Plan B)
    // HEAD avoids large downloads
    const probe = async (p)=> {
      try{
        const r = await fetch(p, {method:'HEAD', cache:'no-store'});
        if (r.ok) write(`⚠ Found leftover Pro engine file: ${p} (delete for Plan B)`, 'err');
      }catch{}
    };
    await probe('engine/fairy-stockfish.wasm');
    await probe('engine/fairy-stockfish.js');
    await probe('js/engine.worker.js');
    await probe('js/engine-pro.js');
  });

  // Simple AI self-test using the current game (if available)
  if (btnAITest) btnAITest.addEventListener('click', async ()=>{
    write('AI self-test…');
    try{
      const { chooseAIMove } = await import('./ai.js');

      // Try to find a live game instance created by your app
      const cand =
        window.__game || window.game || window.APP?.game ||
        window.__app?.game || null;

      if (!cand){
        write('No game instance found on window. Open a board first, then retry.', 'err');
        return;
      }

      // Ask for a move at Hard to exercise the search
      const mv = await chooseAIMove(cand, { level:'Hard' });
      if (mv){
        write(`AI chose: ${String.fromCharCode(97+mv.from.x)}${8-mv.from.y} -> ${String.fromCharCode(97+mv.to.x)}${8-mv.to.y}`, 'ok');
      }else{
        write('AI returned no move (possibly checkmate/stalemate or no legal moves).', 'err');
      }
    }catch(e){
      write(`AI test error: ${e?.message||e}`, 'err');
    }
  });
})();
