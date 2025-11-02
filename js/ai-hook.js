// js/ai-hook.js
//
// Wires chooseAIMove() to the current game, shows spinner,
// and blocks user input during the AI turn.

import { chooseAIMove } from './ai.js';

const LS_KEY='kc_settings_v1';
function loadSettings(){ try{ return JSON.parse(localStorage.getItem(LS_KEY)||'null')||{} }catch{ return {} } }

const qs = new URLSearchParams(location.search);
const mode = qs.get('mode') || '';
const s = loadSettings();

// If user came from Home “Play with AI (Master)”, we have:
//   s.aiEnabled = true
//   s.aiColor = 'w' or 'b'  (this is the AI side color)
const AI_ENABLED = (mode==='ai') || !!s.aiEnabled;
const AI_COLOR   = (s.aiColor === 'w' || s.aiColor === 'b') ? s.aiColor : 'b'; // default AI=Black

const shield = document.getElementById('inputShield');

function lockInput(on){ try{ if(!shield) return; shield.classList.toggle('on', !!on); }catch{} }
function showSpin(text){ try{ window.__aiShow?.(text||'AI កំពុងគិត') }catch{} }
function hideSpin(){ try{ window.__aiHide?.() }catch{} }

function getGame(){
  // Your main.js should expose a global `kcGame` or `game`
  return window.kcGame || window.game || null;
}

function sideToMove(g){ return g?.turn || 'w'; }

async function aiMoveIfNeeded(trigger='auto'){
  const g = getGame(); if (!g || !AI_ENABLED) return;
  const stm = sideToMove(g);
  if (stm !== AI_COLOR) { lockInput(false); return; } // human turn
  lockInput(true);
  showSpin('Remote AI');
  try{
    const mv = await chooseAIMove(g, { aiColor: AI_COLOR });
    if (mv){
      const res = g.move(mv.from, mv.to);
      if (!res?.ok) console.warn('[ai-hook] engine move illegal?', mv, res);
    }
  }catch(e){
    console.error('[ai-hook] chooseAIMove failed', e);
  }finally{
    hideSpin();
    lockInput(false);
    // If AI moved into a state where it is still AI turn (e.g., illegal UI state), re-check:
    setTimeout(()=> aiMoveIfNeeded('loop'), 0);
  }
}

/* ====== Attach to your existing game lifecycle ====== */
(function waitForGame(){
  const g = getGame();
  if (!g){ setTimeout(waitForGame, 60); return; }

  // Whenever your game signals a move finished, we react.
  // If you have an event bus, hook here; otherwise poll turn changes.

  let lastFen = '';
  setInterval(()=>{
    try{
      const fen = (typeof g.toFEN==='function') ? g.toFEN() :
                  (typeof g.toFen==='function') ? g.toFen() :
                  (g.fen || '');
      if (fen && fen !== lastFen){
        lastFen = fen;
        aiMoveIfNeeded('move');
      }
    }catch{}
  }, 150);

  // Initial check (start AI if AI plays White)
  aiMoveIfNeeded('start');

  // Basic UI protection: if it’s AI turn, keep shield on.
  setInterval(()=> { if (getGame() && AI_ENABLED) lockInput(sideToMove(getGame())===AI_COLOR); }, 250);

  console.log('[ai-hook] ready; AI_ENABLED=', AI_ENABLED, 'AI_COLOR=', AI_COLOR);
})();
