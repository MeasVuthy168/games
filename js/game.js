// game.js — Khmer Chess (Makruk-style) core engine
// Exports: SIZE, COLORS, PT, Game, initialPosition, piece, toFen
// Movement rules implemented:
// - King (ស្តេច): 1-step any direction; FIRST MOVE ONLY: (±2 files, +1 rank forward), non-capturing, no jump
// - Neang / Queen (នាង): 1-step diagonals; FIRST MOVE ONLY: straight forward 2, non-capturing, no jump
// - Khun / Bishop (ខុន): 1-step diagonals + 1-step straight forward
// - Rook / Boat (ទូក): sliders orthogonal
// - Knight / Horse (សេះ): L-jump
// - Fish / Pawn (ត្រី): 1-step to any forward neighbor (straight or diagonal), capture or non-capture
// Promotion: Fish promotes to Neang when entering last three ranks (White y<=2, Black y>=5)

export const SIZE   = 8;
export const COLORS = { WHITE:'w', BLACK:'b' };

export const PT = {
  KING:'K', QUEEN:'Q', BISHOP:'B', ROOK:'R', KNIGHT:'N', PAWN:'P',
};

// ----- Setup -----
export function piece(t,c){ return { t, c, moved:false }; }

export function initialPosition(){
  const emptyRow = () => Array(SIZE).fill(null);
  const board = Array.from({length: SIZE}, emptyRow);

  // Black back rank (top): R N B Q K B N R
  board[0] = [
    piece(PT.ROOK,'b'), piece(PT.KNIGHT,'b'), piece(PT.BISHOP,'b'), piece(PT.QUEEN,'b'),
    piece(PT.KING,'b'), piece(PT.BISHOP,'b'), piece(PT.KNIGHT,'b'), piece(PT.ROOK,'b'),
  ];

  // Black Fish (pawns) on rank 3 (y=2)
  board[2] = Array.from({length: SIZE}, () => piece(PT.PAWN,'b'));

  // White Fish (pawns) on rank 6 (y=5)
  board[5] = Array.from({length: SIZE}, () => piece(PT.PAWN,'w'));

  // White back rank (bottom): R N B K Q B N R  (Neang to the RIGHT of King)
  board[7] = [
    piece(PT.ROOK,'w'), piece(PT.KNIGHT,'w'), piece(PT.BISHOP,'w'), piece(PT.KING,'w'),
    piece(PT.QUEEN,'w'), piece(PT.BISHOP,'w'), piece(PT.KNIGHT,'w'), piece(PT.ROOK,'w'),
  ];

  return board;
}

/* ---------------------- FEN helpers ---------------------- */
function pieceLetter(p){
  switch (p.t){
    case 'K': return 'K';       // King
    case 'Q': return 'Q';       // Neang (Ferz)
    case 'B': return 'B';       // Khon (General)
    case 'R': return 'R';       // Boat
    case 'N': return 'N';       // Horse
    case 'P': return 'P';       // Fish
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
// (castling/en-passant are not used in Ouk Chatrang)
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

  // NEW: expose FEN for AI
  toFEN(){ return toFen(this); }

  inBounds(x,y){ return x>=0 && x<SIZE && y>=0 && y<SIZE; }
  at(x,y){ return this.board[y][x]; }
  set(x,y,v){ this.board[y][x]=v; }
  enemyColor(c){ return c==='w'?'b':'w'; }
  pawnDir(c){ return c==='w' ? -1 : +1; }

  // ---------- Move generators ----------
  // PSEUDO legal (ignores self-check); used by legalMoves + UI hints
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
      // KING: 1-step any + special non-capturing first move (±2, +1 forward)
      case PT.KING: {
        for (const dx of [-1,0,1])
          for (const dy of [-1,0,1])
            if (dx||dy) tryAdd(x+dx,y+dy,'both');

        if (!p.moved){
          const d = this.pawnDir(p.c);
          // forward-left 2 files
          const mx1 = x-1, my1 = y+d;
          const nx1 = x-2, ny1 = y+d;
          if (this.inBounds(nx1,ny1) && !this.at(mx1,my1) && !this.at(nx1,ny1))
            out.push({x:nx1,y:ny1});
          // forward-right 2 files
          const mx2 = x+1, my2 = y+d;
          const nx2 = x+2, ny2 = y+d;
          if (this.inBounds(nx2,ny2) && !this.at(mx2,my2) && !this.at(nx2,ny2))
            out.push({x:nx2,y:ny2});
        }
        break;
      }

      // NEANG (Queen): 1-step diagonals; first move forward 2 non-capturing
      case PT.QUEEN: {
        tryAdd(x-1,y-1,'both'); tryAdd(x+1,y-1,'both');
        tryAdd(x-1,y+1,'both'); tryAdd(x+1,y+1,'both');
        if (!p.moved){
          const d=this.pawnDir(p.c);
          const y1=y+d, y2=y+2*d;
          if (this.inBounds(x,y2) && !this.at(x,y1) && !this.at(x,y2))
            out.push({x,y:y2});
        }
        break;
      }

      // KHUN (Bishop): 1-step diagonals + 1-step forward
      case PT.BISHOP: {
        const d=this.pawnDir(p.c);
        tryAdd(x-1,y-1,'both'); tryAdd(x+1,y-1,'both');
        tryAdd(x-1,y+1,'both'); tryAdd(x+1,y+1,'both');
        tryAdd(x, y+d, 'both');
        break;
      }

      case PT.ROOK:  ray(+1,0); ray(-1,0); ray(0,+1); ray(0,-1); break;

      case PT.KNIGHT: {
        for (const [dx,dy] of [[1,-2],[2,-1],[2,1],[1,2],[-1,2],[-2,1],[-2,-1],[-1,-2]])
          tryAdd(x+dx,y+dy,'both');
        break;
      }

      // FISH (Pawn): 1-step to any forward neighbor (straight or diagonal),
      // capture or non-capture. This matches backend moves like d6c5 into empty c5.
      case PT.PAWN: {
        const d = this.pawnDir(p.c);
        const dirs = [
          { dx:  0, dy: d },  // straight forward
          { dx: -1, dy: d },  // forward-left
          { dx:  1, dy: d },  // forward-right
        ];

        for (const {dx, dy} of dirs) {
          const nx = x + dx;
          const ny = y + dy;
          if (!this.inBounds(nx, ny)) continue;
          const t = this.at(nx, ny);
          // can move into empty or capture enemy, but never own piece
          if (!t || t.c !== p.c) {
            out.push({ x: nx, y: ny });
          }
        }
        break;
      }
    }
    return out;
  }

  // ATTACK map (for check detection). MUST reflect capture patterns, not quiet moves.
  attacksFrom(x,y){
    const p=this.at(x,y); if(!p) return [];
    const A=[];

    const addIfEnemyOrEmpty = (nx,ny,capOnly=false)=>{
      if(!this.inBounds(nx,ny)) return false;
      const t=this.at(nx,ny);
      if (capOnly){
        // For pawns' "threat" squares we record regardless of occupancy
        A.push({x:nx,y:ny});
        return false; // attack square is only that cell; not a ray
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
        addIfEnemyOrEmpty(x-1,y-1); addIfEnemyOrEmpty(x+1,y-1);
        addIfEnemyOrEmpty(x-1,y+1); addIfEnemyOrEmpty(x+1,y+1);
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

      case PT.ROOK:  ray(+1,0); ray(-1,0); ray(0,+1); ray(0,-1); break;

      case PT.KNIGHT:
        for (const [dx,dy] of [[1,-2],[2,-1],[2,1],[1,2],[-1,2],[-2,1],[-2,-1],[-1,-2]])
          addIfEnemyOrEmpty(x+dx,y+dy);
        break;

      // Pawn attacks: treat all three forward neighbors as "attack" squares
      // (straight + diagonal), to be consistent with pseudoMoves and check detection.
      case PT.PAWN: {
        const d = this.pawnDir(p.c);
        addIfEnemyOrEmpty(x,   y + d, /*capOnly*/true);
        addIfEnemyOrEmpty(x-1, y + d, /*capOnly*/true);
        addIfEnemyOrEmpty(x+1, y + d, /*capOnly*/true);
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
    const prevMoved = p.moved, prevType = p.t;
    const captured = this.at(to.x,to.y) || null;

    // move piece
    this.set(to.x,to.y, {...p, moved:true});
    this.set(from.x,from.y, null);

    // promotion: entering last 3 ranks
    let promo=false;
    const now = this.at(to.x,to.y);
    if (now.t===PT.PAWN){
      if (now.c==='w' && to.y<=2){ now.t=PT.QUEEN; promo=true; }
      if (now.c==='b' && to.y>=5){ now.t=PT.QUEEN; promo=true; }
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
