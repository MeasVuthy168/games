// game.js — TRUE Makruk core engine, aligned with Fairy-Stockfish "makruk" variant
// Exports: SIZE, COLORS, PT, piece, initialPosition, toFEN, Game

export const SIZE   = 8;
export const COLORS = { WHITE:'w', BLACK:'b' };

export const PT = {
  KING:   'K',
  QUEEN:  'Q',  // Neang / seed (ferz)
  BISHOP: 'B',  // Khon / elephant
  ROOK:   'R',
  KNIGHT: 'N',
  PAWN:   'P',  // Fish
};

// ----- helpers -----
export function piece(t,c){ return { t, c, moved:false }; }

// Makruk start, as used by Fairy-Stockfish "makruk":
// rnbqkbnr/8/pppppppp/8/8/PPPPPPPP/8/RNBQKBNR w - - 0 1
export function initialPosition(){
  const board = Array.from({length: SIZE}, () => Array(SIZE).fill(null));

  // Black back rank (top, rank 8 → y=0): r n b q k b n r
  board[0] = [
    piece(PT.ROOK,  'b'),
    piece(PT.KNIGHT,'b'),
    piece(PT.BISHOP,'b'),
    piece(PT.QUEEN, 'b'),
    piece(PT.KING,  'b'),
    piece(PT.BISHOP,'b'),
    piece(PT.KNIGHT,'b'),
    piece(PT.ROOK,  'b'),
  ];

  // Black pawns on rank 6 → y=2
  for (let x = 0; x < SIZE; x++){
    board[2][x] = piece(PT.PAWN,'b');
  }

  // White pawns on rank 3 → y=5
  for (let x = 0; x < SIZE; x++){
    board[5][x] = piece(PT.PAWN,'w');
  }

  // White back rank (bottom, rank 1 → y=7): r n b q k b n r
  board[7] = [
    piece(PT.ROOK,  'w'),
    piece(PT.KNIGHT,'w'),
    piece(PT.BISHOP,'w'),
    piece(PT.QUEEN, 'w'),
    piece(PT.KING,  'w'),
    piece(PT.BISHOP,'w'),
    piece(PT.KNIGHT,'w'),
    piece(PT.ROOK,  'w'),
  ];

  return board;
}

/* ---------------------- FEN helpers ---------------------- */

function pieceLetter(p){
  if (!p) return '';
  switch (p.t){
    case PT.KING:   return 'K';
    case PT.QUEEN:  return 'Q';
    case PT.BISHOP: return 'B';
    case PT.ROOK:   return 'R';
    case PT.KNIGHT: return 'N';
    case PT.PAWN:   return 'P';
    default:        return 'P';
  }
}

// Convert current position to a chess-style FEN string.
// No castling / en-passant in Makruk.
export function toFEN(game){
  const rows = [];
  for (let y = 0; y < SIZE; y++){
    let row = '';
    let empties = 0;
    for (let x = 0; x < SIZE; x++){
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
      row += (p.c === COLORS.WHITE) ? letter : letter.toLowerCase();
    }
    if (empties) row += String(empties);
    if (!row) row = '8';
    rows.push(row);
  }
  const boardPart = rows.join('/');
  const stm = game.turn === COLORS.WHITE ? 'w' : 'b';
  return `${boardPart} ${stm} - - 0 1`;
}

/* ---------------------- Engine core ---------------------- */

export class Game{
  constructor(){
    this.reset();
  }

  reset(){
    this.board   = initialPosition();
    this.turn    = COLORS.WHITE;   // White to move first (as in engine)
    this.history = [];
    this.winner  = null;
  }

  // used by AI
  toFEN(){ return toFEN(this); }

  inBounds(x,y){ return x>=0 && x<SIZE && y>=0 && y<SIZE; }
  at(x,y){ return this.board[y][x]; }
  set(x,y,v){ this.board[y][x] = v; }
  enemyColor(c){ return c === COLORS.WHITE ? COLORS.BLACK : COLORS.WHITE; }
  pawnDir(c){ return c === COLORS.WHITE ? -1 : +1; }

  /* ---------- pseudo legal moves (no self-check filter) ---------- */

  pseudoMoves(x,y){
    const p = this.at(x,y);
    if (!p) return [];
    const out = [];

    const tryAdd = (nx,ny, mode='both')=>{
      if (!this.inBounds(nx,ny)) return false;
      const t = this.at(nx,ny);
      if (!t){
        if (mode !== 'capture') out.push({ x:nx, y:ny });
        return true;  // ray can continue
      } else if (t.c !== p.c){
        if (mode !== 'move') out.push({ x:nx, y:ny });
      }
      return false;   // ray blocked
    };

    const ray = (dx,dy)=>{
      let nx = x+dx, ny = y+dy;
      while (this.inBounds(nx,ny)){
        const cont = tryAdd(nx,ny,'both');
        if (!cont) break;
        nx += dx; ny += dy;
      }
    };

    switch (p.t){

      // KING: 1 step any direction
      case PT.KING: {
        for (let dx=-1; dx<=1; dx++){
          for (let dy=-1; dy<=1; dy++){
            if (!dx && !dy) continue;
            tryAdd(x+dx, y+dy, 'both');
          }
        }
        break;
      }

      // QUEEN (Neang): one step diagonally (ferz)
      case PT.QUEEN: {
        tryAdd(x-1,y-1,'both'); tryAdd(x+1,y-1,'both');
        tryAdd(x-1,y+1,'both'); tryAdd(x+1,y+1,'both');
        break;
      }

      // BISHOP (Khon): one step diagonally OR one step straight forward
      case PT.BISHOP: {
        const d = this.pawnDir(p.c);
        tryAdd(x-1,y-1,'both'); tryAdd(x+1,y-1,'both');
        tryAdd(x-1,y+1,'both'); tryAdd(x+1,y+1,'both');
        tryAdd(x, y+d, 'both');   // straight forward
        break;
      }

      // Rook: orthogonal sliders (like chess)
      case PT.ROOK:
        ray(+1,0); ray(-1,0); ray(0,+1); ray(0,-1);
        break;

      // Knight: chess knight
      case PT.KNIGHT: {
        const jumps = [
          [1,-2],[2,-1],[2,1],[1,2],
          [-1,2],[-2,1],[-2,-1],[-1,-2]
        ];
        for (const [dx,dy] of jumps){
          tryAdd(x+dx,y+dy,'both');
        }
        break;
      }

      // Pawn / Fish: 1 forward (non-capture), diagonals forward capture, no double, no en-passant
      case PT.PAWN: {
        const d = this.pawnDir(p.c);
        const fy = y + d;

        // quiet forward
        if (this.inBounds(x,fy) && !this.at(x,fy)){
          out.push({ x, y:fy });
        }

        // diagonal captures
        for (const dx of [-1, +1]){
          const nx = x+dx, ny = y+d;
          if (!this.inBounds(nx,ny)) continue;
          const t = this.at(nx,ny);
          if (t && t.c !== p.c) out.push({ x:nx, y:ny });
        }
        break;
      }
    }

    return out;
  }

  /* ---------- attack map (for check detection) ---------- */

  attacksFrom(x,y){
    const p = this.at(x,y);
    if (!p) return [];
    const A = [];

    const add = (nx,ny, asRay=false)=>{
      if (!this.inBounds(nx,ny)) return false;
      A.push({x:nx,y:ny});
      if (!asRay) return false;
      const t = this.at(nx,ny);
      return !t; // ray continues only through empty
    };

    const ray = (dx,dy)=>{
      let nx=x+dx, ny=y+dy;
      while (this.inBounds(nx,ny)){
        A.push({x:nx,y:ny});
        if (this.at(nx,ny)) break;
        nx+=dx; ny+=dy;
      }
    };

    switch (p.t){
      case PT.KING:
        for (let dx=-1; dx<=1; dx++){
          for (let dy=-1; dy<=1; dy++){
            if (!dx && !dy) continue;
            add(x+dx,y+dy);
          }
        }
        break;

      case PT.QUEEN:
        add(x-1,y-1); add(x+1,y-1);
        add(x-1,y+1); add(x+1,y+1);
        break;

      case PT.BISHOP: {
        const d = this.pawnDir(p.c);
        add(x-1,y-1); add(x+1,y-1);
        add(x-1,y+1); add(x+1,y+1);
        add(x,  y+d);
        break;
      }

      case PT.ROOK:
        ray(+1,0); ray(-1,0); ray(0,+1); ray(0,-1);
        break;

      case PT.KNIGHT: {
        const jumps = [
          [1,-2],[2,-1],[2,1],[1,2],
          [-1,2],[-2,1],[-2,-1],[-1,-2]
        ];
        for (const [dx,dy] of jumps){
          add(x+dx,y+dy);
        }
        break;
      }

      case PT.PAWN: {
        const d = this.pawnDir(p.c);
        add(x-1, y+d);
        add(x+1, y+d);
        break;
      }
    }
    return A;
  }

  /* ---------- check & status ---------- */

  findKing(color){
    for (let y=0; y<SIZE; y++){
      for (let x=0; x<SIZE; x++){
        const p = this.at(x,y);
        if (p && p.c === color && p.t === PT.KING) return {x,y};
      }
    }
    return null;
  }

  squareAttacked(x,y, byColor){
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
    if (any) return { state: check ? 'check' : 'ongoing', inCheck: check, toMove };
    return { state: check ? 'checkmate' : 'stalemate', inCheck: check, toMove };
  }

  /* ---------- make / unmake ---------- */

  _do(from,to){
    const p = this.at(from.x,from.y);
    const prevMoved = p.moved;
    const prevType  = p.t;
    const captured  = this.at(to.x,to.y) || null;

    // move piece
    const movedPiece = { ...p, moved:true };
    this.set(to.x,to.y, movedPiece);
    this.set(from.x,from.y, null);

    // promotion: last 3 ranks
    let promo = false;
    const now = this.at(to.x,to.y);
    if (now.t === PT.PAWN){
      if (now.c === COLORS.WHITE && to.y <= 2){
        now.t = PT.QUEEN;
        promo = true;
      }
      if (now.c === COLORS.BLACK && to.y >= 5){
        now.t = PT.QUEEN;
        promo = true;
      }
    }

    return { captured, promo, prevMoved, prevType };
  }

  _undo(from,to,snap){
    const p = this.at(to.x,to.y);
    if (!p) return;

    if (snap.promo){
      p.t = snap.prevType;
    }
    this.set(from.x,from.y, { ...p, moved: snap.prevMoved });
    this.set(to.x,to.y, snap.captured);
  }

  legalMoves(x,y){
    const p = this.at(x,y);
    if (!p || p.c !== this.turn) return [];
    const raw = this.pseudoMoves(x,y);
    const keep = [];

    for (const mv of raw){
      const snap = this._do({x,y}, mv);
      const ok   = !this.inCheck(p.c);
      this._undo({x,y}, mv, snap);
      if (ok) keep.push(mv);
    }
    return keep;
  }

  move(from,to){
    const p = this.at(from.x,from.y);
    if (!p || p.c !== this.turn) return { ok:false };

    const legal = this.legalMoves(from.x,from.y);
    const allowed = legal.some(m => m.x === to.x && m.y === to.y);
    if (!allowed) return { ok:false };

    const snap = this._do(from,to);
    const { captured, promo } = snap;

    this.history.push({
      from, to, captured, promo,
      prevType: snap.prevType,
      prevMoved: snap.prevMoved
    });

    this.turn = this.enemyColor(this.turn);

    const st = this.status();
    if (st.state === 'checkmate') this.winner = this.enemyColor(st.toMove);
    else if (st.state === 'stalemate') this.winner = 'draw';
    else this.winner = null;

    return { ok:true, promo, captured, status: st };
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
