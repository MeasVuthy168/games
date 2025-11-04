
// game.js — Makruk core engine (aligned with Fairy-Stockfish "makruk" variant)
// Exports: SIZE, COLORS, PT, Game, initialPosition, piece, toFen
//
// Movement rules implemented (Makruk):
// - King: 1-step any direction
// - Met / Queen: 1-step diagonals
// - Khon / Bishop: 1-step diagonals + 1-step straight forward
// - Rook: sliders orthogonal
// - Knight: L-jump (as in chess)
// - Pawn: 1-step forward (no double); capture 1-step diagonally forward
// - Promotion: Pawn promotes to Met (Queen) when it reaches:
//      * White: rank 6 (y === 2)
//      * Black: rank 3 (y === 5)
//
// Board coordinates:
//   y = 0 → FEN rank 8 (top, black home rank)
//   y = 7 → FEN rank 1 (bottom, white home rank)

export const SIZE   = 8;
export const COLORS = { WHITE:'w', BLACK:'b' };

export const PT = {
  KING:'K', QUEEN:'Q', BISHOP:'B', ROOK:'R', KNIGHT:'N', PAWN:'P',
};

// ----- Helpers -----
export function piece(t,c){ return { t, c, moved:false }; }

// Makruk starting position:
//   Rank 8 (y=0, top):    r n b q k b n r  (black)
//   Rank 6 (y=2):         p p p p p p p p  (black pawns)
//   Rank 3 (y=5):         P P P P P P P P  (white pawns)
//   Rank 1 (y=7, bottom): R N B Q K B N R  (white)
export function initialPosition(){
  const emptyRow = () => Array(SIZE).fill(null);
  const board = Array.from({length: SIZE}, emptyRow);

  // Black back rank (top): R N B Q K B N R
  board[0] = [
    piece(PT.ROOK,'b'), piece(PT.KNIGHT,'b'), piece(PT.BISHOP,'b'), piece(PT.QUEEN,'b'),
    piece(PT.KING,'b'), piece(PT.BISHOP,'b'), piece(PT.KNIGHT,'b'), piece(PT.ROOK,'b'),
  ];

  // Black pawns on rank 6 (y=2)
  board[2] = Array.from({length: SIZE}, () => piece(PT.PAWN,'b'));

  // White pawns on rank 3 (y=5)
  board[5] = Array.from({length: SIZE}, () => piece(PT.PAWN,'w'));

  // White back rank (bottom): R N B Q K B N R   (standard Makruk)
  board[7] = [
    piece(PT.ROOK,'w'), piece(PT.KNIGHT,'w'), piece(PT.BISHOP,'w'), piece(PT.QUEEN,'w'),
    piece(PT.KING,'w'), piece(PT.BISHOP,'w'), piece(PT.KNIGHT,'w'), piece(PT.ROOK,'w'),
  ];

  return board;
}

/* ---------------------- FEN helpers ---------------------- */
function pieceLetter(p){
  switch (p.t){
    case PT.KING:   return 'K'; // King
    case PT.QUEEN:  return 'Q'; // Met
    case PT.BISHOP: return 'B'; // Khon
    case PT.ROOK:   return 'R'; // Boat
    case PT.KNIGHT: return 'N'; // Horse
    case PT.PAWN:   return 'P'; // Pawn

    // Khmer aliases (if ever present)
    case 'S': return 'K';
    case 'D': return 'Q';
    case 'G': return 'B';
    case 'T': return 'R';
    case 'H': return 'N';
    case 'F': return 'P';
    default:  return 'P';
  }
}

// Convert current position to a chess-like FEN string
// (castling/en-passant are not used in Makruk)
export function toFen(game){
  const rows = [];
  for (let y = 0; y < 8; y++){
    let row = '';
    let empties = 0;
    for (let x = 0; x < 8; x++){
      const p = game.at(x,y);
      if (!p){ empties++; continue; }
      if (empties){ row += String(empties); empties = 0; }
      const letter = pieceLetter(p);
      row += (p.c === 'w') ? letter : letter.toLowerCase();
    }
    if (empties) row += String(empties);
    rows.push(row);
  }
  const boardPart = rows.join('/');
  const stm = (game.turn === 'w') ? 'w' : 'b';
  return `${boardPart} ${stm} - - 0 1`;
}

// ----- Engine -----
export class Game{
  constructor(){ this.reset(); }

  reset(){
    this.board  = initialPosition();
    this.turn   = COLORS.WHITE;
    this.history= [];
    this.winner = null;
  }

  // expose FEN for AI
  toFEN(){ return toFen(this); }

  inBounds(x,y){ return x>=0 && x<SIZE && y>=0 && y<SIZE; }
  at(x,y){ return this.board[y][x]; }
  set(x,y,v){ this.board[y][x]=v; }
  enemyColor(c){ return c==='w'?'b':'w'; }

  // white moves "up" (toward y decreasing), black moves "down" (y increasing)
  pawnDir(c){ return c==='w' ? -1 : +1; }

  // ---------- Move generators ----------
  // PSEUDO-legal (ignores self-check); used by legalMoves + UI hints
  pseudoMoves(x,y){
    const p = this.at(x,y); if (!p) return [];
    const out = [];

    const tryAdd = (nx,ny,mode='both')=>{
      if(!this.inBounds(nx,ny)) return false;
      const t = this.at(nx,ny);
      if (!t){
        if (mode!=='capture') out.push({x:nx,y:ny});
        return true; // can continue rays
      } else if (t.c !== p.c){
        if (mode!=='move') out.push({x:nx,y:ny});
      }
      return false; // blocked
    };

    const ray = (dx,dy)=>{
      let nx=x+dx, ny=y+dy;
      while(this.inBounds(nx,ny)){
        const go = tryAdd(nx,ny,'both');
        if (!go) break;
        nx+=dx; ny+=dy;
      }
    };

    switch(p.t){

      // KING: 1-step any direction (no special first-move)
      case PT.KING: {
        for (const dx of [-1,0,1]){
          for (const dy of [-1,0,1]){
            if (dx || dy) tryAdd(x+dx,y+dy,'both');
          }
        }
        break;
      }

      // MET / QUEEN: 1-step diagonals (ferz)
      case PT.QUEEN: {
        tryAdd(x-1,y-1,'both'); tryAdd(x+1,y-1,'both');
        tryAdd(x-1,y+1,'both'); tryAdd(x+1,y+1,'both');
        break;
      }

      // KHON / BISHOP: 1-step diagonals + 1-step straight forward
      case PT.BISHOP: {
        const d=this.pawnDir(p.c);
        tryAdd(x-1,y-1,'both'); tryAdd(x+1,y-1,'both');
        tryAdd(x-1,y+1,'both'); tryAdd(x+1,y+1,'both');
        tryAdd(x, y+d, 'both');
        break;
      }

      // ROOK: sliders orthogonal
      case PT.ROOK:
        ray(+1,0); ray(-1,0); ray(0,+1); ray(0,-1);
        break;

      // KNIGHT: standard L-jump
      case PT.KNIGHT: {
        const jumps = [
          [1,-2],[2,-1],[2,1],[1,2],
          [-1,2],[-2,1],[-2,-1],[-1,-2]
        ];
        for (const [dx,dy] of jumps) tryAdd(x+dx,y+dy,'both');
        break;
      }

      // PAWN: 1 forward (non-capture), diagonals forward capture
      case PT.PAWN: {
        const d = this.pawnDir(p.c);

        // quiet forward
        if (this.inBounds(x,y+d) && !this.at(x,y+d)){
          out.push({x,y:y+d});
        }

        // captures
        for (const dx of [-1,1]){
          const nx=x+dx, ny=y+d;
          if (!this.inBounds(nx,ny)) continue;
          const t=this.at(nx,ny);
          if (t && t.c!==p.c) out.push({x:nx,y:ny});
        }
        break;
      }
    }
    return out;
  }

  // ATTACK map (for check detection) – reflects capture patterns.
  attacksFrom(x,y){
    const p=this.at(x,y); if(!p) return [];
    const A=[];

    const addIfEnemyOrEmpty = (nx,ny,capOnly=false)=>{
      if(!this.inBounds(nx,ny)) return false;
      const t=this.at(nx,ny);
      if (capOnly){
        // for pawns’ diagonal “threat” squares, we record regardless of occupancy
        A.push({x:nx,y:ny});
        return false; // not a ray
      }
      if (!t){ A.push({x:nx,y:ny}); return true; }
      if (t.c!==p.c){ A.push({x:nx,y:ny}); }
      return false;
    };

    const ray = (dx,dy)=>{
      let nx=x+dx, ny=y+dy;
      while(this.inBounds(nx,ny)){
        const t=this.at(nx,ny);
        A.push({x:nx,y:ny});
        if (t) break;
        nx+=dx; ny+=dy;
      }
    };

    switch(p.t){
      case PT.KING:
        for (const dx of [-1,0,1])
          for (const dy of [-1,0,1])
            if (dx||dy) addIfEnemyOrEmpty(x+dx,y+dy);
        break;

      case PT.QUEEN:
        addIfEnemyOrEmpty(x-1,y-1);
        addIfEnemyOrEmpty(x+1,y-1);
        addIfEnemyOrEmpty(x-1,y+1);
        addIfEnemyOrEmpty(x+1,y+1);
        break;

      case PT.BISHOP: {
        const d=this.pawnDir(p.c);
        addIfEnemyOrEmpty(x-1,y-1);
        addIfEnemyOrEmpty(x+1,y-1);
        addIfEnemyOrEmpty(x-1,y+1);
        addIfEnemyOrEmpty(x+1,y+1);
        addIfEnemyOrEmpty(x,  y+d);
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
        for (const [dx,dy] of jumps) addIfEnemyOrEmpty(x+dx,y+dy);
        break;
      }

      case PT.PAWN: {
        const d=this.pawnDir(p.c);
        addIfEnemyOrEmpty(x-1, y+d, /*capOnly*/true);
        addIfEnemyOrEmpty(x+1, y+d, /*capOnly*/true);
        break;
      }
    }
    return A;
  }

  // ---------- Check / status ----------
  findKing(color){
    for(let y=0;y<SIZE;y++) for(let x=0;x<SIZE;x++){
      const p=this.at(x,y);
      if (p && p.c===color && p.t===PT.KING) return {x,y};
    }
    return null;
  }

  squareAttacked(x,y,byColor){
    for(let j=0;j<SIZE;j++) for(let i=0;i<SIZE;i++){
      const p=this.at(i,j);
      if(!p || p.c!==byColor) continue;
      const att = this.attacksFrom(i,j);
      if (att.some(m=>m.x===x && m.y===y)) return true;
    }
    return false;
  }

  inCheck(color){
    const k = this.findKing(color);
    if (!k) return false;
    return this.squareAttacked(k.x, k.y, this.enemyColor(color));
  }

  // ---------- Legal moves (filter self-check) ----------
  _do(from,to){
    const p = this.at(from.x,from.y);
    const prevMoved = p.moved;
    const prevType  = p.t;
    const captured  = this.at(to.x,to.y) || null;

    // move piece
    this.set(to.x,to.y, {...p, moved:true});
    this.set(from.x,from.y, null);

    // promotion: Makruk style (exact rank)
    let promo=false;
    const now = this.at(to.x,to.y);
    if (now.t===PT.PAWN){
      // White promotes on rank 6 (y === 2)
      if (now.c==='w' && to.y === 2){ now.t=PT.QUEEN; promo=true; }
      // Black promotes on rank 3 (y === 5)
      if (now.c==='b' && to.y === 5){ now.t=PT.QUEEN; promo=true; }
    }
    return { captured, promo, prevMoved, prevType };
  }

  _undo(from,to,snap){
    const p = this.at(to.x,to.y);
    if (snap.promo) p.t = snap.prevType;
    this.set(from.x,from.y, {...p, moved:snap.prevMoved});
    this.set(to.x,to.y, snap.captured);
  }

  legalMoves(x,y){
    const p = this.at(x,y); if(!p) return [];
    const raw = this.pseudoMoves(x,y);
    const keep=[];
    for (const mv of raw){
      const snap = this._do({x,y}, mv);
      const ok   = !this.inCheck(p.c);
      this._undo({x,y}, mv, snap);
      if (ok) keep.push(mv);
    }
    return keep;
  }

  hasAnyLegalMove(color){
    for(let y=0;y<SIZE;y++) for(let x=0;x<SIZE;x++){
      const p=this.at(x,y); if(!p || p.c!==color) continue;
      if (this.legalMoves(x,y).length) return true;
    }
    return false;
  }

  status(){
    const toMove = this.turn;
    const check  = this.inCheck(toMove);
    const any    = this.hasAnyLegalMove(toMove);
    if (any) return { state: check ? 'check' : 'ongoing', inCheck:check, toMove };
    return { state: check ? 'checkmate' : 'stalemate', inCheck:check, toMove };
  }

  // ---------- Public make/undo ----------
  move(from,to){
    const p=this.at(from.x,from.y); if(!p) return {ok:false};
    const isLegal = this.legalMoves(from.x,from.y).some(m=>m.x===to.x && m.y===to.y);
    if (!isLegal) return {ok:false};

    const snap = this._do(from,to);
    const { captured, promo } = snap;

    this.history.push({ from, to, captured, promo, prevType:snap.prevType, prevMoved:snap.prevMoved });
    this.turn = this.enemyColor(this.turn);

    const st = this.status();
    if (st.state==='checkmate') this.winner=this.enemyColor(st.toMove);
    else if (st.state==='stalemate') this.winner='draw';
    else this.winner=null;

    return { ok:true, promo, captured, status:st };
  }

  undo(){
    const last = this.history.pop(); if (!last) return false;
    this.turn = this.enemyColor(this.turn);
    this._undo(last.from,last.to,{
      captured:last.captured,
      promo:last.promo,
      prevType:last.prevType,
      prevMoved:last.prevMoved
    });
    this.winner=null;
    return true;
  }
}
