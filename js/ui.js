// ui.js — Final clean Makruk frontend controller
// Requires: game.js, ai.js, and DOM elements (#board, etc.)

import { Game } from './game.js';
import { chooseAIMove } from './ai.js';

let game;
let aiColor = 'b';
let AILock  = false;

const boardEl = document.getElementById('board');

function log(...args){ console.log('[UI]', ...args); }

// === Render ===
function renderBoard(){
  if (!boardEl) return;
  boardEl.innerHTML = '';

  for (let y = 0; y < 8; y++){
    const row = document.createElement('div');
    row.className = 'row';
    for (let x = 0; x < 8; x++){
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.x = x;
      cell.dataset.y = y;

      const p = game.at(x, y);
      if (p){
        const pieceEl = document.createElement('div');
        pieceEl.className = `piece ${p.c === 'w' ? 'white' : 'black'} ${p.t}`;
        cell.appendChild(pieceEl);
      }
      row.appendChild(cell);
    }
    boardEl.appendChild(row);
  }
}

// === Input ===
let selected = null;
function onCellClick(e){
  const cell = e.currentTarget;
  const x = +cell.dataset.x;
  const y = +cell.dataset.y;
  const p = game.at(x, y);

  if (AILock) return; // Wait for AI
  if (game.winner) return;

  // selecting own piece
  if (p && p.c === game.turn){
    selected = { x, y };
    highlightMoves(x, y);
    return;
  }

  // move
  if (selected){
    const res = game.move(selected, { x, y });
    clearHighlights();

    if (res.ok){
      log('You moved', selected, '→', { x, y });
      renderBoard();
      maybeTriggerAI();
    } else {
      log('Illegal move');
    }
    selected = null;
  }
}

function highlightMoves(x, y){
  clearHighlights();
  const ms = game.legalMoves(x, y);
  for (const m of ms){
    const q = `[data-x="${m.x}"][data-y="${m.y}"]`;
    const el = boardEl.querySelector(q);
    if (el) el.classList.add('hint');
  }
}

function clearHighlights(){
  boardEl.querySelectorAll('.cell.hint').forEach(el => el.classList.remove('hint'));
}

// === AI integration ===
async function maybeTriggerAI(){
  if (AILock) return;
  const isAITurn = game.turn === aiColor;
  if (!isAITurn) return;

  AILock = true;
  document.body.classList.add('busy');
  log('AI thinking...');

  const fen = game.toFEN();
  console.log('[DEBUG] FEN before AI call:', fen);

  try{
    const mv = await chooseAIMove(game);
    if (!mv){ 
      log('AI returned null move');
      AILock = false;
      document.body.classList.remove('busy');
      return;
    }

    log('AI move received', mv);
    const res = game.move(mv.from, mv.to);
    if (!res.ok){
      log('AI move rejected', mv);
    } else {
      log('AI played', mv);
      renderBoard();
    }

  }catch(e){
    log('AI error', e);
  }finally{
    AILock = false;
    document.body.classList.remove('busy');
  }
}

// === Reset ===
function newGame(){
  game = new Game();
  selected = null;
  AILock = false;
  renderBoard();
  attachHandlers();
}

function attachHandlers(){
  boardEl.querySelectorAll('.cell').forEach(cell => {
    cell.addEventListener('click', onCellClick);
  });
}

// === Init ===
window.addEventListener('DOMContentLoaded', ()=>{
  newGame();
});

// optional buttons
document.getElementById('btnReset')?.addEventListener('click', ()=> newGame());
document.getElementById('btnUndo')?.addEventListener('click', ()=>{
  game.undo();
  renderBoard();
});
