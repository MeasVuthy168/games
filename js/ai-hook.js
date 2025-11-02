// js/ai-hook.js
import { chooseAIMove } from './ai.js';

const LS_KEY = 'kc_settings_v1';
function loadSettings(){
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null') || {}; }
  catch { return {}; }
}
function parseMode(){ const u=new URL(location.href); return (u.searchParams.get('mode')||'').toLowerCase(); }

function waitForGame(maxMs=8000){
  return new Promise((resolve,reject)=>{
    const t0=Date.now();
    const iv=setInterval(()=>{
      if (window.game && typeof window.game.at==='function' && typeof window.game.move==='function') {
        clearInterval(iv); resolve(window.game);
      } else if (Date.now()-t0>maxMs){ clearInterval(iv); reject(new Error('game instance not found')); }
    },70);
  });
}

function showSpin(from){ try{ window.__aiShow?.(from); }catch{} }
function hideSpin(){ try{ window.__aiHide?.(); }catch{} }

/** Hard lock: stop any user interaction when it's AI's turn */
function installGlobalTurnLock(getIsAITurn){
  const stop = (ev)=>{ if (getIsAITurn()) { ev.stopImmediatePropagation(); ev.preventDefault(); } };
  ['pointerdown','touchstart','mousedown','click'].forEach(t=>{
    window.addEventListener(t, stop, { capture:true, passive:false });
  });
}

(async function boot(){
  const game = await waitForGame().catch(e=>console.warn(e));
  if (!game) return;

  const s = loadSettings();
  const mode = parseMode();
  const aiEnabled = (mode==='ai') || !!s.aiEnabled;
  const aiColor   = (s.aiColor==='w' || s.aiColor==='b') ? s.aiColor : 'b'; // default AI=Black

  if (!aiEnabled) return;

  let aiBusy = false;
  const isAITurn = ()=> game.turn === aiColor;

  // prevent moving AI side
  installGlobalTurnLock(isAITurn);

  async function thinkAndPlay(){
    if (aiBusy) return;
    if (!isAITurn()) return;
    aiBusy = true;

    // spinner text will be updated inside chooseAIMove via window.__aiShow(from)
    showSpin(); // show now
    try{
      const mv = await chooseAIMove(game, { aiColor });
      if (mv){
        const res = game.move(mv.from, mv.to);
        if (!res?.ok) console.warn('[AI] move rejected', mv, res);
      }
    }catch(err){
      console.warn('[AI] failed:', err);
    }finally{
      aiBusy = false;
      hideSpin();
      if (isAITurn()) setTimeout(thinkAndPlay, 0); // safety (e.g., illegal or null move)
    }
  }

  // Patch move() so after human move it triggers AI
  const origMove = game.move.bind(game);
  game.move = function patchedMove(from,to){
    const prevTurn = game.turn;
    const res = origMove(from,to);
    // if human moved (prevTurn != aiColor) and move ok -> AI’s turn next
    if (res?.ok && prevTurn !== aiColor) setTimeout(thinkAndPlay, 0);
    return res;
  };

  // If AI starts (AI=White)
  setTimeout(thinkAndPlay, 0);

  // Debug button “Ask AI from current”
  window.addEventListener('dbg-ask-ai', ()=> setTimeout(thinkAndPlay, 0));

  console.log('[AI] hook ready → AI enabled, color:', aiColor);
})();
