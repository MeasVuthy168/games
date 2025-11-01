// js/engine.worker.js
// Bridge worker that prefers ESM module engine with a Classic fallback.
// It does NOT auto-send uci/isready anymore. The controller (engine-pro.js) handles that.

(() => {
  const log = (t) => { try { postMessage(t); } catch {} };

  const here      = new URL(self.location.href);
  const jsDir     = new URL('./', here);
  const root      = new URL('../', jsDir);
  const engineDir = new URL('engine/', root);

  const wasmURL   = new URL('fairy-stockfish.wasm', engineDir).href;
  const jsURL     = new URL('fairy-stockfish.js',   engineDir).href;
  const loaderURL = new URL('uci-loader.module.js', engineDir);
  loaderURL.searchParams.set('wasm', wasmURL);

  let inner = null;
  const q = [];

  function postStdout(s) {
    try { postMessage(s); } catch {}
  }

  // only single normalized format (string, with newline)
  function send(line) {
    if (!line) return;
    const msg = line.endsWith('\n') ? line : (line + '\n');
    if (inner) inner.postMessage(msg);
    else q.push(msg);
  }
  function flush(){ if (!inner) return; while(q.length) inner.postMessage(q.shift()); }

  function startModuleThenFallback(){
    try{
      inner = new Worker(loaderURL, { type:'module', name:'fairy-stockfish-esm' });
      let gotAny = false;

      const arm = setTimeout(() => {
        if (!gotAny) {
          try{ inner.terminate(); }catch{}
          inner = null;
          log('[ENGINE] [FALLBACK] Classic shim (no ESM output)');
          startClassicShim();
        }
      }, 450);

      inner.onmessage = (e)=>{
        gotAny = true;
        const d = e?.data;
        if (typeof d === 'string') { postStdout(d); return; }
        const s = d?.data || d?.line || d?.stdout;
        if (typeof s === 'string') { postStdout(s); return; }
      };
      inner.onerror = (err)=>{
        try { postMessage('[ENGINE][ERR] Module worker error: ' + (err?.message||String(err))); } catch {}
      };

      // no kicks here — controller will send commands
      postStdout('[ENGINE] [ESM] loader: ' + loaderURL.href);
    }catch(e){
      postStdout('[ENGINE][ERR] Cannot start ESM: ' + (e?.message||String(e)));
      startClassicShim();
    }
  }

  function startClassicShim(){
    const blobSrc =
`(function(){
  const wasm='${wasmURL}';
  const js  ='${jsURL}';
  self.Module = {
    locateFile(p){ return (typeof p==='string' && p.endsWith('.wasm')) ? wasm : p; },
    print(l){ try{ postMessage(String(l)); }catch{} },
    printErr(l){ try{ postMessage(String(l)); }catch{} },
  };
  importScripts(js);

  let engine=null;
  try{
    if (typeof self.FairyStockfish === 'function') engine=self.FairyStockfish();
    else if (typeof self.Stockfish === 'function') engine=self.Stockfish();
  }catch(_){}

  if (engine && typeof engine.postMessage === 'function'){
    engine.onmessage = (e)=>{
      const d=e?.data;
      if (typeof d==='string'){ try{ postMessage(d); }catch{}; return; }
      const s=d?.data||d?.line||d?.stdout;
      if (typeof s==='string'){ try{ postMessage(s); }catch{}; return; }
    };
    self.onmessage = (e)=>{
      const dat=e?.data;
      const line=(typeof dat==='string')?dat:(dat?.cmd||dat?.uci||dat?.data||dat?.stdin||'');
      if (!line) return;
      engine.postMessage(line.endsWith('\\n')?line:(line+'\\n'));
    };
    try{ postMessage('[ENGINE] [CLASSIC] Worker online'); }catch{}
    try{ postMessage('[ENGINE] [CLASSIC] WASM: '+wasm); }catch{}
    try{ postMessage('[ENGINE] [CLASSIC] JS:   '+js); }catch{}
    return;
  }
  try{ postMessage('[ENGINE] [CLASSIC] Global-mode (no factory)'); }catch{}
})();`;

    const blob = new Blob([blobSrc], { type:'application/javascript' });
    const url  = URL.createObjectURL(blob);
    inner = new Worker(url, { name:'fairy-classic-shim' });

    inner.onmessage = (e)=>{
      const d=e?.data;
      if (typeof d==='string'){ postStdout(d); return; }
      const s=d?.data||d?.line||d?.stdout;
      if (typeof s==='string'){ postStdout(s); return; }
    };
    inner.onerror = (err)=>{
      try{ postMessage('[ENGINE][ERR] Classic shim error: ' + (err?.message||String(err))); }catch{}
    };
    // no kicks — controller will send
  }

  // Relay from main thread
  self.onmessage = (e)=>{
    const dat = e?.data;
    const line = (typeof dat === 'string') ? dat : (dat?.cmd || dat?.uci || dat?.data || dat?.stdin || '');
    if (!line) return;
    send(line);
  };

  // Boot
  startModuleThenFallback();
})();
