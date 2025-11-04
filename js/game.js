// game.js — True Makruk (Thai Chess) engine compatible with Fairy-Stockfish variant

export const SIZE = 8;
export const COLORS = { WHITE: 'w', BLACK: 'b' };

/*
Makruk starting layout (top to bottom, black side on top):

8 | r n b m k b n r
7 | p p p p p p p p
6 | . . . . . . . .
5 | . . . . . . . .
4 | . . . . . . . .
3 | . . . . . . . .
2 | P P P P P P P P
1 | R N B M K B N R

Legend:
K = King
M = Met (moves 1 step diagonally or forward 1 step)
B = Bishop (Khon) – moves 1 step diagonally or straight forward/backward
N = Knight
R = Rook
P = Pawn
*/

const START_FEN = 'rnbmkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBMKBNR w - - 0 1';

export class Game {
  constructor() {
    this.reset();
  }

  reset() {
    this.board = this._fromFEN(START_FEN);
    this.turn = COLORS.WHITE;
    this.history = [];
  }

  /* ===== FEN Handling ===== */
  _fromFEN(fen) {
    const parts = fen.split(/\s+/);
    const rows = parts[0].split('/');
    const board = Array(SIZE).fill(null).map(() => Array(SIZE).fill(null));

    for (let y = 0; y < SIZE; y++) {
      let x = 0;
      for (const ch of rows[y]) {
        if (/\d/.test(ch)) {
          x += parseInt(ch);
        } else {
          const color = ch === ch.toLowerCase() ? COLORS.BLACK : COLORS.WHITE;
          const type = ch.toUpperCase();
          board[y][x++] = { c: color, t: type, moved: false };
        }
      }
    }
    return board;
  }

  toFEN() {
    let fen = '';
    for (let y = 0; y < SIZE; y++) {
      let empty = 0;
      for (let x = 0; x < SIZE; x++) {
        const p = this.board[y][x];
        if (!p) empty++;
        else {
          if (empty) { fen += empty; empty = 0; }
          fen += p.c === COLORS.WHITE ? p.t : p.t.toLowerCase();
        }
      }
      if (empty) fen += empty;
      if (y < SIZE - 1) fen += '/';
    }
    return `${fen} ${this.turn} - - 0 1`;
  }

  /* ===== Basic accessors ===== */
  at(x, y) {
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return null;
    return this.board[y][x];
  }

  set(x, y, p) {
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
    this.board[y][x] = p;
  }

  /* ===== Move logic ===== */

  legalMoves(x, y) {
    const p = this.at(x, y);
    if (!p) return [];
    const moves = [];

    const forward = p.c === COLORS.WHITE ? -1 : 1;
    const enemy = p.c === COLORS.WHITE ? COLORS.BLACK : COLORS.WHITE;

    const add = (nx, ny) => {
      if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) return;
      const t = this.at(nx, ny);
      if (!t || t.c !== p.c) moves.push({ x: nx, y: ny });
    };

    switch (p.t) {
      case 'P': // Pawn
        if (!this.at(x, y + forward)) add(x, y + forward);
        const diag = [x - 1, x + 1];
        for (const dx of diag) {
          const t = this.at(dx, y + forward);
          if (t && t.c === enemy) moves.push({ x: dx, y: y + forward });
        }
        break;

      case 'R': // Rook
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          let nx = x + dx, ny = y + dy;
          while (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE) {
            const t = this.at(nx, ny);
            if (!t) moves.push({ x: nx, y: ny });
            else { if (t.c === enemy) moves.push({ x: nx, y: ny }); break; }
            nx += dx; ny += dy;
          }
        }
        break;

      case 'N': // Knight
        for (const [dx, dy] of [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]]) {
          add(x + dx, y + dy);
        }
        break;

      case 'B': // Khon — diagonal + orthogonal 1 step
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
          add(x + dx, y + dy);
        }
        break;

      case 'M': // Met — diagonals 1 or straight forward 1
        for (const [dx, dy] of [[1,1],[-1,1],[1,-1],[-1,-1],[0,forward]]) {
          add(x + dx, y + dy);
        }
        break;

      case 'K': // King — 1 step any direction
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]) {
          add(x + dx, y + dy);
        }
        break;
    }

    return moves;
  }

  move(from, to) {
    const p = this.at(from.x, from.y);
    if (!p) return { ok: false };

    const legal = this.legalMoves(from.x, from.y)
      .some(m => m.x === to.x && m.y === to.y);

    if (!legal) return { ok: false };

    const target = this.at(to.x, to.y);
    this.set(to.x, to.y, { ...p, moved: true });
    this.set(from.x, from.y, null);

    // promotion: pawn becomes Met when reaching 3rd rank from enemy
    if (p.t === 'P') {
      if ((p.c === COLORS.WHITE && to.y === 2) ||
          (p.c === COLORS.BLACK && to.y === 5)) {
        this.set(to.x, to.y, { c: p.c, t: 'M', moved: true });
      }
    }

    this.history.push({ from, to, captured: target });
    this.turn = this.turn === COLORS.WHITE ? COLORS.BLACK : COLORS.WHITE;
    return { ok: true, status: this.status() };
  }

  undo() {
    const last = this.history.pop();
    if (!last) return false;
    const p = this.at(last.to.x, last.to.y);
    this.set(last.from.x, last.from.y, p);
    this.set(last.to.x, last.to.y, last.captured || null);
    this.turn = this.turn === COLORS.WHITE ? COLORS.BLACK : COLORS.WHITE;
    return true;
  }

  status() {
    // simplified — checks only if opponent's king exists
    const all = [];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const p = this.at(x, y);
        if (p) all.push(p);
      }
    }
    const whiteKing = all.some(p => p.c === COLORS.WHITE && p.t === 'K');
    const blackKing = all.some(p => p.c === COLORS.BLACK && p.t === 'K');
    if (!whiteKing) return { state: 'checkmate', winner: COLORS.BLACK };
    if (!blackKing) return { state: 'checkmate', winner: COLORS.WHITE };
    return { state: 'playing' };
  }
}
