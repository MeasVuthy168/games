// js/game.js
export const SIZE = 8;

export const COLORS = { WHITE: 'w', BLACK: 'b' };

// --- Piece type codes (custom) ---
export const PT = {
  KING: 'K',     // ក
  QUEEN: 'Q',    // នា (1-step diagonal)
  BISHOP: 'B',   // ញ (1-step diagonal forward)
  ROOK: 'R',     // រ (straight)
  KNIGHT: 'N',   // ម (L)
  PAWN: 'P',     // ត (promotes to Q on 6th rank)
};

// Khmer labels (placeholders)
export const LABEL = {
  [PT.KING]: 'ក',
  [PT.QUEEN]: 'នា',
  [PT.BISHOP]: 'ញ',
  [PT.ROOK]: 'រ',
  [PT.KNIGHT]: 'ម',
  [PT.PAWN]: 'ត',
};

// Starting position (bottom = White)
// Pawns on rank 3 (index 5 for white from top), like Makruk/Khmer
// Back rank pieces in familiar order: R N B Q K B N R
export function initialPosition(){
  // board[y][x] cells; y=0 top
  const emptyRow = () => Array(SIZE).fill(null);
  const board = Array.from({length: SIZE}, emptyRow);

  // Black back rank (top)
  board[0] = [
    piece(PT.ROOK, COLORS.BLACK),
    piece(PT.KNIGHT, COLORS.BLACK),
    piece(PT.BISHOP, COLORS.BLACK),
    piece(PT.QUEEN, COLORS.BLACK),
    piece(PT.KING, COLORS.BLACK),
    piece(PT.BISHOP, COLORS.BLACK),
    piece(PT.KNIGHT, COLORS.BLACK),
    piece(PT.ROOK, COLORS.BLACK),
  ];
  // Black pawns on rank 2 from top? In Khmer: pawns start on 3rd rank from your side,
  // so from black perspective it's y=2; from white it's y=5.
  board[2] = Array(SIZE).fill(piece(PT.PAWN, COLORS.BLACK));

  // White pawns
  board[5] = Array(SIZE).fill(piece(PT.PAWN, COLORS.WHITE));

  // White back rank (bottom)
  board[7] = [
    piece(PT.ROOK, COLORS.WHITE),
    piece(PT.KNIGHT, COLORS.WHITE),
    piece(PT.BISHOP, COLORS.WHITE),
    piece(PT.QUEEN, COLORS.WHITE),
    piece(PT.KING, COLORS.WHITE),
    piece(PT.BISHOP, COLORS.WHITE),
    piece(PT.KNIGHT, COLORS.WHITE),
    piece(PT.ROOK, COLORS.WHITE),
  ];

  return board;
}

export function piece(type, color){
  return { t:type, c:color, moved:false };
}

export class Game {
  constructor(){
    this.reset();
  }
  reset(){
    this.board = initialPosition();
    this.turn = COLORS.WHITE;
    this.history = [];       // {from:{x,y}, to:{x,y}, captured, promo}
    this.winner = null;      // 'w' | 'b' | 'draw' | null
  }
  inBounds(x,y){ return x>=0 && x< SIZE && y>=0 && y< SIZE; }
  at(x,y){ return this.board[y][x]; }
  set(x,y,v){ this.board[y][x]=v; }

  enemyColor(color){ return color===COLORS.WHITE? COLORS.BLACK : COLORS.WHITE; }

  // Direction helpers (white moves up y-1? In our board, y=7 bottom; white pawns go 'up' = y-1)
  pawnDir(color){ return color===COLORS.WHITE ? -1 : +1; }

  // Legal move generator per piece
  legalMoves(x,y){
    const p = this.at(x,y);
    if(!p) return [];
    const out = [];
    const color = p.c;

    const add = (nx,ny, mode='move')=>{
      const target = this.inBounds(nx,ny) ? this.at(nx,ny) : null;
      if(!this.inBounds(nx,ny)) return false;
      if(!target){
        if(mode!=='capture') out.push({x:nx,y:ny});
        return true;
      }else{
        if(target.c!==color && mode!=='move'){
          out.push({x:nx,y:ny});
        }
        return false;
      }
    };

    const ray = (dx,dy)=>{
      let nx=x+dx, ny=y+dy;
      while(this.inBounds(nx,ny)){
        const canContinue = add(nx,ny,'both'); // allow capture or move until blocked
        if(!canContinue) break;
        nx+=dx; ny+=dy;
      }
    };

    switch(p.t){
      case PT.KING: {
        for(const dx of [-1,0,1]){
          for(const dy of [-1,0,1]){
            if(dx||dy) add(x+dx,y+dy,'both');
          }
        }
        break;
      }
      case PT.QUEEN: {
        // Khmer Queen (Neang/Met): 1-step diagonal only
        for(const dx of [-1,1]){
          for(const dy of [-1,1]){
            add(x+dx,y+dy,'both');
          }
        }
        break;
      }
      case PT.BISHOP: {
        // Khmer Bishop (Khon-like): 1-step diagonal FORWARD only
        const dir = (p.c===COLORS.WHITE)? -1 : +1;
        add(x-1, y+dir, 'both');
        add(x+1, y+dir, 'both');
        break;
      }
      case PT.ROOK: {
        // Straight lines
        ray(1,0); ray(-1,0); ray(0,1); ray(0,-1);
        break;
      }
      case PT.KNIGHT: {
        const K = [[+1,-2],[+2,-1],[+2,+1],[+1,+2],[-1,+2],[-2,+1],[-2,-1],[-1,-2]];
        for(const [dx,dy] of K) add(x+dx,y+dy,'both');
        break;
      }
      case PT.PAWN: {
        // 1 step forward; capture 1 step diagonally forward
        const dir = this.pawnDir(p.c);
        // forward
        if(this.inBounds(x,y+dir) && !this.at(x,y+dir)) out.push({x:x, y:y+dir});
        // captures
        for(const dx of [-1,1]){
          const nx=x+dx, ny=y+dir;
          if(!this.inBounds(nx,ny)) continue;
          const t = this.at(nx,ny);
          if(t && t.c!==p.c) out.push({x:nx,y:ny});
        }
        break;
      }
    }
    return out;
  }

  // Move; returns {ok, promo:boolean}
  move(from,to){
    const p = this.at(from.x,from.y);
    if(!p) return {ok:false};
    const moves = this.legalMoves(from.x,from.y);
    const ok = moves.some(m=> m.x===to.x && m.y===to.y);
    if(!ok) return {ok:false};

    const captured = this.at(to.x,to.y) || null;
    // place
    this.set(to.x,to.y, {...p, moved:true});
    this.set(from.x,from.y,null);

    // Promotion: when pawn reaches 6th rank from start side (Khmer rule),
    // on our 0..7 grid:
    // - White starts y=5; reaching y=2 or y<=2 -> promote.
    // - Black starts y=2; reaching y=5 or y>=5 -> promote.
    let promo=false;
    const now = this.at(to.x,to.y);
    if(now.t===PT.PAWN){
      if(now.c===COLORS.WHITE && to.y<=2){ now.t=PT.QUEEN; promo=true; }
      if(now.c===COLORS.BLACK && to.y>=5){ now.t=PT.QUEEN; promo=true; }
    }

    this.history.push({from,to,captured, promo});
    this.turn = this.enemyColor(this.turn);
    return {ok:true, promo};
  }

  undo(){
    const last = this.history.pop();
    if(!last) return false;
    const p = this.at(last.to.x,last.to.y);
    // revert promotion
    if(last.promo && p && p.t===PT.QUEEN){
      p.t = PT.PAWN;
    }
    this.set(last.from.x,last.from.y, {...p, moved:false});
    this.set(last.to.x,last.to.y, last.captured);
    this.turn = this.enemyColor(this.turn);
    return true;
  }
}
