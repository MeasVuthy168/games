export const SIZE = 8;
export const COLORS = { WHITE: 'w', BLACK: 'b' };

export const PT = {
  KING: 'K', QUEEN: 'Q', BISHOP: 'B', ROOK: 'R', KNIGHT: 'N', PAWN: 'P',
};

export function initialPosition(){
  const emptyRow = () => Array(SIZE).fill(null);
  const board = Array.from({length: SIZE}, emptyRow);
  // Black back rank
  board[0] = [
    piece(PT.ROOK,'b'), piece(PT.KNIGHT,'b'), piece(PT.BISHOP,'b'), piece(PT.QUEEN,'b'),
    piece(PT.KING,'b'), piece(PT.BISHOP,'b'), piece(PT.KNIGHT,'b'), piece(PT.ROOK,'b'),
  ];
  board[2] = Array(SIZE).fill(piece(PT.PAWN,'b')); // black pawns
  board[5] = Array(SIZE).fill(piece(PT.PAWN,'w')); // white pawns
  // White back rank
  board[7] = [
    piece(PT.ROOK,'w'), piece(PT.KNIGHT,'w'), piece(PT.BISHOP,'w'), piece(PT.QUEEN,'w'),
    piece(PT.KING,'w'), piece(PT.BISHOP,'w'), piece(PT.KNIGHT,'w'), piece(PT.ROOK,'w'),
  ];
  return board;
}
export function piece(t,c){ return {t,c,moved:false}; }

export class Game{
  constructor(){ this.reset(); }
  reset(){ this.board=initialPosition(); this.turn='w'; this.history=[]; this.winner=null; }
  inBounds(x,y){ return x>=0 && x<SIZE && y>=0 && y<SIZE; }
  at(x,y){ return this.board[y][x]; }
  set(x,y,v){ this.board[y][x]=v; }
  enemyColor(c){ return c==='w'?'b':'w'; }
  pawnDir(c){ return c==='w'?-1:+1; }

  legalMoves(x,y){
    const p=this.at(x,y); if(!p) return [];
    const out=[];
    const add=(nx,ny,mode='move')=>{
      if(!this.inBounds(nx,ny)) return false;
      const t=this.at(nx,ny);
      if(!t){ if(mode!=='capture') out.push({x:nx,y:ny}); return true; }
      if(t.c!==p.c && mode!=='move') out.push({x:nx,y:ny});
      return false;
    };
    const ray=(dx,dy)=>{ let nx=x+dx,ny=y+dy; while(this.inBounds(nx,ny)){ const go=add(nx,ny,'both'); if(!go) break; nx+=dx; ny+=dy; } };

    switch(p.t){
      case 'K': for(const dx of[-1,0,1])for(const dy of[-1,0,1]) if(dx||dy) add(x+dx,y+dy,'both'); break;
      case 'Q': for(const dx of[-1,1])for(const dy of[-1,1]) add(x+dx,y+dy,'both'); break; // Khmer queen: 1-step diagonal
      case 'B': { const d=p.c==='w'?-1:+1; add(x-1,y+d,'both'); add(x+1,y+d,'both'); break; }
      case 'R': ray(1,0); ray(-1,0); ray(0,1); ray(0,-1); break;
      case 'N': for(const [dx,dy] of [[1,-2],[2,-1],[2,1],[1,2],[-1,2],[-2,1],[-2,-1],[-1,-2]]) add(x+dx,y+dy,'both'); break;
      case 'P': { const d=this.pawnDir(p.c);
                  if(this.inBounds(x,y+d)&&!this.at(x,y+d)) out.push({x,y:y+d});
                  for(const dx of[-1,1]){ const nx=x+dx, ny=y+d; if(this.inBounds(nx,ny)){ const t=this.at(nx,ny); if(t&&t.c!==p.c) out.push({x:nx,y:ny}); } }
                  break; }
    }
    return out;
  }

  move(from,to){
    const p=this.at(from.x,from.y); if(!p) return {ok:false};
    const ok=this.legalMoves(from.x,from.y).some(m=>m.x===to.x&&m.y===to.y);
    if(!ok) return {ok:false};
    const captured=this.at(to.x,to.y)||null;
    this.set(to.x,to.y,{...p,moved:true}); this.set(from.x,from.y,null);
    let promo=false; const now=this.at(to.x,to.y);
    if(now.t==='P'){ if(now.c==='w'&&to.y<=2){ now.t='Q'; promo=true; } if(now.c==='b'&&to.y>=5){ now.t='Q'; promo=true; } }
    this.history.push({from,to,captured,promo}); this.turn=this.enemyColor(this.turn);
    return {ok:true,promo};
  }

  undo(){
    const last=this.history.pop(); if(!last) return false;
    const p=this.at(last.to.x,last.to.y); if(last.promo && p && p.t==='Q'){ p.t='P'; }
    this.set(last.from.x,last.from.y,{...p,moved:false}); this.set(last.to.x,last.to.y,last.captured);
    this.turn=this.enemyColor(this.turn); return true;
  }
}
