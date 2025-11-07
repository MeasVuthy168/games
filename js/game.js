// game.js — Makruk (Thai Chess) core engine
// Exports: SIZE, COLORS, PT, Game, initialPosition, piece, toFen
//
// Rules implemented to match Fairy-Stockfish "makruk":
// - Board: 8×8, ranks 8→1 from top to bottom.
// - Back ranks (both sides): R N B Q K B N R
// - Pawns: on ranks 3 (white) and 6 (black), no double step, no en passant.
// - King: 1 step any direction.
// - Met (Makruk queen): 1 step diagonally (Ferz-like).
//   (We encode it as PT.QUEEN / letter Q in FEN, as Fairy-Stockfish does.)
// - Khon (Makruk bishop): 1 step diagonally + 1 step straight forward.
// - Rook: sliders orthogonal.
// - Knight: standard knight jump.
// - Pawn: 1 forward if empty, capture diagonally forward.
// - Promotion: Pawn → Met (Q) upon entering last 3 ranks
//   (White: y <= 2, Black: y >= 5).

export const SIZE   = 8;
export const COLORS = { WHITE: 'w', BLACK: 'b' };

export const PT = {
  KING:   'K',
  QUEEN:  'Q',  // Met
  BISHOP: 'B',  // Khon
  ROOK:   'R',
  KNIGHT: 'N',
  PAWN:   'P',
};

// Standard Makruk start FEN used by Fairy-Stockfish
export const MAKRUK_START_FEN =
  'rnbqkbnr/8/pppppppp/8/8/PPPPPPPP/8/RNBQKBNR w - - 0 1';

// ---------- helpers ----------
export function piece(t, c) {
  return { t, c, moved: false };
}

function emptyRow() {
  return Array(SIZE).fill(null);
}

// Parse only the board part of a FEN into our board array
function boardFromFen(fen) {
  const boardPart = fen.trim().split(/\s+/)[0]; // first token
  const rows = boardPart.split('/');            // <- NO reverse here
  if (rows.length !== 8) {
    throw new Error('Invalid FEN rows for Makruk');
  }

  const board = Array.from({ length: SIZE }, emptyRow);

  for (let y = 0; y < 8; y++) {
    const rowStr = rows[y];
    let x = 0;
    for (const ch of rowStr) {
      if (/[1-8]/.test(ch)) {
        x += parseInt(ch, 10);
      } else {
        const isLower = ch === ch.toLowerCase();
        const c = isLower ? COLORS.BLACK : COLORS.WHITE;
        const up = ch.toUpperCase();
        let t;
        switch (up) {
          case 'K': t = PT.KING;   break;
          case 'Q': t = PT.QUEEN;  break; // Met
          case 'B': t = PT.BISHOP; break; // Khon
          case 'R': t = PT.ROOK;   break;
          case 'N': t = PT.KNIGHT; break;
          case 'P': t = PT.PAWN;   break;
          default:  t = PT.PAWN;   break;
        }
        board[y][x] = piece(t, c);
        x++;
      }
    }
    if (x !== 8) {
      throw new Error('Invalid FEN row length for Makruk');
    }
  }
  return board;
}

function pieceLetter(p) {
  switch (p.t) {
    case PT.KING:   return 'K';
    case PT.QUEEN:  return 'Q'; // Met
    case PT.BISHOP: return 'B';
    case PT.ROOK:   return 'R';
    case PT.KNIGHT: return 'N';
    case PT.PAWN:   return 'P';
    default:        return 'P';
  }
}

// Convert current position to a Fairy-Stockfish compatible FEN.
// We ignore castling / en passant / halfmove / fullmove and just use "- - 0 1".
export function toFen(game) {
  const rows = [];
  for (let y = 0; y < 8; y++) {
    let row = '';
    let empties = 0;
    for (let x = 0; x < 8; x++) {
      const p = game.at(x, y);
      if (!p) {
        empties++;
        continue;
      }
      if (empties) {
        row += String(empties);
        empties = 0;
      }
      const letter = pieceLetter(p);
      row += (p.c === COLORS.WHITE) ? letter : letter.toLowerCase();
    }
    if (empties) row += String(empties);
    rows.push(row);
  }
  const boardPart = rows.join('/');    // <- NO reverse here
  const stm = game.turn === COLORS.WHITE ? 'w' : 'b';
  return `${boardPart} ${stm} - - 0 1`;
}

// ----- Setup -----
export function initialPosition() {
  return boardFromFen(MAKRUK_START_FEN);
}

// ----- Engine -----
export class Game {
  constructor() { this.reset(); }

  reset() {
    this.board   = initialPosition();
    this.turn    = COLORS.WHITE;
    this.history = [];
    this.winner  = null;
  }

  // Expose FEN for the AI
  toFEN() { return toFen(this); }

  inBounds(x, y) { return x >= 0 && x < SIZE && y >= 0 && y < SIZE; }
  at(x, y)       { return this.board[y][x]; }
  set(x, y, v)   { this.board[y][x] = v; }
  enemyColor(c)  { return c === COLORS.WHITE ? COLORS.BLACK : COLORS.WHITE; }
  pawnDir(c)     { return c === COLORS.WHITE ? -1 : +1; } // white moves up (toward y=0)

  // ---------- Move generators (pseudo-legal) ----------
  pseudoMoves(x, y) {
    const p = this.at(x, y);
    if (!p) return [];
    const out = [];

    const tryAdd = (nx, ny, mode = 'both') => {
      if (!this.inBounds(nx, ny)) return false;
      const t = this.at(nx, ny);
      if (!t) {
        if (mode !== 'capture') out.push({ x: nx, y: ny });
        return true; // sliding ray can continue
      } else if (t.c !== p.c) {
        if (mode !== 'move') out.push({ x: nx, y: ny });
      }
      return false; // blocked
    };

    const ray = (dx, dy) => {
      let nx = x + dx, ny = y + dy;
      while (this.inBounds(nx, ny)) {
        const go = tryAdd(nx, ny, 'both');
        if (!go) break;
        nx += dx; ny += dy;
      }
    };

    switch (p.t) {
      case PT.KING: {
        // 1-step any direction
        for (const dx of [-1, 0, 1]) {
          for (const dy of [-1, 0, 1]) {
            if (dx || dy) tryAdd(x + dx, y + dy, 'both');
          }
        }
        break;
      }

      case PT.QUEEN: {
        // Met: 1-step diagonally
        tryAdd(x - 1, y - 1, 'both');
        tryAdd(x + 1, y - 1, 'both');
        tryAdd(x - 1, y + 1, 'both');
        tryAdd(x + 1, y + 1, 'both');
        break;
      }

      case PT.BISHOP: {
        // Khon: 1-step diagonals + 1-step straight forward
        const d = this.pawnDir(p.c);
        tryAdd(x - 1, y - 1, 'both');
        tryAdd(x + 1, y - 1, 'both');
        tryAdd(x - 1, y + 1, 'both');
        tryAdd(x + 1, y + 1, 'both');
        tryAdd(x, y + d, 'both');
        break;
      }

      case PT.ROOK: {
        ray(+1, 0); ray(-1, 0); ray(0, +1); ray(0, -1);
        break;
      }

      case PT.KNIGHT: {
        const jumps = [
          [1, -2], [2, -1], [2, 1], [1, 2],
          [-1, 2], [-2, 1], [-2, -1], [-1, -2]
        ];
        for (const [dx, dy] of jumps) tryAdd(x + dx, y + dy, 'both');
        break;
      }

      case PT.PAWN: {
        const d = this.pawnDir(p.c);
        // quiet forward move (no double step in Makruk)
        if (this.inBounds(x, y + d) && !this.at(x, y + d)) {
          out.push({ x, y: y + d });
        }
        // captures diagonally forward
        for (const dx of [-1, 1]) {
          const nx = x + dx, ny = y + d;
          if (!this.inBounds(nx, ny)) continue;
          const t = this.at(nx, ny);
          if (t && t.c !== p.c) out.push({ x: nx, y: ny });
        }
        break;
      }
    }

    return out;
  }

  // ATTACK map for checking check / checkmate.
  // Attack patterns reflect capture squares only.
  attacksFrom(x, y) {
    const p = this.at(x, y);
    if (!p) return [];
    const A = [];

    const addRay = (dx, dy) => {
      let nx = x + dx, ny = y + dy;
      while (this.inBounds(nx, ny)) {
        A.push({ x: nx, y: ny });
        if (this.at(nx, ny)) break;
        nx += dx; ny += dy;
      }
    };

    const addStep = (nx, ny) => {
      if (this.inBounds(nx, ny)) A.push({ x: nx, y: ny });
    };

    switch (p.t) {
      case PT.KING:
        for (const dx of [-1, 0, 1]) {
          for (const dy of [-1, 0, 1]) {
            if (dx || dy) addStep(x + dx, y + dy);
          }
        }
        break;

      case PT.QUEEN:
        addStep(x - 1, y - 1); addStep(x + 1, y - 1);
        addStep(x - 1, y + 1); addStep(x + 1, y + 1);
        break;

      case PT.BISHOP: {
        const d = this.pawnDir(p.c);
        addStep(x - 1, y - 1); addStep(x + 1, y - 1);
        addStep(x - 1, y + 1); addStep(x + 1, y + 1);
        addStep(x, y + d);
        break;
      }

      case PT.ROOK:
        addRay(+1, 0); addRay(-1, 0); addRay(0, +1); addRay(0, -1);
        break;

      case PT.KNIGHT: {
        const jumps = [
          [1, -2], [2, -1], [2, 1], [1, 2],
          [-1, 2], [-2, 1], [-2, -1], [-1, -2]
        ];
        for (const [dx, dy] of jumps) addStep(x + dx, y + dy);
        break;
      }

      case PT.PAWN: {
        const d = this.pawnDir(p.c);
        addStep(x - 1, y + d);
        addStep(x + 1, y + d);
        break;
      }
    }
    return A;
  }

  // ---------- Check / status ----------
  findKing(color) {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const p = this.at(x, y);
        if (p && p.c === color && p.t === PT.KING) return { x, y };
      }
    }
    return null;
  }

  squareAttacked(x, y, byColor) {
    for (let j = 0; j < SIZE; j++) {
      for (let i = 0; i < SIZE; i++) {
        const p = this.at(i, j);
        if (!p || p.c !== byColor) continue;
        const att = this.attacksFrom(i, j);
        if (att.some(m => m.x === x && m.y === y)) return true;
      }
    }
    return false;
  }

  inCheck(color) {
    const k = this.findKing(color);
    if (!k) return false;
    return this.squareAttacked(k.x, k.y, this.enemyColor(color));
  }

  // ---------- Legal moves (filter out self-check) ----------
  _do(from, to) {
    const p = this.at(from.x, from.y);
    const prevMoved = p.moved;
    const prevType  = p.t;
    const captured  = this.at(to.x, to.y) || null;

    // move piece
    this.set(to.x, to.y, { ...p, moved: true });
    this.set(from.x, from.y, null);

    // promotion to Met (Queen) in last 3 ranks
    let promo = false;
    const now = this.at(to.x, to.y);
    if (now.t === PT.PAWN) {
      if (now.c === COLORS.WHITE && to.y <= 2) {
        now.t = PT.QUEEN; promo = true;
      }
      if (now.c === COLORS.BLACK && to.y >= 5) {
        now.t = PT.QUEEN; promo = true;
      }
    }

    return { captured, promo, prevMoved, prevType };
  }

  _undo(from, to, snap) {
    const p = this.at(to.x, to.y);
    if (snap.promo) p.t = snap.prevType;
    this.set(from.x, from.y, { ...p, moved: snap.prevMoved });
    this.set(to.x, to.y, snap.captured);
  }

  legalMoves(x, y) {
    const p = this.at(x, y);
    if (!p) return [];
    const raw = this.pseudoMoves(x, y);
    const keep = [];
    for (const mv of raw) {
      const snap = this._do({ x, y }, mv);
      const ok = !this.inCheck(p.c);
      this._undo({ x, y }, mv, snap);
      if (ok) keep.push(mv);
    }
    return keep;
  }

  hasAnyLegalMove(color) {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const p = this.at(x, y);
        if (!p || p.c !== color) continue;
        if (this.legalMoves(x, y).length) return true;
      }
    }
    return false;
  }

  status() {
    const toMove = this.turn;
    const check  = this.inCheck(toMove);
    const any    = this.hasAnyLegalMove(toMove);
    if (any) return { state: check ? 'check' : 'ongoing', inCheck: check, toMove };
    return { state: check ? 'checkmate' : 'stalemate', inCheck: check, toMove };
  }

  // ---------- Public make/undo ----------
  move(from, to) {
    const p = this.at(from.x, from.y);
    if (!p) return { ok: false };
    const isLegal = this.legalMoves(from.x, from.y)
      .some(m => m.x === to.x && m.y === to.y);
    if (!isLegal) return { ok: false };

    const snap = this._do(from, to);
    const { captured, promo } = snap;

    this.history.push({
      from,
      to,
      captured,
      promo,
      prevType: snap.prevType,
      prevMoved: snap.prevMoved
    });

    this.turn = this.enemyColor(this.turn);

    const st = this.status();
    if (st.state === 'checkmate') {
      this.winner = this.enemyColor(st.toMove);
    } else if (st.state === 'stalemate') {
      this.winner = 'draw';
    } else {
      this.winner = null;
    }

    return { ok: true, promo, captured, status: st };
  }

  undo() {
    const last = this.history.pop();
    if (!last) return false;
    this.turn = this.enemyColor(this.turn);
    this._undo(last.from, last.to, {
      captured:  last.captured,
      promo:     last.promo,
      prevType:  last.prevType,
      prevMoved: last.prevMoved,
    });
    this.winner = null;
    return true;
  }
}
