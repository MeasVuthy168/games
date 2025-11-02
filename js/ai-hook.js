// js/ai-hook.js
// Wires your board to the AI (remote-first via backend, fallback to local engine in ai.js)

import { chooseAIMove } from './ai.js';

const LS_KEY = 'kc_settings_v1';

function loadSettings(){
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null') || {}; }
  catch { return {}; }
}

function waitForGame(maxMs=6000){
  return new Promise((resolve,reject)=>{
    const t0 = Date.now();
    const iv = setInterval(()=>{
      if (window.game && typeof window.game.at==='function' && typeof window.game.move==='function') {
        clearInterval(iv); resolve(window.game);
      } else if (Date.now()-t0 > maxMs){
        clearInterval(iv); reject(new Error('game instance not found'));
      }
    },80);
  });
}

function parseMode(){
  const u = new URL(location.href);
  return (u.searchParams.get('mode') || '').toLowerCase();
}

function showSpin(){ try{ window.__aiShow?.(); }catch{} }
function hideSpin(){ try{ window.__aiHide?.(); }catch{} }

(async function boot(){
  const game = await waitForGame().catch(e=>console.warn(e));
  if (!game) return;

  const s = loadSettings();
  const mode = parseMode();

  const aiEnabled = (mode==='ai') || !!s.aiEnabled;
  const aiColor = (s.aiColor==='w' || s.aiColor==='b') ? s.aiColor : 'b'; // default: AI plays Black

  if (!aiEnabled) return;

  let aiBusy = false;

  async function maybeAIMove(){
    if (aiBusy) return;
    if (game.turn !== aiColor) return;

    aiBusy = true;
    showSpin();
    try{
      const mv = await chooseAIMove(game, { aiColor });
      if (mv){
        const res = game.move(mv.from, mv.to);
        if (!res?.ok) console.warn('[AI] move rejected', mv, res);
      }
    }catch(err){
      console.warn('[AI] failed', err);
    }finally{
      aiBusy = false;
      hideSpin();
      if (game.turn === aiColor) setTimeout(maybeAIMove, 0);
    }
  }

  // Stop human moving AI side: intercept pointerdown when it's AI's turn
  const boardEl = document.getElementById('board');
  if (boardEl){
    boardEl.addEventListener('pointerdown', (ev)=>{
      if (game.turn === aiColor){
        ev.stopPropagation(); ev.preventDefault();
        if (!aiBusy) maybeAIMove();
      }
    }, { capture:true });
  }

  // After any human move (turn flips to AI), trigger AI
  const origMove = game.move.bind(game);
  game.move = function patchedMove(from,to){
    const prev = game.turn;
    const res = origMove(from,to);
    if (res?.ok && prev !== aiColor){
      setTimeout(maybeAIMove, 0);
    }
    return res;
  };

  // If AI starts (AI = White)
  setTimeout(maybeAIMove, 0);

  console.log('[AI] hook ready — AI:', aiEnabled, 'color:', aiColor);
})();
