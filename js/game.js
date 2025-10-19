export const SIZE = 8;
export const COLORS = { WHITE: 'w', BLACK: 'b' };

export const PT = {
  KING: 'K', QUEEN: 'Q', BISHOP: 'B', ROOK: 'R', KNIGHT: 'N', PAWN: 'P',
};

export function initialPosition(){
  const emptyRow = () => Array(SIZE).fill(null);
  const board = Array.from({length: SIZE}, emptyRow);
  // Black back rank (top)
  board[0] = [
    piece(PT.ROOK,'b'), piece(PT.KNIGHT,'b'), piece(PT.BISHOP,'b'), piece(PT.QUEEN,'b'),
    piece(PT.KING,'b'), piece(PT.BISHOP,'b'), piece(PT.KNIGHT,'b'), piece(PT.ROOK,'b'),
  ];
  board[2] = Array(SIZE).fill(piece(PT.PAWN,'b')); // black pawns
  // White pawns & back rank (bottom)
  board[5] = Array(SIZE).fill(piece(PT.PAWN,'w'));
  board[7] = [
    piece(PT.ROOK,'w'), piece(PT.KNIGHT,'w'), piece(PT.BISHOP,'w'), piece(PT.QUEEN,'w'),
    piece(PT.KING,'w'), piece(PT.BISHOP,'w'), piece(PT.KNIGHT,'w'), piece(PT.ROOK,'w'),
  ];
  return board;
}
export function piece(t,c){ return {t,c,moved:false}; }

export class Game{
  constructor(){ this.reset(); }

  reset(){
    this.board=initialPosition();
    this.turn='w';
    this.history=[];   // {from,to,captured,promo}
    this.winner=null;  // 'w'|'b'|'draw'|null
  }

  inBounds(x,y){ return x>=0 && x<SIZE && y>=0 && y<SIZE; }
  at(x,y){ return this.board[y][x]; }
  set(x,y,v){ this.board[y][x]=v; }
  enemyColor(c){ return c==='w'?'b':'w'; }
  pawnDir(c){ return c==='w'?-1:+1; }

  /* -------- low-level (no self-check filtering) -------- */
  pseudoMoves(x,y){
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
      case PT.KING: for(const dx of[-1,0,1])for(const dy of[-1,0,1]) if(dx||dy) add(x+dx,y+dy,'both'); break;
      case PT.QUEEN: for(const dx of[-1,1])for(const dy of[-1,1]) add(x+dx,y+dy,'both'); break; // Khmer queen: 1-step diagonal
      case PT.BISHOP: { const d=p.c==='w'?-1:+1; add(x-1,y+d,'both'); add(x+1,y+d,'both'); break; }
      case PT.ROOK: ray(1,0); ray(-1,0); ray(0,1); ray(0,-1); break;
      case PT.KNIGHT: for(const [dx,dy] of [[1,-2],[2,-1],[2,1],[1,2],[-1,2],[-2,1],[-2,-1],[-1,-2]]) add(x+dx,y+dy,'both'); break;
      case PT.PAWN: {
        const d=this.pawnDir(p.c);
        if(this.inBounds(x,y+d)&&!this.at(x,y+d)) out.push({x,y:y+d});
        for(const dx of[-1,1]){ const nx=x+dx, ny=y+d; if(this.inBounds(nx,ny)){ const t=this.at(nx,ny); if(t&&t.c!==p.c) out.push({x:nx,y:ny}); } }
        break;
      }
    }
    return out;
  }

  findKing(color){
    for(let y=0;y<SIZE;y++) for(let x=0;x<SIZE;x++){
      const p=this.at(x,y); if(p && p.c===color && p.t===PT.KING) return {x,y};
    }
    return null;
  }

  squareAttacked(x,y,byColor){
    // if any piece of byColor has a pseudo move to (x,y)
    for(let j=0;j<SIZE;j++) for(let i=0;i<SIZE;i++){
      const p=this.at(i,j);
      if(!p || p.c!==byColor) continue;
      const moves=this.pseudoMoves(i,j);
      if(moves.some(m=>m.x===x && m.y===y)) return true;
    }
    return false;
  }

  inCheck(color){
    const k=this.findKing(color);
    if(!k) return false;
    return this.squareAttacked(k.x,k.y,this.enemyColor(color));
  }

  /* simulate move then revert (for self-check filtering) */
  _do(from,to){
    const p=this.at(from.x,from.y);
    const captured=this.at(to.x,to.y) || null;
    this.set(to.x,to.y,{...p,moved:true});
    this.set(from.x,from.y,null);
    // promotion rule (Khmer pawn -> queen on far zone)
    let promo=false;
    const now=this.at(to.x,to.y);
    if(now.t===PT.PAWN){
      if(now.c==='w' && to.y<=2){ now.t=PT.QUEEN; promo=true; }
      if(now.c==='b' && to.y>=5){ now.t=PT.QUEEN; promo=true; }
    }
    return {captured,promo,prev:{from,to,pType:p.t}};
  }
  _undo(from,to,snap){
    const p=this.at(to.x,to.y);
    if(snap.promo) p.t = snap.prev.pType;  // revert promotion
    this.set(from.x,from.y,{...p,moved:false});
    this.set(to.x,to.y,snap.captured);
  }

  legalMoves(x,y){
    const p=this.at(x,y); if(!p) return [];
    // filter out moves that leave own king in check
    const raw=this.pseudoMoves(x,y);
    const keep=[];
    for(const mv of raw){
      const snap=this._do({x,y}, mv);
      const ok = !this.inCheck(p.c);
      this._undo({x,y}, mv, snap);
      if(ok) keep.push(mv);
    }
    return keep;
  }

  hasAnyLegalMove(color){
    for(let y=0;y<SIZE;y++) for(let x=0;x<SIZE;x++){
      const p=this.at(x,y); if(!p || p.c!==color) continue;
      if(this.legalMoves(x,y).length) return true;
    }
    return false;
  }

  status(){
    // returns {state:'ongoing'|'check'|'checkmate'|'stalemate', inCheck:boolean, toMove:'w'|'b'}
    const toMove=this.turn;
    const check=this.inCheck(toMove);
    const any=this.hasAnyLegalMove(toMove);
    if(any){
      return {state: check?'check':'ongoing', inCheck:check, toMove};
    }else{
      if(check) return {state:'checkmate', inCheck:true, toMove};
      return {state:'stalemate', inCheck:false, toMove};
    }
  }

  move(from,to){
    const p=this.at(from.x,from.y); if(!p) return {ok:false};
    const ok=this.legalMoves(from.x,from.y).some(m=>m.x===to.x&&m.y===to.y);
    if(!ok) return {ok:false};

    const snap=this._do(from,to);
    const captured=snap.captured;
    const promo=snap.promo;

    this.history.push({from,to,captured,promo});
    this.turn = this.enemyColor(this.turn);

    // compute terminal state
    const st=this.status();
    if(st.state==='checkmate'){ this.winner=this.enemyColor(st.toMove); }
    else if(st.state==='stalemate'){ this.winner='draw'; }

    return {ok:true,promo,captured, status:st};
  }

  undo(){
    const last=this.history.pop(); if(!last) return false;
    this.turn = this.enemyColor(this.turn);
    this._undo(last.from,last.to,{captured:last.captured,promo:last.promo,prev:{pType:this.at(last.to.x,last.to.y)?.t}});
    this.winner=null;
    return true;
  }
}
