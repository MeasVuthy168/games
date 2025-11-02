// js/main.js — bootstrap + AI spinner + debug bus
// - Calls initUI and ensures window.game is set (for AI hook)
// - Adds a small thinking spinner overlay (listens to ai:start / ai:end)
// - Exposes a simple debug logger when ?debug=1

import { initUI } from './ui.js';

//////////////////////// URL / Settings ////////////////////////
const QS = new URLSearchParams(location.search);

const LS_KEY = 'kc_settings_v1';
function loadSettings(){ try{ return JSON.parse(localStorage.getItem(LS_KEY)||'null')||{} }catch{ return {} } }
function saveSettings(s){ localStorage.setItem(LS_KEY, JSON.stringify(s)); }

const settings = loadSettings();
const mode = QS.get('mode') || (settings.aiEnabled ? 'ai' : 'friend');

// If user came from Home’s “Play vs AI (Master)”, those flags are stored there.
const aiEnabled = mode === 'ai';
const aiColor   = settings.aiColor || 'b'; // default: AI plays Black (you play White)

//////////////////////// Spinner overlay ////////////////////////
function ensureSpinner(){
  if (document.getElementById('aiThinking')) return;
  const el = document.createElement('div');
  el.id = 'aiThinking';
  el.style.cssText = `
    position:fixed; inset:auto 0 env(safe-area-inset-bottom) 0;
    bottom:70px; display:none; justify-content:center; align-items:center;
    z-index:9999; pointer-events:none;
  `;
  el.innerHTML = `
    <div style="
      background:rgba(0,0,0,.45); color:#fff; padding:.55rem .8rem; border-radius:999px;
      display:flex; align-items:center; gap:.55rem; font-weight:700; font-family:system-ui,sans-serif;
      box-shadow:0 8px 24px rgba(0,0,0,.25);
    ">
      <div class="ring" style="
        width:18px; height:18px; border-radius:50%;
        border:3px solid rgba(255,255,255,.28);
        border-top-color:#fff; animation:spin .9s linear infinite;
      "></div>
      <span>AI กំពុងគិត…</span>
    </div>
  `;
  const style = document.createElement('style');
  style.textContent = `@keyframes spin{to{transform:rotate(360deg)}}`;
  document.head.appendChild(style);
  document.body.appendChild(el);
}
function showSpinner(v){
  const el = document.getElementById('aiThinking');
  if (!el) return;
  el.style.display = v ? 'flex' : 'none';
}

//////////////////////// Debug bus (optional) ////////////////////////
const DEBUG_ON = QS.get('debug') === '1' || QS.get('debug') === 'true';

function attachDebugBus(){
  if (!DEBUG_ON) return;
  // Simple logger function other scripts can call: window.__dbglog(msg, kind)
  window.__dbglog = (msg, kind='info') => {
    try{
      console[kind === 'error' ? 'error' : (kind === 'warn' ? 'warn' : 'log')](msg);
      const panel = document.getElementById('dbgPanel');
      if (panel){
        const row = document.createElement('div');
        row.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        row.style.cssText = 'padding:.25rem .5rem;border-bottom:1px solid #eee;font-size:.9rem;';
        panel.appendChild(row);
        panel.scrollTop = panel.scrollHeight;
      }
    }catch{}
  };

  // Small collapsible panel
  if (!document.getElementById('dbgWrap')){
    const wrap = document.createElement('div');
    wrap.id = 'dbgWrap';
    wrap.style.cssText = `
      position:fixed; left:0; right:0; bottom:0; z-index:9998;
      background:#fff; border-top:1px solid #ddd; box-shadow:0 -8px 24px rgba(0,0,0,.12);
      max-height:42vh; display:flex; flex-direction:column;
    `;
    wrap.innerHTML = `
      <div style="display:flex; align-items:center; padding:.4rem .6rem; gap:.5rem">
        <strong style="font-family:system-ui">Debug/Test</strong>
        <div style="margin-inline-start:auto; display:flex; gap:.4rem">
          <button id="dbgFen"  style="padding:.25rem .6rem">FEN</button>
          <button id="dbgUndo" style="padding:.25rem .6rem">Undo</button>
          <button id="dbgClear"style="padding:.25rem .6rem">Clear</button>
          <button id="dbgClose"style="padding:.25rem .6rem">Hide</button>
        </div>
      </div>
      <div id="dbgPanel" style="overflow:auto; padding:.25rem .25rem;"></div>
    `;
    document.body.appendChild(wrap);

    document.getElementById('dbgClose').onclick = ()=> (wrap.style.display='none');
    document.getElementById('dbgClear').onclick = ()=>{
      const p=document.getElementById('dbgPanel'); p.innerHTML='';
    };
    document.getElementById('dbgFen').onclick = ()=>{
      try{
        const fen = window.game?.toFEN?.() || '(no FEN)';
        window.__dbglog(`FEN: ${fen}`);
      }catch(e){ window.__dbglog(`FEN error: ${e?.message||e}`, 'error'); }
    };
    document.getElementById('dbgUndo').onclick = ()=>{
      try{
        window.game?.undo?.();
        window.__dbglog('Undo requested');
      }catch(e){ window.__dbglog(`Undo error: ${e?.message||e}`, 'error'); }
    };
  }
}

//////////////////////// Boot logic ////////////////////////
async function boot(){
  ensureSpinner();
  attachDebugBus();

  // Tell the UI what mode to use (friend vs ai). Some UIs read from URL; this is extra.
  window.dispatchEvent(new CustomEvent('kc:set-mode', { detail:{ mode, aiEnabled, aiColor } }));

  // initUI may return a game instance OR assign window.game internally.
  let game;
  try{
    game = await initUI?.({ mode, aiEnabled, aiColor }) ?? null;
  }catch(e){
    console.error('initUI failed:', e);
  }

  // Fallback: poll a bit for window.game if initUI didn't return it
  if (!game){
    for (let i=0;i<40;i++){ // ~2s
      if (window.game){ game = window.game; break; }
      await new Promise(r=>setTimeout(r,50));
    }
  }
  if (!game){
    console.error('Game instance not found. Ensure initUI creates and/or exposes window.game');
    return;
  }
  window.game = game; // guarantee global for ai-hook / other modules
  window.__dbglog?.('Game ready');

  // Let ai-hook.js know we’re ready (it will attach listeners and start AI if mode=ai)
  window.dispatchEvent(new CustomEvent('kc:ready', { detail:{ mode, aiEnabled, aiColor } }));

  // Spinner wiring: ai-hook should fire these events around think()
  window.addEventListener('ai:start', ()=> showSpinner(true));
  window.addEventListener('ai:end',   ()=> showSpinner(false));

  // Safety: if AI is enabled and it’s AI’s turn right now, hint spinner (in case hook misses)
  if (aiEnabled){
    setTimeout(()=>{
      try{
        const side = game?.turn || game?.getTurn?.();
        if (side && side === aiColor) showSpinner(true);
      }catch{}
    }, 60);
  }
}

//////////////////////// Global error logging ////////////////////////
window.addEventListener('error', (e) => {
  console.log('Runtime error:', e.error || e.message);
  window.__dbglog?.(`Runtime error: ${e.message || e.error}`, 'error');
});
window.addEventListener('unhandledrejection', (e) => {
  console.log('Unhandled promise rejection:', e.reason);
  window.__dbglog?.(`Promise rejection: ${e.reason}`, 'error');
});

//////////////////////// Start ////////////////////////
if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', boot, { once:true });
} else {
  boot();
}
