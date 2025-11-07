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

// This FEN is the standard Makruk start Fairy-Stockfish uses.
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
  // 🔄 FIX 1: reverse rows so engine↔UI orientation matches
  const rows = boardPart.split('/').reverse();
  if (rows.length !== 8) throw new Error('Invalid FEN rows for Makruk');

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
    if (x !== 8) throw new Error('Invalid FEN row length for Makruk');
  }
  return board;
}

function pieceLetter(p) {
  switch (p.t) {
    case PT.KING:   return 'K';
    case PT.QUEEN:  return 'Q';
    case PT.BISHOP: return 'B';
    case PT.ROOK:   return 'R';
    case PT.KNIGHT: return 'N';
    case PT.PAWN:   return 'P';
    default:        return 'P';
  }
}

// Convert current position to a Fairy-Stockfish compatible FEN.
export function toFen(game) {
  const rows = [];
  for (let y = 0; y < 8; y++) {
    let row = '';
    let empties = 0;
    for (let x = 0; x < 8; x++) {
      const p = game.at(x, y);
      if (!p) { empties++; continue; }
      if (empties) { row += String(empties); empties = 0; }
      const letter = pieceLetter(p);
      row += (p.c === COLORS.WHITE) ? letter : letter.toLowerCase();
    }
    if (empties) row += String(empties);
    rows.push(row);
  }
  // 🔄 FIX 2: reverse rows before join (mirror back for engine)
  const boardPart = rows.reverse().join('/');
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

  toFEN() { return toFen(this); }

  inBounds(x, y) { return x >= 0 && x < SIZE && y >= 0 && y < SIZE; }
  at(x, y)       { return this.board[y][x]; }
  set(x, y, v)   { this.board[y][x] = v; }
  enemyColor(c)  { return c === COLORS.WHITE ? COLORS.BLACK : COLORS.WHITE; }
  pawnDir(c)     { return c === COLORS.WHITE ? -1 : +1; }

  // ---------- Move generators ----------
  pseudoMoves(x, y) {
    const p = this.at(x, y);
    if (!p) return [];
    const out = [];

    const tryAdd = (nx, ny, mode = 'both') => {
      if (!this.inBounds(nx, ny)) return false;
      const t = this.at(nx, ny);
      if (!t) {
        if (mode !== 'capture') out.push({ x: nx, y: ny });
        return true;
      } else if (t.c !== p.c) {
        if (mode !== 'move') out.push({ x: nx, y: ny });
      }
      return false;
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
      case PT.KING:
        for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1])
          if (dx || dy) tryAdd(x + dx, y + dy);
        break;

      case PT.QUEEN: // Met
        for (const dx of [-1, 1]) for (const dy of [-1, 1])
          tryAdd(x + dx, y + dy);
        break;

      case PT.BISHOP: { // Khon
        const d = this.pawnDir(p.c);
        for (const dx of [-1, 1]) for (const dy of [-1, 1])
          tryAdd(x + dx, y + dy);
        tryAdd(x, y + d);
        break;
      }

      case PT.ROOK:
        ray(+1, 0); ray(-1, 0); ray(0, +1); ray(0, -1);
        break;

      case PT.KNIGHT:
        const jumps = [[1,-2],[2,-1],[2,1],[1,2],[-1,2],[-2,1],[-2,-1],[-1,-2]];
        for (const [dx, dy] of jumps) tryAdd(x + dx, y + dy);
        break;

      case PT.PAWN: {
        const d = this.pawnDir(p.c);
        if (this.inBounds(x, y + d) && !this.at(x, y + d))
          out.push({ x, y: y + d });
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

    const addStep = (nx, ny) => { if (this.inBounds(nx, ny)) A.push({ x: nx, y: ny }); };

    switch (p.t) {
      case PT.KING:
        for (const dx of [-1,0,1]) for (const dy of [-1,0,1])
          if (dx || dy) addStep(x + dx, y + dy);
        break;

      case PT.QUEEN:
        addStep(x-1,y-1); addStep(x+1,y-1); addStep(x-1,y+1); addStep(x+1,y+1);
        break;

      case PT.BISHOP: {
        const d = this.pawnDir(p.c);
        addStep(x-1,y-1); addStep(x+1,y-1);
        addStep(x-1,y+1); addStep(x+1,y+1);
        addStep(x, y + d);
        break;
      }

      case PT.ROOK:
        addRay(+1,0); addRay(-1,0); addRay(0,+1); addRay(0,-1);
        break;

      case PT.KNIGHT:
        const jumps = [[1,-2],[2,-1],[2,1],[1,2],[-1,2],[-2,1],[-2,-1],[-1,-2]];
        for (const [dx,dy] of jumps) addStep(x+dx,y+dy);
        break;

      case PT.PAWN:
        const d = this.pawnDir(p.c);
        addStep(x-1,y+d); addStep(x+1,y+d);
        break;
    }
    return A;
  }

  // ---------- Checks, moves, etc ----------
  findKing(color){for(let y=0;y<8;y++)for(let x=0;x<8;x++){const p=this.at(x,y);if(p&&p.c===color&&p.t===PT.KING)return{x,y}}return null;}
  squareAttacked(x,y,by){for(let j=0;j<8;j++)for(let i=0;i<8;i++){const p=this.at(i,j);if(!p||p.c!==by)continue;const a=this.attacksFrom(i,j);if(a.some(m=>m.x===x&&m.y===y))return true}return false}
  inCheck(c){const k=this.findKing(c);if(!k)return false;return this.squareAttacked(k.x,k.y,this.enemyColor(c));}

  _do(from,to){
    const p=this.at(from.x,from.y);
    const prevMoved=p.moved, prevType=p.t;
    const captured=this.at(to.x,to.y)||null;
    this.set(to.x,to.y,{...p,moved:true});
    this.set(from.x,from.y,null);

    const now=this.at(to.x,to.y);
    let promo=false;
    if(now.t===PT.PAWN){
      if(now.c===COLORS.WHITE&&to.y<=2){now.t=PT.QUEEN;promo=true;}
      if(now.c===COLORS.BLACK&&to.y>=5){now.t=PT.QUEEN;promo=true;}
    }
    return{captured,promo,prevMoved,prevType};
  }

  _undo(from,to,s){const p=this.at(to.x,to.y);if(s.promo)p.t=s.prevType;this.set(from.x,from.y,{...p,moved:s.prevMoved});this.set(to.x,to.y,s.captured);}

  legalMoves(x,y){
    const p=this.at(x,y);if(!p)return[];
    const raw=this.pseudoMoves(x,y);const keep=[];
    for(const mv of raw){
      const snap=this._do({x,y},mv);
      const ok=!this.inCheck(p.c);
      this._undo({x,y},mv,snap);
      if(ok)keep.push(mv);
    }return keep;
  }

  hasAnyLegalMove(c){for(let y=0;y<8;y++)for(let x=0;x<8;x++){const p=this.at(x,y);if(p&&p.c===c&&this.legalMoves(x,y).length)return true}return false;}
  status(){const to=this.turn,chk=this.inCheck(to),any=this.hasAnyLegalMove(to);if(any)return{state:chk?'check':'ongoing',inCheck:chk,toMove:to};return{state:chk?'checkmate':'stalemate',inCheck:chk,toMove:to};}

  move(from,to){
    const p=this.at(from.x,from.y);
    if(!p)return{ok:false};
    const isLegal=this.legalMoves(from.x,from.y).some(m=>m.x===to.x&&m.y===to.y);
    if(!isLegal)return{ok:false};
    const snap=this._do(from,to);
    const{captured,promo}=snap;
    this.history.push({...snap,from,to});
    this.turn=this.enemyColor(this.turn);
    const st=this.status();
    if(st.state==='checkmate')this.winner=this.enemyColor(st.toMove);
    else if(st.state==='stalemate')this.winner='draw';
    else this.winner=null;
    return{ok:true,promo,captured,status:st};
  }

  undo(){
    const last=this.history.pop();
    if(!last)return false;
    this.turn=this.enemyColor(this.turn);
    this._undo(last.from,last.to,last);
    this.winner=null;
    return true;
  }
}
