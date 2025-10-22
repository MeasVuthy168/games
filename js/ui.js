/* Khmer Chess — UI logic (clean version) */

import { COLORS, newGame } from "./game.js";
import { loadGameState, saveGameState, clearGameState } from "./storage.js";
import { playBeep } from "./sound.js";
import { formatClock, startClock, stopClock, togglePause } from "./clock.js";

/* =============================================================== */
/* ===== Initialize the game UI ================================== */
/* =============================================================== */
export function initUI(game, clocks) {
  const elBoard = document.getElementById("board");
  const btnBack = document.getElementById("btnBack");
  const btnReset = document.getElementById("btnReset");
  const btnPause = document.getElementById("btnPause");
  const btnUndo = document.getElementById("btnUndo");
  const clockW = document.getElementById("clockW");
  const clockB = document.getElementById("clockB");
  const turnLabel = document.getElementById("turnLabel");

  const beeper = playBeep();

  /* ============ Setup board cells ============ */
  elBoard.innerHTML = "";
  for (let y = 7; y >= 0; y--) {
    for (let x = 0; x < 8; x++) {
      const cell = document.createElement("div");
      cell.className = (x + y) % 2 === 0 ? "cell light" : "cell dark";
      cell.dataset.x = x;
      cell.dataset.y = y;
      cell.dataset.ax =
        "abcdefgh"[x] + (y + 1).toString(); // coordinate display
      elBoard.appendChild(cell);
    }
  }

  const cells = Array.from(elBoard.children);
  let selected = null;
  let legal = [];

  /* ============ Render board & clocks ============ */
  function render() {
    cells.forEach((c) => (c.innerHTML = ""));
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const p = game.board[y][x];
        if (!p) continue;
        const idx = (7 - y) * 8 + x;
        const cell = cells[idx];
        const piece = document.createElement("div");
        piece.className = "piece";
        piece.style.backgroundImage = `url(${p.img})`;
        cell.appendChild(piece);
      }
    }

    clockW.textContent = formatClock(clocks.w);
    clockB.textContent = formatClock(clocks.b);
    turnLabel.textContent = khTurnLabel();
  }

  /* ============ Tap / click handling ============ */
  elBoard.addEventListener("click", (ev) => {
    const cell = ev.target.closest(".cell");
    if (!cell) return;
    const x = parseInt(cell.dataset.x);
    const y = parseInt(cell.dataset.y);

    if (selected) {
      const move = legal.find((m) => m.to.x === x && m.to.y === y);
      if (move) {
        const prevTurn = game.turn;
        const before = game.board[move.to.y][move.to.x];
        const res = game.move(move.from, move.to);
        if (res.ok) {
          if (beeper.enabled) {
            if (before) beeper.capture();
            else beeper.move();
          }
          if (res.status?.state === "check" && beeper.enabled) beeper.check();
          clocks.switchedByMove(prevTurn);
          selected = null;
          legal = [];
          clearHints();
          render();
          saveGameState(game, clocks);
          if (res.status?.state === "checkmate") {
            setTimeout(() => alert("ម៉ាត់! ល្បែងបានបញ្ចប់"), 50);
          } else if (res.status?.state === "stalemate") {
            setTimeout(() => alert("គប់ស្ដាំ (Stalemate) — ល្បែងស្មើ!"), 50);
          }
          return;
        }
      }
      clearHints();
      selected = null;
      legal = [];
      render();
    } else {
      const piece = game.board[y][x];
      if (!piece) return;
      if (piece.color !== game.turn) return;
      selected = { x, y };
      legal = game.legalMovesFrom(x, y);
      showHints();
    }
  });

  /* ============ Hint visuals ============ */
  function clearHints() {
    cells.forEach((c) =>
      c.classList.remove("selected", "hint-move", "hint-capture")
    );
  }

  function showHints() {
    clearHints();
    if (!selected) return;
    const from = (7 - selected.y) * 8 + selected.x;
    cells[from].classList.add("selected");
    for (const m of legal) {
      const idx = (7 - m.to.y) * 8 + m.to.x;
      const c = cells[idx];
      if (game.board[m.to.y][m.to.x]) c.classList.add("hint-capture");
      else c.classList.add("hint-move");
    }
  }

  /* ============ Buttons ============ */
  btnBack.onclick = () => {
    if (confirm("ចាកចេញពីល្បែងនេះ?")) {
      clearGameState();
      window.location.href = "index.html";
    }
  };

  btnReset.onclick = () => {
    if (confirm("ចាប់ផ្តើមល្បែងថ្មីមែនទេ?")) {
      clearGameState();
      const fresh = newGame();
      game.load(fresh);
      clocks.reset();
      render();
    }
  };

  btnPause.onclick = () => {
    togglePause(clocks);
  };

  btnUndo.onclick = () => {
    game.undo();
    clocks.undo();
    render();
    saveGameState(game, clocks);
  };

  /* ============ Helpers ============ */
  function khTurnLabel() {
    const side = game.turn === COLORS.WHITE ? "ស" : "ខ្មៅ";
    const st = game.status();
    let label = `វេនខាង (${side})`;
    if (st.state === "checkmate") {
      const winner = side === "ស" ? "ខ្មៅ" : "ស";
      label = `ម៉ាត់ · ${winner} ឈ្នះ`;
    } else if (st.state === "stalemate") {
      label = "គប់ស្ដាំ (Stalemate)";
    } else if (st.state === "check") {
      label += " · ឆក់រាជា";
    }
    return label;
  }

  /* ============ Restore saved state ============ */
  const saved = loadGameState();
  if (saved) {
    game.load(saved.game);
    clocks.load(saved.clocks);
  } else {
    game.reset();
    clocks.reset();
  }

  render();
  startClock(game, clocks, render);
}
