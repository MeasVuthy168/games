// game.js — Makruk engine (front-end) aligned with Fairy-Stockfish “makruk”
// - Board: 8x8
// - Start FEN: rnbqkbnr/8/pppppppp/8/8/PPPPPPPP/8/RNBQKBNR w - - 0 1
// - Pieces (type letters):
//     K = King
//     Q = Met (Makruk queen)      → 1 step diagonally
//     B = Khon (Makruk bishop)    → 1 step diagonally OR 1 step straight forward
//     N = Knight
//     R = Rook
//     P = Pawn/Fish               → 1 step forward, diagonal capture, no double
//
// No castling, no en-passant, promotion when pawn reaches last 3 ranks
// (this file exposes the same public API as your previous Game class).

export const SIZE   = 8;
export const COLORS = { WHITE:'w', BLACK:'b' };

// Canonical Makruk start position used by Fairy-Stockfish (variant=makruk)
export const START_FEN =
  'rnbqkbnr/8/pppppppp/8/8/PPPPPPPP/8/RNBQKBNR w - - 0 1';

// ---- piece helper ----
function piece(t, c){
  return { t, c, moved:false };
}

// ---- initial setup from START_FEN (but we also build directly) ----
export function initialPosition(){
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));

  // Black back rank (top): r n b q k b n r  at y=0
  board[0][0] = piece('R','b');
  board[0][1] = piece('N','b');
  board[0][2] = piece('B','b');
  board[0][3] = piece('Q','b');   // Met
  board[0][4] = piece('K','b');
  board[0][5] = piece('B','b');   // Khon
  board[0][6] = piece('N','b');
  board[0][7] = piece('R','b');

  // Rank 1 (y=1) empty for Makruk
  // Black pawns (Fish) on rank 3 (y=2)
  for (let x=0; x<SIZE; x++){
    board[2][x] = piece('P','b');
  }

  // Ranks 3 & 4 (y=3,4) empty
  // White pawns on rank 6 (y=5)
  for (let x=0; x<SIZE; x++){
    board[5][x] = piece('P','w');
  }

  // Rank 7 (y=6) empty
  // White back rank (bottom, y=7): R N B Q K B N R
  board[7][0] = piece('R','w');
  board[7][1] = piece('N','w');
  board[7][2] = piece('B','w');
  board[7][3] = piece('Q','w');   // Met
  board[7][4] = piece('K','w');
  board[7][5] = piece('B','w');   // Khon
  board[7][6] = piece('N','w');
  board[7][7] = piece('R','w');

  return board;
}

/* ---------------------- FEN helpers ---------------------- */

function pieceLetter(p){
  switch (p.t){
    case 'K': return 'K';
    case 'Q': return 'Q';
    case 'B': return 'B';
    case 'R': return 'R';
    case 'N': return 'N';
    case 'P': return 'P';
    default:  return 'P';
  }
}

// Convert current position to a chess-like FEN string.
// (castling/en-passant not used in Makruk; we keep “- - 0 1” tail.)
export function toFEN(game){
  const rows = [];
  for (let y = 0; y < 8; y++){
    let row = '';
    let empties = 0;
    for (let x = 0; x < 8; x++){
      const p = game.at(x,y);
      if (!p){
        empties++;
        continue;
      }
      if (empties){
        row += String(empties);
        empties = 0;
      }
      const letter = pieceLetter(p);
      row += (p.c === 'w') ? letter : letter.toLowerCase();
    }
    if (empties) row += String(empties);
    rows.push(row);
  }
  const boardPart = rows.join('/');
  const stm = (game.turn === COLORS.WHITE) ? 'w' : 'b';
  return `${boardPart} ${stm} - - 0 1`;
}

/* ---------------------- Core engine ---------------------- */

export class Game{
  constructor(){
    this.reset();
  }

  reset(){
    this.board   = initialPosition();
    this.turn    = COLORS.WHITE;
    this.history = [];
    this.winner  = null;
  }

  // expose FEN for AI
  toFEN(){
    return toFEN(this);
  }

  inBounds(x,y){ return x>=0 && x<SIZE && y>=0 && y<SIZE; }
  at(x,y){ return this.board[y][x]; }
  set(x,y,v){ this.board[y][x] = v; }

  enemyColor(c){ return c === 'w' ? 'b' : 'w'; }
  pawnDir(c){ return c === 'w' ? -1 : +1; }

  /* ---------- Pseudo-legal moves (don’t check self-check) ---------- */

  pseudoMoves(x,y){
    const p = this.at(x,y);
    if (!p) return [];
    const out = [];

    const tryAdd = (nx,ny,mode='both')=>{
      if (!this.inBounds(nx,ny)) return false;
      const t = this.at(nx,ny);
      if (!t){
        if (mode !== 'capture') out.push({ x:nx, y:ny });
        return true; // rays can continue
      } else if (t.c !== p.c){
        if (mode !== 'move') out.push({ x:nx, y:ny });
      }
      return false; // blocked
    };

    const ray = (dx,dy)=>{
      let nx = x+dx, ny = y+dy;
      while (this.inBounds(nx,ny)){
        const go = tryAdd(nx,ny,'both');
        if (!go) break;
        nx += dx; ny += dy;
      }
    };

    switch (p.t){

      // KING: 1 step any direction
      case 'K': {
        for (let dx=-1; dx<=1; dx++){
          for (let dy=-1; dy<=1; dy++){
            if (!dx && !dy) continue;
            tryAdd(x+dx, y+dy, 'both');
          }
        }
        break;
      }

      // MET / QUEEN: 1 step diagonals only
      case 'Q': {
        tryAdd(x-1, y-1, 'both');
        tryAdd(x+1, y-1, 'both');
        tryAdd(x-1, y+1, 'both');
        tryAdd(x+1, y+1, 'both');
        break;
      }

      // KHON / BISHOP: 1 step diagonals + 1 step straight forward
      case 'B': {
        const d = this.pawnDir(p.c);
        tryAdd(x-1, y-1, 'both');
        tryAdd(x+1, y-1, 'both');
        tryAdd(x-1, y+1, 'both');
        tryAdd(x+1, y+1, 'both');
        tryAdd(x,   y+d, 'both'); // straight forward
        break;
      }

      // ROOK: sliders orthogonal
      case 'R':
        ray(+1,0); ray(-1,0); ray(0,+1); ray(0,-1);
        break;

      // KNIGHT: L jumper
      case 'N': {
        const steps = [
          [ 1,-2],[ 2,-1],[ 2, 1],[ 1, 2],
          [-1, 2],[-2, 1],[-2,-1],[-1,-2]
        ];
        for (const [dx,dy] of steps){
          tryAdd(x+dx,y+dy,'both');
        }
        break;
      }

      // PAWN / FISH: 1 forward (non-capture), diagonal forward capture
      case 'P': {
        const d = this.pawnDir(p.c);
        // forward quiet
        const fy = y + d;
        if (this.inBounds(x,fy) && !this.at(x,fy)){
          out.push({ x, y:fy });
        }
        // diagonal captures
        for (const dx of [-1, +1]){
          const nx = x+dx, ny = y+d;
          if (!this.inBounds(nx,ny)) continue;
          const t = this.at(nx,ny);
          if (t && t.c !== p.c){
            out.push({ x:nx, y:ny });
          }
        }
        break;
      }
    }

    return out;
  }

  /* ---------- Attack map (for check detection) ---------- */

  attacksFrom(x,y){
    const p = this.at(x,y);
    if (!p) return [];
    const A = [];

    const addStep = (nx,ny)=>{
      if (!this.inBounds(nx,ny)) return;
      A.push({ x:nx, y:ny });
    };

    const ray = (dx,dy)=>{
      let nx = x+dx, ny = y+dy;
      while (this.inBounds(nx,ny)){
        A.push({ x:nx, y:ny });
        if (this.at(nx,ny)) break;
        nx += dx; ny += dy;
      }
    };

    switch (p.t){
      case 'K':
        for (let dx=-1; dx<=1; dx++){
          for (let dy=-1; dy<=1; dy++){
            if (!dx && !dy) continue;
            addStep(x+dx,y+dy);
          }
        }
        break;

      case 'Q':
        addStep(x-1,y-1); addStep(x+1,y-1);
        addStep(x-1,y+1); addStep(x+1,y+1);
        break;

      case 'B': {
        const d = this.pawnDir(p.c);
        addStep(x-1,y-1); addStep(x+1,y-1);
        addStep(x-1,y+1); addStep(x+1,y+1);
        addStep(x,  y+d);
        break;
      }

      case 'R':
        ray(+1,0); ray(-1,0); ray(0,+1); ray(0,-1);
        break;

      case 'N': {
        const steps = [
          [ 1,-2],[ 2,-1],[ 2, 1],[ 1, 2],
          [-1, 2],[-2, 1],[-2,-1],[-1,-2]
        ];
        for (const [dx,dy] of steps){
          addStep(x+dx,y+dy);
        }
        break;
      }

      case 'P': {
        const d = this.pawnDir(p.c);
        addStep(x-1, y+d);
        addStep(x+1, y+d);
        break;
      }
    }

    return A;
  }

  /* ---------- Check / status ---------- */

  findKing(color){
    for (let y=0; y<SIZE; y++){
      for (let x=0; x<SIZE; x++){
        const p = this.at(x,y);
        if (p && p.c === color && p.t === 'K'){
          return { x, y };
        }
      }
    }
    return null;
  }

  squareAttacked(x,y,byColor){
    for (let j=0; j<SIZE; j++){
      for (let i=0; i<SIZE; i++){
        const p = this.at(i,j);
        if (!p || p.c !== byColor) continue;
        const att = this.attacksFrom(i,j);
        if (att.some(m => m.x === x && m.y === y)) return true;
      }
    }
    return false;
  }

  inCheck(color){
    const k = this.findKing(color);
    if (!k) return false;
    return this.squareAttacked(k.x, k.y, this.enemyColor(color));
  }

  /* ---------- Legal moves (filter self-check) ---------- */

  _do(from,to){
    const p = this.at(from.x,from.y);
    const prevMoved = p.moved;
    const prevType  = p.t;
    const captured  = this.at(to.x,to.y) || null;

    // move piece
    this.set(to.x,to.y, { ...p, moved:true });
    this.set(from.x,from.y, null);

    // promotion: entering last 3 ranks
    let promo = false;
    const now = this.at(to.x,to.y);
    if (now.t === 'P'){
      if (now.c === 'w' && to.y <= 2){
        now.t = 'Q'; promo = true;
      }
      if (now.c === 'b' && to.y >= 5){
        now.t = 'Q'; promo = true;
      }
    }

    return { captured, promo, prevMoved, prevType };
  }

  _undo(from,to,snap){
    const p = this.at(to.x,to.y);
    if (snap.promo) p.t = snap.prevType;
    this.set(from.x,from.y, { ...p, moved:snap.prevMoved });
    this.set(to.x,to.y, snap.captured);
  }

  legalMoves(x,y){
    const p = this.at(x,y);
    if (!p) return [];
    const raw   = this.pseudoMoves(x,y);
    const keep  = [];

    for (const mv of raw){
      const snap = this._do({x,y}, mv);
      const ok   = !this.inCheck(p.c);
      this._undo({x,y}, mv, snap);
      if (ok) keep.push(mv);
    }

    return keep;
  }

  hasAnyLegalMove(color){
    for (let y=0; y<SIZE; y++){
      for (let x=0; x<SIZE; x++){
        const p = this.at(x,y);
        if (!p || p.c !== color) continue;
        if (this.legalMoves(x,y).length) return true;
      }
    }
    return false;
  }

  status(){
    const toMove = this.turn;
    const check  = this.inCheck(toMove);
    const any    = this.hasAnyLegalMove(toMove);
    if (any){
      return { state: check ? 'check' : 'ongoing', inCheck:check, toMove };
    }
    return { state: check ? 'checkmate' : 'stalemate', inCheck:check, toMove };
  }

  /* ---------- Public move / undo ---------- */

  move(from,to){
    const p = this.at(from.x,from.y);
    if (!p) return { ok:false };

    const legal = this.legalMoves(from.x,from.y);
    const isLegal = legal.some(m => m.x === to.x && m.y === to.y);
    if (!isLegal) return { ok:false };

    const snap = this._do(from,to);
    const { captured, promo } = snap;

    this.history.push({
      from, to, captured, promo,
      prevType:  snap.prevType,
      prevMoved: snap.prevMoved
    });

    this.turn = this.enemyColor(this.turn);

    const st = this.status();
    if (st.state === 'checkmate'){
      this.winner = this.enemyColor(st.toMove);
    } else if (st.state === 'stalemate'){
      this.winner = 'draw';
    } else {
      this.winner = null;
    }

    return { ok:true, promo, captured, status:st };
  }

  undo(){
    const last = this.history.pop();
    if (!last) return false;

    this.turn = this.enemyColor(this.turn);
    this._undo(last.from, last.to, {
      captured:  last.captured,
      promo:     last.promo,
      prevType:  last.prevType,
      prevMoved: last.prevMoved
    });
    this.winner = null;
    return true;
  }
}
