// game.js — Ouk Chaktrang (Cambodian Chess) core engine
// Exports: SIZE, COLORS, PT, Game, initialPosition, piece, toFen
//
// Board/piece-letter layout inherited from Fairy-Stockfish "makruk" (same
// 8×8 board and starting FEN), with movement rules corrected to genuine
// Ouk Chaktrang:
// - Board: 8×8, ranks 8→1 from top to bottom.
// - Back ranks (both sides): R N S M K S N R
//   (Rook, Knight, Khon, Neang, King, Khon, Knight, Rook)
// - Pawns: on ranks 3 (white) and 6 (black), no double step, no en passant.
// - King: 1 step any direction. On its FIRST move only (per piece, tracked
//   via .moved), it may instead leap like a knight (2+1 squares), jumping
//   over any pieces in between; that privilege is gone forever once this
//   specific king has moved.
// - Neang / Met (M/m): 1 step diagonally (Ferz-like). On its FIRST move
//   only (per piece), it may instead advance 2 squares straight forward as
//   a quiet move — both the square passed over and the landing square must
//   be empty (it cannot jump over a piece or capture with this move); that
//   privilege is gone forever once this specific neang has moved.
// - Khon (S/s): 1 step diagonally (any of the 4 diagonals) + 1 step
//   straight forward only — never straight backward.
// - Rook: sliders orthogonal.
// - Knight: standard knight jump.
// - Pawn: 1 forward if empty, capture diagonally forward.
// - Promotion: Pawn → Neang/Met (M/m) upon entering last 3 ranks
//   (White: y <= 2, Black: y >= 5) — i.e. the 6th rank counted from its
//   own starting side.
//
// Important: piece letters follow Fairy-Stockfish makruk:
//   p = pawn
//   r = rook
//   n = knight
//   s = khon
//   m = met (Neang / Queen)
//   k = king

// ---------------------------------------------------------------------
// Counting Draw (Ouk Chaktrang "រាប់" board/piece counting) — see the
// Game class methods evaluateCountingState()/_updateCounting() below for
// the full rules. Two counting phases exist:
//   BOARD — no unpromoted pawns (Trey) remain anywhere; flat 64-move cap.
//   PIECE — additionally, one side is reduced to a lone King; the cap
//           depends on the other side's remaining Rook/Khon/Knight mix.
// A third pseudo-phase, BARE_KINGS (neither side has any material at
// all), is an immediate draw — no force exists to ever checkmate with.
export const COUNTING_TYPE = { BOARD: 'BOARD', PIECE: 'PIECE', BARE_KINGS: 'BARE_KINGS' };

export function emptyCounting() {
  return {
    active: false, type: null, countingSide: null, strongerSide: null,
    limit: 0, current: 0, remaining: 0, result: null,
    justStarted: false, justIncremented: false,
  };
}

// The Piece/Honor Count category table (Ouk Chaktrang convention) — from
// the STRONGER side's Rook/Khon("Bishop")/Knight composition only; Neang/
// Met (original or promoted-from-Trey alike) and Pawns never affect this
// table. Checked as a priority cascade (most-forcing material first) since
// the source rule only defines pure categories, not every possible mix:
//   2+ Rooks  -> 8      1 Rook   -> 16
//   2+ Khons  -> 22     2+ Knights -> 32
//   1 Khon    -> 44     1 Knight -> 64
//   anything else (Neang-only, bare King) -> 64
export function countingLimitFromMaterial({ rooks = 0, khons = 0, knights = 0 } = {}) {
  if (rooks >= 2) return 8;
  if (rooks === 1) return 16;
  if (khons >= 2) return 22;
  if (knights >= 2) return 32;
  if (khons === 1) return 44;
  if (knights === 1) return 64;
  return 64;
}

export const SIZE   = 8;
export const COLORS = { WHITE: 'w', BLACK: 'b' };

export const PT = {
  KING:   'K',
  MET:    'M',  // Met (Makruk "queen")
  KHON:   'S',  // Khon (Makruk "bishop")
  ROOK:   'R',
  KNIGHT: 'N',
  PAWN:   'P',
};

// Knight-shaped (2+1) jump offsets — shared by the Knight's normal move
// and the King's Ouk Chaktrang first-move-only leap.
const KNIGHT_JUMPS = [
  [1, -2], [2, -1], [2, 1], [1, 2],
  [-1, 2], [-2, 1], [-2, -1], [-1, -2],
];

// Standard Makruk start FEN used by Fairy-Stockfish
export const MAKRUK_START_FEN =
  'rnsmksnr/8/pppppppp/8/8/PPPPPPPP/8/RNSKMSNR w - - 0 1';

// ---------- helpers ----------

export function piece(t, c) {
  return { t, c, moved: false };
}

function emptyRow() {
  return Array(SIZE).fill(null);
}

// Parse only the board part of a FEN into our board array
export function boardFromFen(fen) {
  const boardPart = fen.trim().split(/\s+/)[0]; // first token
  const rows = boardPart.split('/');            // 8 ranks, 8 → 1

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

        // Map letters to our internal piece types.
        // Primary mapping uses Makruk letters:
        //   K → KING
        //   M → MET
        //   S → KHON
        //   R → ROOK
        //   N → KNIGHT
        //   P → PAWN
        //
        // Secondary mapping accepts B/Q as synonyms for S/M
        // (for compatibility with any old saved games).
        switch (up) {
          case 'K': t = PT.KING;   break;
          case 'M': t = PT.MET;    break; // Met
          case 'S': t = PT.KHON;   break; // Khon
          case 'R': t = PT.ROOK;   break;
          case 'N': t = PT.KNIGHT; break;
          case 'P': t = PT.PAWN;   break;

          case 'Q': t = PT.MET;    break; // accept old Q as Met
          case 'B': t = PT.KHON;   break; // accept old B as Khon

          default:
            t = PT.PAWN;           break;
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
  // Convert our internal piece type to a FEN letter.
  // We output pure Makruk letters to match Fairy-Stockfish:
  //   KING → K
  //   MET  → M
  //   KHON → S
  //   ROOK → R
  //   KNIGHT → N
  //   PAWN → P
  switch (p.t) {
    case PT.KING:   return 'K';
    case PT.MET:    return 'M';
    case PT.KHON:   return 'S';
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
      row += p.c === COLORS.WHITE ? letter : letter.toLowerCase();
    }

    if (empties) row += String(empties);
    rows.push(row);
  }

  const boardPart = rows.join('/');
  const stm = game.turn === COLORS.WHITE ? 'w' : 'b';
  return `${boardPart} ${stm} - - 0 1`;
}

// ----- Setup -----

export function initialPosition() {
  return boardFromFen(MAKRUK_START_FEN);
}

// ----- Engine core -----

export class Game {
  constructor() {
    this.reset();
  }

  reset() {
    this.board    = initialPosition();
    this.turn     = COLORS.WHITE;
    this.history  = [];
    this.winner   = null;
    this.counting = emptyCounting();
  }

  // Expose FEN for the AI
  toFEN() {
    return toFen(this);
  }

  inBounds(x, y) { return x >= 0 && x < SIZE && y >= 0 && y < SIZE; }
  at(x, y)       { return this.board[y][x]; }
  set(x, y, v)   { this.board[y][x] = v; }
  enemyColor(c)  { return c === COLORS.WHITE ? COLORS.BLACK : COLORS.WHITE; }
  pawnDir(c)     { return c === COLORS.WHITE ? -1 : +1; } // white moves up

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
        // Ouk Chaktrang special: on its first move only, the King may
        // leap like a knight instead, jumping over any pieces in between
        // (same as the Knight's own jump — tryAdd only checks the landing
        // square, so intervening pieces are never consulted here).
        if (!p.moved) {
          for (const [dx, dy] of KNIGHT_JUMPS) {
            tryAdd(x + dx, y + dy, 'both');
          }
        }
        break;
      }

      case PT.MET: {
        // Met/Neang: 1-step diagonally (Ferz)
        tryAdd(x - 1, y - 1, 'both');
        tryAdd(x + 1, y - 1, 'both');
        tryAdd(x - 1, y + 1, 'both');
        tryAdd(x + 1, y + 1, 'both');
        // Ouk Chaktrang special: on its first move only, the Neang may
        // instead advance 2 squares straight forward as a quiet move —
        // it does not jump like a pawn's double-step elsewhere would;
        // both the passed-over square and the landing square must be
        // empty, and this move can never capture.
        if (!p.moved) {
          const d = this.pawnDir(p.c);
          const midY = y + d;
          const farY = y + d * 2;
          if (this.inBounds(x, farY) && !this.at(x, midY) && !this.at(x, farY)) {
            out.push({ x, y: farY });
          }
        }
        break;
      }

      case PT.KHON: {
        // Khon: 1-step diagonals + 1-step straight forward
        const d = this.pawnDir(p.c);
        tryAdd(x - 1, y - 1, 'both');
        tryAdd(x + 1, y - 1, 'both');
        tryAdd(x - 1, y + 1, 'both');
        tryAdd(x + 1, y + 1, 'both');
        tryAdd(x,     y + d, 'both');
        break;
      }

      case PT.ROOK: {
        ray(+1, 0);
        ray(-1, 0);
        ray(0, +1);
        ray(0, -1);
        break;
      }

      case PT.KNIGHT: {
        for (const [dx, dy] of KNIGHT_JUMPS) {
          tryAdd(x + dx, y + dy, 'both');
        }
        break;
      }

      case PT.PAWN: {
        const d = this.pawnDir(p.c);
        // quiet forward move (no double step)
        if (this.inBounds(x, y + d) && !this.at(x, y + d)) {
          out.push({ x, y: y + d });
        }
        // captures diagonally forward
        for (const dx of [-1, 1]) {
          const nx = x + dx;
          const ny = y + d;
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
        // Mirrors the first-move leap in pseudoMoves(): while unmoved, the
        // King also threatens (and can capture on) its knight-jump squares.
        if (!p.moved) {
          for (const [dx, dy] of KNIGHT_JUMPS) addStep(x + dx, y + dy);
        }
        break;

      case PT.MET:
        addStep(x - 1, y - 1);
        addStep(x + 1, y - 1);
        addStep(x - 1, y + 1);
        addStep(x + 1, y + 1);
        break;

      case PT.KHON: {
        const d = this.pawnDir(p.c);
        addStep(x - 1, y - 1);
        addStep(x + 1, y - 1);
        addStep(x - 1, y + 1);
        addStep(x + 1, y + 1);
        addStep(x,     y + d);
        break;
      }

      case PT.ROOK:
        addRay(+1, 0);
        addRay(-1, 0);
        addRay(0, +1);
        addRay(0, -1);
        break;

      case PT.KNIGHT: {
        for (const [dx, dy] of KNIGHT_JUMPS) addStep(x + dx, y + dy);
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

    // promotion to Met (M) in last 3 ranks
    let promo = false;
    const now = this.at(to.x, to.y);
    if (now.t === PT.PAWN) {
      if (now.c === COLORS.WHITE && to.y <= 2) {
        now.t = PT.MET; promo = true;
      }
      if (now.c === COLORS.BLACK && to.y >= 5) {
        now.t = PT.MET; promo = true;
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

  // ---------- Counting Draw ----------

  // Any Trey (unpromoted Pawn) anywhere on the board, either color. Once
  // this is false, Board Count becomes possible; Piece/Honor Count also
  // requires it (a promoted piece is a Neang/Met — PT.MET — never a Trey,
  // so it never counts here).
  hasUnpromotedPawn() {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const p = this.at(x, y);
        if (p && p.t === PT.PAWN) return true;
      }
    }
    return false;
  }

  nonKingPieces(color) {
    const out = [];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const p = this.at(x, y);
        if (p && p.c === color && p.t !== PT.KING) out.push(p);
      }
    }
    return out;
  }

  getTotalBoardPieces() {
    let n = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (this.at(x, y)) n++;
      }
    }
    return n;
  }

  getCountingLimit(strongerPieces) {
    let rooks = 0, khons = 0, knights = 0;
    for (const p of strongerPieces) {
      if (p.t === PT.ROOK) rooks++;
      else if (p.t === PT.KHON) khons++;
      else if (p.t === PT.KNIGHT) knights++;
    }
    return countingLimitFromMaterial({ rooks, khons, knights });
  }

  // The single authoritative counting evaluator (pure — never mutates,
  // safe to call any time). Determines, from the CURRENT board alone,
  // whether a counting phase is eligible and — if so — its type, which
  // side is counted (disadvantaged/escaping) vs stronger (chasing), the
  // move limit, and the count's starting value for a phase beginning now.
  //
  // Returns { eligible:false } or:
  //   { eligible:true, type, countingSide, strongerSide, limit, initialCurrent }
  //
  // initialCurrent follows the Ouk Chaktrang convention from the material
  // table itself: a Piece/Honor Count phase's count starts already at the
  // number of pieces on the board (kings included), not at 0 — e.g. 2
  // Rooks + 2 Kings on the board means the count starts at 4/8, i.e. 4
  // effective moves remain, not 8. Board Count has no such convention
  // documented for it, so it starts at a plain 0/64.
  evaluateCountingState() {
    const wPieces = this.nonKingPieces(COLORS.WHITE);
    const bPieces = this.nonKingPieces(COLORS.BLACK);

    // Neither side has any material at all to ever force mate with —
    // an immediate draw regardless of any counting phase (King vs King).
    if (wPieces.length === 0 && bPieces.length === 0) {
      return {
        eligible: true, type: COUNTING_TYPE.BARE_KINGS,
        countingSide: null, strongerSide: null, limit: 0, initialCurrent: 0,
      };
    }

    if (this.hasUnpromotedPawn()) return { eligible: false };

    // Piece/Honor Count: exactly one side is reduced to a lone King.
    if (wPieces.length === 0 || bPieces.length === 0) {
      const countingSide   = wPieces.length === 0 ? COLORS.WHITE : COLORS.BLACK;
      const strongerSide   = this.enemyColor(countingSide);
      const strongerPieces = countingSide === COLORS.WHITE ? bPieces : wPieces;
      const limit = this.getCountingLimit(strongerPieces);
      const initialCurrent = this.getTotalBoardPieces();
      return { eligible: true, type: COUNTING_TYPE.PIECE, countingSide, strongerSide, limit, initialCurrent };
    }

    // Board Count: no Trey remain, but neither side is a lone King.
    // "Stronger/chasing" is determined by non-King piece count; an exact
    // tie means no clear chaser, so Board Count does not engage.
    if (wPieces.length === bPieces.length) return { eligible: false };
    const strongerSide = wPieces.length > bPieces.length ? COLORS.WHITE : COLORS.BLACK;
    const countingSide  = this.enemyColor(strongerSide);
    return { eligible: true, type: COUNTING_TYPE.BOARD, countingSide, strongerSide, limit: 64, initialCurrent: 0 };
  }

  // Advances/starts/clears `this.counting` for the move that was JUST
  // applied (this.turn has already flipped to the next player by the time
  // this runs — see move() below). Called once per real move, never from
  // the AI search's internal _do/_undo hot path, so search performance is
  // completely unaffected.
  _updateCounting() {
    const evald = this.evaluateCountingState();

    if (!evald.eligible) {
      this.counting = emptyCounting();
      return;
    }

    if (evald.type === COUNTING_TYPE.BARE_KINGS) {
      this.counting = {
        active: true, type: COUNTING_TYPE.BARE_KINGS,
        countingSide: null, strongerSide: null, limit: 0, current: 0, remaining: 0,
        result: 'draw', justStarted: true, justIncremented: false,
      };
      return;
    }

    const prev = this.counting;
    const samePhase = prev && prev.active && prev.type === evald.type &&
      prev.countingSide === evald.countingSide && prev.strongerSide === evald.strongerSide;

    if (!samePhase) {
      // A brand-new phase: first-ever eligibility, or the type/sides
      // changed (e.g. Board Count's stronger side flipped, or Piece Count
      // just started the move the last Trey vanished).
      this.counting = {
        active: true, type: evald.type,
        countingSide: evald.countingSide, strongerSide: evald.strongerSide,
        limit: evald.limit, current: evald.initialCurrent,
        remaining: Math.max(0, evald.limit - evald.initialCurrent),
        result: null, justStarted: true, justIncremented: false,
      };
    } else {
      // Same ongoing phase: the limit may still need recalculating (a
      // capture can shrink the stronger side's force — e.g. 2 Rooks -> 1
      // Rook moves 8 -> 16) but progress already made is NEVER reset for
      // a mere capture. Only the stronger side's completed moves ever
      // advance `current` (this.turn already flipped, so the mover is
      // enemyColor(this.turn)).
      const mover = this.enemyColor(this.turn);
      const incremented = mover === prev.strongerSide;
      const current = incremented ? prev.current + 1 : prev.current;
      this.counting = {
        ...prev,
        limit: evald.limit,
        current,
        remaining: Math.max(0, evald.limit - current),
        result: null,
        justStarted: false,
        justIncremented: incremented,
      };
    }

    if (this.counting.current >= this.counting.limit) {
      this.counting.result = 'draw';
    }
  }

  // Debug-only snapshot — never shown to normal users; callers gate this
  // behind their own existing debug-mode flag (see settings.aiDebug).
  getCountingDebugState() {
    return {
      ...this.counting,
      totalPieces: this.getTotalBoardPieces(),
      hasUnpromotedPawn: this.hasUnpromotedPawn(),
    };
  }

  status() {
    const toMove = this.turn;
    const check  = this.inCheck(toMove);
    const any    = this.hasAnyLegalMove(toMove);

    if (any) {
      return { state: check ? 'check' : 'ongoing', inCheck: check, toMove };
    }

    return {
      state: check ? 'checkmate' : 'stalemate',
      inCheck: check,
      toMove,
    };
  }

  // ---------- Public make/undo ----------

  move(from, to) {
    // Checkmate/stalemate already block further moves structurally (the
    // mated/stalemated side's legalMoves() is empty by definition), but a
    // Counting Draw can end the game on a position that still has plenty
    // of legal moves available — so this is the one case that needs an
    // explicit guard: once the game is over for any reason, no further
    // move is ever accepted, full stop.
    if (this.winner) return { ok: false };

    const p = this.at(from.x, from.y);
    if (!p) return { ok: false };

    const isLegal = this
      .legalMoves(from.x, from.y)
      .some(m => m.x === to.x && m.y === to.y);

    if (!isLegal) return { ok: false };

    const prevCounting = this.counting ? { ...this.counting } : emptyCounting();
    const snap = this._do(from, to);
    const { captured, promo } = snap;

    this.history.push({
      from,
      to,
      captured,
      promo,
      prevType:  snap.prevType,
      prevMoved: snap.prevMoved,
      prevCounting,
    });

    this.turn = this.enemyColor(this.turn);

    // Priority order matters (Ouk Chaktrang counting must never override
    // an actual mate): checkmate/stalemate are existing, higher-priority
    // terminal states, decided first and left completely alone — counting
    // is only ever evaluated when the game is NOT already over some other
    // way, and a checkmate on the very last allowed counted move is still
    // simply a win, never a draw, because this branch never runs for it.
    const st = this.status();
    if (st.state === 'checkmate') {
      this.winner = this.enemyColor(st.toMove);
    } else if (st.state === 'stalemate') {
      this.winner = 'draw';
    } else {
      this._updateCounting();
      this.winner = this.counting.result === 'draw' ? 'draw' : null;
    }

    return { ok: true, promo, captured, status: st, counting: this.counting };
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

    this.counting = last.prevCounting ? { ...last.prevCounting } : emptyCounting();
    this.winner = null;
    return true;
  }
}
