// js/game.js — Khmer Chess Rules Engine (អុកចត្រង្គ)

// Internal board state: 8×8 array of {t:'type', c:'w'|'b'} or null
export class KhmerGame {
  constructor(){
    this.reset();
  }

  reset(){
    this.turn = 'w';
    this.board = this.initBoard();
    this.history = [];
    this.countState = { active:false, side:null, remaining:0 };
  }

  initBoard(){
    // 8×8
    const B = Array.from({length:8}, ()=>Array(8).fill(null));

    // top = black
    B[0] = [
      {t:'T',c:'b'},{t:'H',c:'b'},{t:'G',c:'b'},{t:'D',c:'b'},
      {t:'S',c:'b'},{t:'G',c:'b'},{t:'H',c:'b'},{t:'T',c:'b'}
    ];
    B[1] = Array(8).fill(null).map(()=>({t:'F',c:'b'})); // fish
    // bottom = white
    B[6] = Array(8).fill(null).map(()=>({t:'F',c:'w'}));
    B[7] = [
      {t:'T',c:'w'},{t:'H',c:'w'},{t:'G',c:'w'},{t:'D',c:'w'},
      {t:'S',c:'w'},{t:'G',c:'w'},{t:'H',c:'w'},{t:'T',c:'w'}
    ];
    return B;
  }

  at(x,y){ return this.board[y]?.[x] || null; }

  set(x,y,p){ if(this.board[y]) this.board[y][x] = p; }

  inBounds(x,y){ return x>=0 && x<8 && y>=0 && y<8; }

  clone(){
    const g = new KhmerGame();
    g.turn = this.turn;
    g.board = this.board.map(r => r.map(c => c?{...c}:null));
    g.history = this.history.slice();
    g.countState = JSON.parse(JSON.stringify(this.countState));
    return g;
  }

  legalMoves(x,y){
    const p = this.at(x,y);
    if (!p || p.c !== this.turn) return [];
    const moves=[];
    const add = (tx,ty)=>{
      if (!this.inBounds(tx,ty)) return;
      const t = this.at(tx,ty);
      if (!t) moves.push({x:tx,y:ty});
      else if (t.c!==p.c) moves.push({x:tx,y:ty});
    };

    const dir = p.c==='w' ? -1 : +1;

    switch(p.t){
      case 'F': // Fish (pawn)
        // forward one
        if (this.inBounds(x,y+dir) && !this.at(x,y+dir))
          moves.push({x:x,y:y+dir});
        // capture diagonals
        for (const dx of [-1,1]){
          const tx=x+dx, ty=y+dir;
          if (!this.inBounds(tx,ty)) continue;
          const t=this.at(tx,ty);
          if (t && t.c!==p.c) moves.push({x:tx,y:ty});
        }
        break;

      case 'T': // Boat (Rook)
        this.slideMoves(x,y,moves,[[1,0],[-1,0],[0,1],[0,-1]]);
        break;

      case 'G': // Khon (Bishop)
        this.slideMoves(x,y,moves,[[1,1],[-1,1],[1,-1],[-1,-1]]);
        break;

      case 'H': // Seh (Knight)
        const L=[[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]];
        for (const [dx,dy] of L) add(x+dx,y+dy);
        break;

      case 'D': // Neang (Queen) — one diagonal step
        for (const [dx,dy] of [[1,1],[-1,1],[1,-1],[-1,-1]]){
          const tx=x+dx, ty=y+dy;
          if (this.inBounds(tx,ty)){
            const t=this.at(tx,ty);
            if(!t||t.c!==p.c) moves.push({x:tx,y:ty});
          }
        }
        break;

      case 'S': // Sdach (King)
        for (let dx=-1;dx<=1;dx++)
          for (let dy=-1;dy<=1;dy++){
            if(dx||dy){
              const tx=x+dx, ty=y+dy;
              if(!this.inBounds(tx,ty)) continue;
              const t=this.at(tx,ty);
              if(!t||t.c!==p.c) moves.push({x:tx,y:ty});
            }
          }
        break;
    }

    return moves;
  }

  slideMoves(x,y,out,dirs){
    const p=this.at(x,y);
    for (const [dx,dy] of dirs){
      let nx=x+dx, ny=y+dy;
      while (this.inBounds(nx,ny)){
        const t=this.at(nx,ny);
        if(!t){ out.push({x:nx,y:ny}); }
        else{
          if(t.c!==p.c) out.push({x:nx,y:ny});
          break;
        }
        nx+=dx; ny+=dy;
      }
    }
  }

  move(from,to){
    const p=this.at(from.x,from.y);
    if(!p) return {ok:false};

    const moves=this.legalMoves(from.x,from.y);
    if(!moves.some(m=>m.x===to.x&&m.y===to.y)) return {ok:false};

    const captured=this.at(to.x,to.y);
    this.set(to.x,to.y,p);
    this.set(from.x,from.y,null);

    // promotion (Fish → Neang)
    if(p.t==='F'){
      if((p.c==='w' && to.y===2) || (p.c==='b' && to.y===5)){
        p.t='D'; // promote
      }
    }

    this.history.push({from,to});

    // Counting rule: reset if capture or promotion
    if (captured || (p.t==='D' && (p.promoted!==true))){
      this.countState = { active:true, side:this.turn, remaining:64 };
      p.promoted = true;
    } else if (this.countState.active){
      this.countState.remaining -= 1;
      if (this.countState.remaining <= 0){
        this.countState = { active:false, side:null, remaining:0 };
        return {ok:true, status:{state:'stalemate',reason:'count-draw'}};
      }
    }

    this.turn = (this.turn==='w') ? 'b' : 'w';

    const st = this.status();
    return {ok:true, captured, status:st};
  }

  undo(){
    if(!this.history.length) return;
    const last=this.history.pop();
    const from=last.from, to=last.to;
    const piece=this.at(to.x,to.y);
    const prev=this.clone(); // not used fully, simplified undo
    // you can implement history of captured if needed
  }

  status(){
    const kpos = this.findKings();
    const opp = this.turn;
    const side = (opp==='w'?'b':'w');
    if (!kpos[opp]) return {state:'checkmate',winner:side};
    if (!this.hasMoves()) return {state:'stalemate'};
    return {state:'normal'};
  }

  hasMoves(){
    for(let y=0;y<8;y++)
      for(let x=0;x<8;x++){
        const p=this.at(x,y);
        if(p && p.c===this.turn && this.legalMoves(x,y).length)
          return true;
      }
    return false;
  }

  findKings(){
    const k={w:null,b:null};
    for(let y=0;y<8;y++)
      for(let x=0;x<8;x++){
        const p=this.at(x,y);
        if(p && p.t==='S') k[p.c]={x,y};
      }
    return k;
  }
}
