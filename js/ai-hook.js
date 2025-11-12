// js/ai-hook.js — Connect UI to backend engine, show spinner, block board while thinking,
// and fall back to local Master AI if backend fails.

import { chooseAIMove as localMaster } from './ai.js';

const DEFAULT_ENGINE_URL = 'https://ouk-ai-backend.onrender.com/api/ai/move';
const MOVETIME_MS = 1200;

function getEngineURL() {
  return (
    window.__ENGINE_URL ||
    (typeof localStorage !== 'undefined' && localStorage.getItem('kc_engine_url')) ||
    DEFAULT_ENGINE_URL
  );
}

const LS_KEY = 'kc_settings_v1';
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null') || {}; }
  catch { return {}; }
}

function $(s, r=document){ return r.querySelector(s); }

function ensureSpinner(){
  if ($('#aiBusy')) return $('#aiBusy');
  const el = document.createElement('div');
  el.id = 'aiBusy';
  el.innerHTML = `
    <div class="ai-spinner">
      <div class="ai-dot"></div>
      <div class="ai-text">🤖 គិត…</div>
    </div>`;
  document.body.appendChild(el);
  return el;
}
function spinner(show){
  const el = ensureSpinner();
  el.style.display = show ? 'flex' : 'none';
  document.body.classList.toggle('ai-thinking', !!show);
}
ensureSpinner(); spinner(false);

function setAITurnBlock(on){ document.body.classList.toggle('ai-turn', !!on); }

function getTurn(game){ try { return game.turn || game.getTurn?.(); } catch { return null; } }
function getFEN(game){ try { return game.fen?.() || game.toFEN?.() || game.getFEN?.(); } catch { return null; } }

function listLegals(game){
  const out=[]; for(let y=0;y<8;y++)for(let x=0;x<8;x++){
    try{ const ms = game.legalMoves?.(x,y) || []; for(const m of ms) out.push({from:{x,y}, to:{x:m.x,y:m.y}}); }catch{}
  } return out;
}
function algebraToXY(fileChar, rankChar){
  const fx = fileChar.charCodeAt(0) - 97;
  const fy = 8 - (rankChar.charCodeAt(1) - 48); // correction: rankChar is like '1'
  return { x:fx, y:fy };
}
function uciToMove(uci, game){
  if (!uci || uci.length<4) return null;
  const from = { x: uci.charCodeAt(0)-97, y: 8-(uci.charCodeAt(1)-48) };
  const to   = { x: uci.charCodeAt(2)-97, y: 8-(uci.charCodeAt(3)-48) };
  const legals = listLegals(game);
  return legals.find(m => m.from.x===from.x && m.from.y===from.y && m.to.x===to.x && m.to.y===to.y) || null;
}
function applyMove(game, m){
  try { return game.move(m.from, m.to); } catch { return null; }
}

async function askBackend(fen, variant='makruk', movetime=MOVETIME_MS){
  const res = await fetch(getEngineURL(),{
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ fen, variant, movetime })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

let aiBusy=false;
let gameRef=null;
let settings=loadSettings();

async function thinkAndMove(){
  if (!gameRef || aiBusy) return;
  if (!settings?.aiEnabled) return;

  const aiColor = settings.aiColor || 'b';
  const turn = getTurn(gameRef);
  const fen  = getFEN(gameRef);
  if (!fen || turn !== aiColor) return;

  aiBusy = true; spinner(true);

  try{
    const { move:uci } = await askBackend(fen, 'makruk', MOVETIME_MS);
    let mv = uciToMove(uci, gameRef);
    if (!mv){ mv = await localMaster(gameRef, { aiColor }); }
    if (mv){
      const res = applyMove(gameRef, mv);
      // If game reports end, fire overlay (UI render happens in ui.js poll/render)
      if (res?.status?.state === 'checkmate'){
        window.showEndFlash?.({ type: 'lose' }); // AI is black in your config
      } else if (res?.status?.state === 'stalemate'){
        window.showEndFlash?.({ type: 'draw' });
      }
    }
  }catch(err){
    try{
      const mv = await localMaster(gameRef, { aiColor });
      if (mv){
        const res = applyMove(gameRef, mv);
        if (res?.status?.state === 'checkmate'){ window.showEndFlash?.({ type:'lose' }); }
        else if (res?.status?.state === 'stalemate'){ window.showEndFlash?.({ type:'draw' }); }
      }
    }catch(e2){ console.log('[ai] both backend & local failed:', e2?.message||e2); }
  }finally{
    spinner(false); aiBusy=false;
  }
}

function startWatch(){
  if (!gameRef) return;
  let last = getFEN(gameRef) || '';
  setInterval(()=>{
    try{
      const f = getFEN(gameRef) || '';
      const turn = getTurn(gameRef);
      setAITurnBlock(settings?.aiEnabled && turn === (settings.aiColor||'b'));
      if (f !== last){ last = f; thinkAndMove(); }
    }catch{}
  }, 250);
  thinkAndMove();
}

document.addEventListener('kc:ready', (e)=>{
  gameRef = e?.detail?.game || window.game || null;
  settings = loadSettings();
  if (!gameRef) return;
  startWatch();
});

if (window.game){ gameRef = window.game; startWatch(); }
