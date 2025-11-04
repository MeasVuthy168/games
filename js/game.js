// game.js — True Makruk rule engine (for Khmer Chess AI sync)
export const COLORS = { WHITE: 'w', BLACK: 'b' };
export const SIZE = 8;

// === Helper ===
function cloneBoard(board) {
  return board.map(row => row.map(p => (p ? { ...p } : null)));
}

// === Starting position ===
// Fairy-Stockfish expects the *Thai Makruk* layout.
// Rank 8–1 top to bottom (Black → White):
// r n b q k b n r
// p p p p p p p p
// 8 empty rows
// p p p p p p p p (White side mirrored)
export function startingBoard() {
  const B = COLORS.BLACK, W = COLORS.WHITE;
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));

  // --- Black pieces ---
  const backB = [
    { t: 'R', c: B }, { t: 'N', c: B }, { t: 'B', c: B },
    { t: 'Q', c: B }, { t: 'K', c: B }, { t: 'B', c: B },
    { t: 'N', c: B }, { t: 'R', c: B }
  ];
  board[0] = backB;
  board[1] = Array(SIZE).fill({ t: 'P', c: B });

  // --- White pieces ---
  const backW = [
    { t: 'R', c: W }, { t: 'N', c: W }, { t: 'B', c: W },
    { t: 'Q', c: W }, { t: 'K', c: W }, { t: 'B', c: W },
    { t: 'N', c: W }, { t: 'R', c: W }
  ];
  board[7] = backW;
  board[6] = Array(SIZE).fill({ t: 'P', c: W });

  return board;
}

// === Movement patterns for Makruk ===
const DIRS = {
  N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0],
  NE: [1, -1], NW: [-1, -1], SE: [1, 1], SW: [-1, 1]
};

function inBounds(x, y) {
  return x >= 0 && x < SIZE && y >= 0 && y < SIZE;
}

export class Game {
  constructor() {
    this.board = startingBoard();
    this.turn = COLORS.WHITE;
    this.history = [];
  }

  reset() {
    this.board = startingBoard();
    this.turn = COLORS.WHITE;
    this.history = [];
  }

  at(x, y) { return inBounds(x, y) ? this.board[y][x] : null; }
  set(x, y, v) { if (inBounds(x, y)) this.board[y][x] = v; }

  // Legal move generation per piece type (Makruk)
  legalMoves(x, y) {
    const p = this.at(x, y);
    if (!p) return [];
    const moves = [];
    const add = (nx, ny) => { if (inBounds(nx, ny)) moves.push({ x: nx, y: ny }); };

    const forward = p.c === COLORS.WHITE ? -1 : 1;

    switch (p.t) {
      case 'P': {
        // Pawn (Makruk): 1 forward, capture diagonally 1 step
        const ny = y + forward;
        if (inBounds(x, ny) && !this.at(x, ny)) add(x, ny);
        for (const dx of [-1, 1]) {
          const nx = x + dx;
          if (inBounds(nx, ny)) {
            const t = this.at(nx, ny);
            if (t && t.c !== p.c) add(nx, ny);
          }
        }
        break;
      }
      case 'R': { // Boat
        const dirs = [DIRS.N, DIRS.S, DIRS.E, DIRS.W];
        for (const [dx, dy] of dirs) {
          let nx = x + dx, ny = y + dy;
          while (inBounds(nx, ny)) {
            const t = this.at(nx, ny);
            if (!t) add(nx, ny);
            else { if (t.c !== p.c) add(nx, ny); break; }
            nx += dx; ny += dy;
          }
        }
        break;
      }
      case 'N': { // Horse
        const jumps = [
          [1, 2], [2, 1], [-1, 2], [-2, 1],
          [1, -2], [2, -1], [-1, -2], [-2, -1]
        ];
        for (const [dx, dy] of jumps) {
          const nx = x + dx, ny = y + dy;
          if (!inBounds(nx, ny)) continue;
          const t = this.at(nx, ny);
          if (!t || t.c !== p.c) add(nx, ny);
        }
        break;
      }
      case 'B': { // Khon — move 1 square in 4 diagonals or 1 forward
        const step = [DIRS.NE, DIRS.NW, DIRS.SE, DIRS.SW, [0, forward]];
        for (const [dx, dy] of step) {
          const nx = x + dx, ny = y + dy;
          if (inBounds(nx, ny)) {
            const t = this.at(nx, ny);
            if (!t || t.c !== p.c) add(nx, ny);
          }
        }
        break;
      }
      case 'Q': { // Met — 1 step diagonally in 4 directions
        for (const [dx, dy] of [DIRS.NE, DIRS.NW, DIRS.SE, DIRS.SW]) {
          const nx = x + dx, ny = y + dy;
          if (inBounds(nx, ny)) {
            const t = this.at(nx, ny);
            if (!t || t.c !== p.c) add(nx, ny);
          }
        }
        break;
      }
      case 'K': { // King — 1 step any direction
        for (const [dx, dy] of Object.values(DIRS)) {
          const nx = x + dx, ny = y + dy;
          if (inBounds(nx, ny)) {
            const t = this.at(nx, ny);
            if (!t || t.c !== p.c) add(nx, ny);
          }
        }
        break;
      }
    }
    return moves;
  }

  move(from, to) {
    const piece = this.at(from.x, from.y);
    if (!piece) return { ok: false };
    const legals = this.legalMoves(from.x, from.y);
    const ok = legals.some(m => m.x === to.x && m.y === to.y);
    if (!ok) return { ok: false };
    const target = this.at(to.x, to.y);
    this.set(to.x, to.y, piece);
    this.set(from.x, from.y, null);
    this.turn = (this.turn === COLORS.WHITE) ? COLORS.BLACK : COLORS.WHITE;
    this.history.push({ from, to, captured: target });
    return { ok: true, status: this.status() };
  }

  undo() {
    const h = this.history.pop();
    if (!h) return false;
    const piece = this.at(h.to.x, h.to.y);
    this.set(h.from.x, h.from.y, piece);
    this.set(h.to.x, h.to.y, h.captured || null);
    this.turn = (this.turn === COLORS.WHITE) ? COLORS.BLACK : COLORS.WHITE;
    return true;
  }

  // minimal check detection (simplified)
  status() {
    // locate both kings
    let wk=null,bk=null;
    for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
      const p=this.at(x,y);
      if(!p)continue;
      if(p.t==='K' && p.c===COLORS.WHITE) wk={x,y};
      if(p.t==='K' && p.c===COLORS.BLACK) bk={x,y};
    }
    if(!wk||!bk) return { state:'checkmate' };
    return { state:'normal' };
  }
}
