// js/ai-vs-ai.js — developer-only AI-vs-AI test mode.
//
// Not reachable from the app's normal navigation: gated behind a ?dev=1
// URL flag (also reachable from a hidden 5-tap affordance in Settings ->
// About, see js/settings.js). Plays a full legal game end-to-end by
// calling the same chooseAIMove()/pickAIMove() used by the real Play
// screen, alternately, for both colors against a real Game instance from
// game.js — no second rules engine, no human input, no search-algorithm
// changes (ai-engine.js/ai.js are only called into, never modified here
// beyond the small getLastStats() accessor added to ai.js).

import { Game, SIZE, COLORS, PT } from './game.js';
import { chooseAIMove, getLastStats, resetAI } from './ai.js';
import { MIN_LEVEL, MAX_LEVEL, DEFAULT_LEVEL, levelBand } from './ai-engine.js';
import { pieceThemes, pieceImageUrl, clampThemeIndex } from './themes.js';

// Makruk (like this engine) has no repetition/50-move draw rule
// implemented in game.js, so two weak AIs can in principle shuffle forever.
// This dev tool adjudicates a draw past a generous ply count rather than
// hanging the tab — that is a dev-tool safety valve only, not a rules
// change (game.js itself is untouched).
const MAX_PLIES = 400;

function sq(x, y) {
  return `${String.fromCharCode(97 + x)}${8 - y}`;
}

document.addEventListener('DOMContentLoaded', () => {
  const devGate    = document.getElementById('devGate');
  const devMain     = document.getElementById('devMain');
  const btnEnableDev = document.getElementById('btnEnableDev');

  const params = new URLSearchParams(location.search);
  if (params.get('dev') !== '1') {
    devGate.hidden = false;
    devMain.hidden = true;
    btnEnableDev.addEventListener('click', () => {
      location.href = `${location.pathname}?dev=1`;
    });
    return;
  }
  devGate.hidden = true;
  devMain.hidden = false;

  const levelWhiteSel = document.getElementById('levelWhite');
  const levelBlackSel = document.getElementById('levelBlack');
  const devStart = document.getElementById('devStart');
  const devStop  = document.getElementById('devStop');
  const devStatus = document.getElementById('devStatus');
  const devBoardEl = document.getElementById('devBoard');
  const devLog = document.getElementById('devLog');

  for (const sel of [levelWhiteSel, levelBlackSel]) {
    for (let l = MIN_LEVEL; l <= MAX_LEVEL; l++) {
      const opt = document.createElement('option');
      opt.value = String(l);
      opt.textContent = `Level ${l} — ${levelBand(l)}`;
      if (l === DEFAULT_LEVEL) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  // ---- minimal board rendering (no drag/drop, no clocks, no sound) ----
  const cells = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const c = document.createElement('div');
      c.className = 'cell ' + ((x + y) % 2 ? 'dark' : 'light');
      devBoardEl.appendChild(c);
      cells.push(c);
    }
  }

  function renderBoard(game) {
    for (const c of cells) c.innerHTML = '';
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const p = game.at(x, y);
        if (!p) continue;
        const theme = pieceThemes[clampThemeIndex(0, pieceThemes)];
        const s = document.createElement('div');
        s.className = `piece ${p.c === 'w' ? 'white' : 'black'}`;
        s.style.backgroundImage = `url(./${pieceImageUrl(theme, p.c, p.t)})`;
        cells[y * SIZE + x].appendChild(s);
      }
    }
  }

  function logRow(text) {
    const row = document.createElement('div');
    row.className = 'row';
    row.textContent = text;
    devLog.appendChild(row);
    devLog.scrollTop = devLog.scrollHeight;
  }
  function clearLog() { devLog.innerHTML = ''; }

  let running = false;
  let runToken = 0;

  function setControlsRunning(isRunning) {
    devStart.disabled = isRunning;
    devStop.disabled = !isRunning;
    levelWhiteSel.disabled = isRunning;
    levelBlackSel.disabled = isRunning;
  }

  async function playFullGame(levelWhite, levelBlack, myToken) {
    const game = new Game();
    renderBoard(game);
    clearLog();
    devStatus.textContent = `Playing — White L${levelWhite} vs Black L${levelBlack}…`;

    let totalNodes = 0, totalTimeMs = 0, plies = 0;

    while (running && myToken === runToken) {
      const status = game.status();
      if (status.state === 'checkmate' || status.state === 'stalemate') {
        finish(status, plies, totalNodes, totalTimeMs);
        return;
      }
      if (plies >= MAX_PLIES) {
        finish({ state: 'ply-limit' }, plies, totalNodes, totalTimeMs);
        return;
      }

      const color = game.turn;
      const level = color === COLORS.WHITE ? levelWhite : levelBlack;

      let move;
      try {
        move = await chooseAIMove(game, { level, aiColor: color });
      } catch (err) {
        finish({ state: 'error', message: String(err?.message || err) }, plies, totalNodes, totalTimeMs);
        return;
      }
      if (myToken !== runToken || !running) return; // stopped while thinking

      if (!move || !move.from || !move.to) {
        finish({ state: 'no-move', toMove: color }, plies, totalNodes, totalTimeMs);
        return;
      }

      const stats = getLastStats();
      const captured = !!game.at(move.to.x, move.to.y);
      const res = game.move(move.from, move.to);
      if (!res.ok) {
        // Should never happen — chooseAIMove only returns legal moves — but
        // this dev tool must never silently get stuck if it somehow does.
        finish({ state: 'illegal', toMove: color, move }, plies, totalNodes, totalTimeMs);
        return;
      }

      plies++;
      totalNodes += stats?.nodes || 0;
      totalTimeMs += stats?.timeMs || 0;

      const sideTxt = color === COLORS.WHITE ? 'W' : 'B';
      const flag = res.status?.state === 'check' ? ' +' : (captured ? ' x' : '');
      logRow(
        `${String(plies).padStart(3, ' ')}. ${sideTxt} L${level} ${sq(move.from.x, move.from.y)}->${sq(move.to.x, move.to.y)}${flag}  ` +
        `depth=${stats?.depth ?? '-'} nodes=${stats?.nodes ?? '-'} time=${stats?.timeMs ?? '-'}ms eval=${stats?.score ?? '-'}`
      );
      renderBoard(game);
    }
  }

  function finish(status, plies, totalNodes, totalTimeMs) {
    running = false;
    setControlsRunning(false);
    resetAI();

    let summary;
    if (status.state === 'checkmate') {
      const winner = status.toMove === COLORS.WHITE ? 'Black' : 'White';
      summary = `Checkmate — ${winner} wins.`;
    } else if (status.state === 'stalemate') {
      summary = 'Stalemate — draw.';
    } else if (status.state === 'ply-limit') {
      summary = `Ply limit (${MAX_PLIES}) reached — adjudicated draw (no repetition rule in this engine).`;
    } else if (status.state === 'no-move') {
      summary = `AI returned no move for ${status.toMove === 'w' ? 'White' : 'Black'} — stopped.`;
    } else if (status.state === 'illegal') {
      summary = `AI proposed an illegal move for ${status.toMove === 'w' ? 'White' : 'Black'} — stopped.`;
    } else {
      summary = `Error: ${status.message || 'unknown'}`;
    }

    devStatus.textContent = `${summary}  (${plies} plies, ${totalNodes} nodes, ${totalTimeMs}ms total)`;
    logRow(`--- ${summary} ---`);
  }

  devStart.addEventListener('click', () => {
    if (running) return;
    running = true;
    runToken++;
    setControlsRunning(true);
    playFullGame(parseInt(levelWhiteSel.value, 10), parseInt(levelBlackSel.value, 10), runToken);
  });

  devStop.addEventListener('click', () => {
    if (!running) return;
    running = false;
    setControlsRunning(false);
    resetAI();
    devStatus.textContent = 'Stopped.';
    logRow('--- Stopped by user ---');
  });

  devStatus.textContent = 'Idle.';
});
