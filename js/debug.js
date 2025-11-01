// js/debug.js — temporary on-page console

import { setEngineDebugLogger, _debug__peekWorkerURL } from './engine-pro.js';

const el = document.getElementById('debug-log');
const btnClear = document.getElementById('dbg-clear');
const btnCopy  = document.getElementById('dbg-copy');
const btnCheck = document.getElementById('dbg-run-checks');

function now(){ const d=new Date(); return d.toISOString().split('T')[1].replace('Z',''); }
function line(txt, cls=''){
  if(!el) return;
  const span = document.createElement('div');
  if (cls) span.className = cls;
  span.textContent = `[${now()}] ${txt}`;
  el.appendChild(span);
  el.scrollTop = el.scrollHeight;
}

line('Debug console ready.', 'ok');

// Mirror console.error/warn into panel (keep originals)
const _ce = console.error.bind(console);
const _cw = console.warn.bind(console);
const _cl = console.log.bind(console);

console.error = (...a)=>{ line(a.map(String).join(' '), 'err'); _ce(...a); };
console.warn  = (...a)=>{ line(a.map(String).join(' '), 'warn'); _cw(...a); };
console.log   = (...a)=>{ line(a.map(String).join(' ')); _cl(...a); };

// Global error taps
window.addEventListener('error', (e)=>{
  line(`Page error: ${e.message} @ ${e.filename}:${e.lineno}`, 'err');
});
window.addEventListener('unhandledrejection', (e)=>{
  line(`Unhandled rejection: ${e.reason && e.reason.message ? e.reason.message : String(e.reason)}`, 'err');
});

// Buttons
btnClear?.addEventListener('click', ()=>{ el.textContent=''; line('Cleared.'); });
btnCopy ?.addEventListener('click', async ()=>{
  const txt = Array.from(el.querySelectorAll('div')).map(d=>d.textContent).join('\n');
  try{ await navigator.clipboard.writeText(txt); line('Copied to clipboard.', 'ok'); }
  catch{ line('Copy failed.', 'err'); }
});

// Path checks
btnCheck?.addEventListener('click', async ()=>{
  line('Running path checks...', 'warn');
  const tests = [
    { url: 'engine/fairy-stockfish.js',  label: 'JS'   },
    { url: 'engine/fairy-stockfish.wasm',label: 'WASM' }
  ];
  for (const t of tests){
    try{
      const r = await fetch(t.url, { method:'GET', cache:'no-store' });
      line(`${t.label} fetch ${t.url} -> ${r.status} ${r.ok?'OK':'FAIL'}`, r.ok?'ok':'err');
    }catch(err){
      line(`${t.label} fetch ${t.url} -> ${err}`, 'err');
    }
  }
  const wurl = _debug__peekWorkerURL?.();
  if (wurl) line(`Worker URL resolved to: ${wurl}`, 'ok');
});

// Feed engine logs into panel
setEngineDebugLogger((msg, kind='log')=>{
  const cls = kind==='err' ? 'err' : (kind==='warn'?'warn':'');
  line(msg, cls);
});

// First auto-check (optional)
// btnCheck?.click();
