/* engine.worker.js — universal bridge for Fairy-Stockfish (Ouk Chatrang)
   Modes tried in order:
   1) ESM factory (locateFile)  2) Nested worker  3) Inline-import (classic main)
*/

let engine = null;
let innerWorker = null;
let loaded = false;
let pending = [];
let mode = 'init';

function say(line){ postMessage({ type:'uci', line }); }
function note(m){ say(`[WORKER] ${m}`); }

const WRAP_URL = new URL('../engine/fairy-stockfish.js', self.location).href;
const WASM_URL = new URL('../engine/fairy-stockfish.wasm', self.location).href;

function flush(sendFn){
  while (pending.length){
    const cmd = pending.shift();
    try{ sendFn(cmd); }catch{}
    try{ sendFn({ cmd }); }catch{}
  }
}

function send(cmd){
  if (!loaded){ pending.push(cmd); return; }
  if (mode === 'factory' && engine?.postMessage) return engine.postMessage(cmd);
  if (mode === 'nested'  && innerWorker) {
    try{ innerWorker.postMessage(cmd); }catch{}
    try{ innerWorker.postMessage({ cmd }); }catch{}
    return;
  }
  if (mode === 'inline') {
    // in inline-import, the engine replaced onmessage/postMessage,
    // but we can still try both forms — the engine will ignore what it doesn't use.
    try{ self.dispatchEvent(new MessageEvent('message', { data: cmd })); }catch{}
    try{ self.dispatchEvent(new MessageEvent('message', { data: { cmd } })); }catch{}
  }
}

async function tryFactory(){
  mode = 'try-factory';
  note('Attempting ESM factory…');
  let mod;
  try{
    mod = await import(/* @vite-ignore */ WRAP_URL);
    note('Wrapper loaded as ES module.');
  }catch(e){ note(`ESM import failed: ${e?.message||e}`); return false; }

  try{
    const keys = Object.keys(mod||{});
    note(`ESM exports: ${keys.length?keys.join(', '):'(none)'}`);
    note(`ESM suspects typeof: default=${typeof mod?.default}, FairyStockfish=${typeof mod?.FairyStockfish}, Stockfish=${typeof mod?.Stockfish}`);
  }catch{}

  const factory =
    (typeof mod?.default        === 'function' && mod.default) ||
    (typeof mod?.FairyStockfish === 'function' && mod.FairyStockfish) ||
    (typeof mod?.Stockfish      === 'function' && mod.Stockfish) ||
    (typeof self.FairyStockfish === 'function' && self.FairyStockfish) ||
    (typeof self.Stockfish      === 'function' && self.Stockfish) || null;

  if (!factory){ note('No factory export found.'); return false; }

  try{
    engine = await factory({ locateFile: (p)=> p.endsWith('.wasm') ? WASM_URL : p });
    // stdout → main
    if (typeof engine.addMessageListener === 'function'){
      engine.addMessageListener((line)=> say(line));
    } else if (typeof engine.onmessage === 'function'){
      const prev = engine.onmessage;
      engine.onmessage = (line)=>{ try{ say(line); }catch{} prev && prev(line); };
    } else if (typeof engine.addEventListener === 'function'){
      engine.addEventListener('message', (e)=> say(e?.data ?? ''));
    }
  }catch(e){
    note(`Factory init failed: ${e?.message||e}`);
    return false;
  }

  mode = 'factory'; loaded = true;
  // UCI init
  send('uci');
  send('setoption name UCI_Variant value Ouk Chatrang');
  send('setoption name CountingRule value cambodian');
  send('isready');
  flush((m)=> engine.postMessage(m));
  note('Engine ready (factory mode).');
  return true;
}

async function tryNested(){
  mode = 'try-nested';
  note('Attempting nested-worker mode…');
  try{
    innerWorker = new Worker(WRAP_URL); // classic worker
  }catch(e){
    note(`Nested worker create failed: ${e?.message||e}`);
    return false;
  }

  innerWorker.onmessage = (e)=>{
    const d = e?.data;
    const line =
      (typeof d === 'string') ? d :
      (d && typeof d.data === 'string') ? d.data :
      (d && typeof d.stdout === 'string') ? d.stdout :
      (d && typeof d.line === 'string') ? d.line :
      (d != null ? String(d) : '');
    say(line);
  };
  innerWorker.addEventListener('error', (e)=> note(`Nested worker error: ${e?.message||e}`)));
  innerWorker.addEventListener('messageerror', (e)=> note('Nested worker messageerror'));

  mode = 'nested'; loaded = true;

  // Some builds need only strings; some accept {cmd}; send both + a repeat
  const kick = ()=>{
    send('uci');                        send({ cmd:'uci' });
    send('setoption name UCI_Variant value Ouk Chatrang'); send({ cmd:'setoption name UCI_Variant value Ouk Chatrang' });
    send('setoption name CountingRule value cambodian');   send({ cmd:'setoption name CountingRule value cambodian' });
    send('isready');                    send({ cmd:'isready' });
  };
  kick();
  setTimeout(kick, 120); // retry shortly in case first batch was ignored

  flush((m)=> innerWorker.postMessage(m));
  note('Engine ready (nested worker mode).');
  return true;
}

async function tryInline(){
  mode = 'try-inline';
  note('Attempting inline-import mode (classic main inside this worker)…');
  // Preserve our onmessage so we can forward cmds if needed
  const hostOnMessage = self.onmessage;

  try{
    importScripts(WRAP_URL);
  }catch(e){
    note(`inline importScripts failed: ${e?.message||e}`);
    return false;
  }

  // At this point, the engine script likely overwrote self.onmessage and started acting
  // as the worker main. Our postMessage() from that script will go straight to the page.
  // We keep a small proxy so cmds queued before are delivered.
  const engineOnMessage = self.onmessage; // after import, this is the engine handler
  if (typeof engineOnMessage !== 'function'){
    note('inline: engine did not register onmessage; cannot proceed.');
    return false;
  }

  // Wrap: our onmessage forwards to engine handler; page still sees engine’s postMessage output.
  self.onmessage = (e)=> engineOnMessage(e);

  loaded = true; mode = 'inline';

  // Kick UCI twice (strings only first, then object)
  const kick = ()=>{
    try{ engineOnMessage(new MessageEvent('message', { data: 'uci' })); }catch{}
    try{ engineOnMessage(new MessageEvent('message', { data: 'setoption name UCI_Variant value Ouk Chatrang' })); }catch{}
    try{ engineOnMessage(new MessageEvent('message', { data: 'setoption name CountingRule value cambodian' })); }catch{}
    try{ engineOnMessage(new MessageEvent('message', { data: 'isready' })); }catch{}

    try{ engineOnMessage(new MessageEvent('message', { data: { cmd:'uci' } })); }catch{}
    try{ engineOnMessage(new MessageEvent('message', { data: { cmd:'setoption name UCI_Variant value Ouk Chatrang' } })); }catch{}
    try{ engineOnMessage(new MessageEvent('message', { data: { cmd:'setoption name CountingRule value cambodian' } })); }catch{}
    try{ engineOnMessage(new MessageEvent('message', { data: { cmd:'isready' } })); }catch{}
  };
  kick(); setTimeout(kick, 120);

  // Flush any queued commands through the wrapped handler
  while (pending.length){
    const cmd = pending.shift();
    try{ engineOnMessage(new MessageEvent('message', { data: cmd })); }catch{}
    try{ engineOnMessage(new MessageEvent('message', { data: { cmd } })); }catch{}
  }

  note('Engine ready (inline-import mode).');
  return true;
}

async function boot(){
  note('Booting…');
  note(`Loading WASM wrapper: ${WRAP_URL}`);
  note(`WASM URL: ${WASM_URL}`);

  if (await tryFactory()) return;
  note('Factory not available.');

  if (await tryNested())  return;
  note('Nested-worker not available.');

  if (await tryInline())  return;
  note('Inline-import failed.');
  note('ERROR: Could not initialize engine in any mode.');
}

self.onmessage = (e)=>{
  const { cmd } = e.data || {};
  if (!loaded) boot().catch(err=> note(`ERROR: ${err?.message||err}`));
  if (cmd) send(cmd);
};

// eager start
boot().catch(err=> note(`ERROR: ${err?.message||err}`));
