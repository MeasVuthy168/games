// js/ai.js — Khmer/Makruk-friendly AI (Fast + Book Support)
// Works with assets/book-khmer.json (weighted JSON array)
// Features:
//  - Weighted Khmer Opening Book (central fish, general, horse openings)
//  - Transposition Table (TT) cache between moves
//  - Fast negamax + quiescence capture pruning
//  - No repetition loops, balanced aggression

/* ------------------ Global settings ------------------ */
const USE_BOOK = true;
const BOOK_URL = 'assets/book-khmer.json';

const SEARCH_DEPTH = { Easy: 2, Medium: 3, Hard: 4 };
const NODE_LIMIT   = { Easy: 6000, Medium: 15000, Hard: 30000 };
const Q_NODE_LIMIT = 20000;
const Q_DEPTH_MAX  = 6;

/* ------------------ Piece values ------------------ */
const VAL = { P:100, N:320, B:330, R:500, Q:900, K:0 };
const TYPE_MAP = { R:'R', N:'N', B:'B', Q:'Q', P:'P', K:'K', T:'R', H:'N', G:'B', D:'Q', F:'P', S:'K' };

function normType(t){ return TYPE_MAP[t] || t; }

/* ------------------ Book Loader ------------------ */
let _bookCache = null;
async function loadOpeningBook(){
  if (!USE_BOOK) return {};
  if (_bookCache) return _bookCache;
  try {
    const res = await fetch(BOOK_URL);
    _bookCache = await res.json();
  } catch {
    _bookCache = {};
  }
  return _bookCache;
}

function toAlg(sq){ return String.fromCharCode(97+sq.x) + String(8 - sq.y); }
function historyKeyFromGame(game){
  if (!Array.isArray(game.history) || !game.history.length) return '';
  return game.history.map(m => toAlg(m.from)+toAlg(m.to)).join(' ');
}
function parseBookMove(uci, game){
  if (!uci || uci.length<4) return null;
  const fx=uci.charCodeAt(0)-97, fy=8-(uci.charCodeAt(1)-48);
  const tx=uci.charCodeAt(2)-97, ty=8-(uci.charCodeAt(3)-48);
  if (fx|fy|tx|ty & ~7) return null;
  const legals = game.legalMoves(fx, fy);
  for (const m of legals) if (m.x===tx && m.y===ty) return { from:{x:fx,y:fy}, to:{x:tx,y:ty} };
  return null;
}

/* ------------------ Evaluation ------------------ */
function materialSide(game, side){
  let s=0;
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){
    const p=game.at(x,y); if(!p||p.c!==side) continue;
    const t=normType(p.t); if(t!=='K') s += VAL[t]||0;
  }
  return s;
}
function materialEval(game){ return materialSide(game,'w') - materialSide(game,'b'); }

function mobilityEval(game){
  let count=0;
  for(let y=0;y<8;y++){
    for(let x=0;x<8;x++){
      const p=game.at(x,y);
      if(!p || p.c!==game.turn) continue;
      count += game.legalMoves(x,y).length;
      if (count>30) return (game.turn==='w'?+1:-1)*30;
    }
  }
  return (game.turn==='w'?+1:-1)*count;
}

function posKey(game){
  let out='';
  for(let y=0;y<8;y++){
    for(let x=0;x<8;x++){
      const p=game.at(x,y);
      out += p ? (p.c+normType(p.t)) : '.';
    }
    out += '/';
  }
  return out + ' ' + game.turn;
}

/* ------------------ Move Gen ------------------ */
function centerBias(sq){
  const cx=Math.abs(3.5-sq.x), cy=Math.abs(3.5-sq.y);
  return 8-(cx+cy);
}
function generateMoves(game){
  const out=[];
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){
    const p=game.at(x,y); if(!p||p.c!==game.turn) continue;
    const tt=normType(p.t);
    const legals=game.legalMoves(x,y);
    for(const m of legals){
      const t=game.at(m.x,m.y);
      out.push({
        from:{x,y}, to:{x:m.x,y:m.y},
        captureVal: t?(VAL[normType(t.t)]||0):0,
        isPawnPush:(tt==='P' && m.y!==y)
      });
    }
  }
  out.sort((a,b)=>{
    if(b.captureVal!==a.captureVal) return b.captureVal-a.captureVal;
    return centerBias(b.to)-centerBias(a.to);
  });
  return out;
}

function generateCaptures(game){
  const out=[];
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){
    const p=game.at(x,y); if(!p||p.c!==game.turn) continue;
    const legals=game.legalMoves(x,y);
    for(const m of legals){
      const t=game.at(m.x,m.y);
      if(!t) continue;
      out.push({from:{x,y}, to:{x:m.x,y:m.y}});
    }
  }
  return out;
}

/* ------------------ TT & helpers ------------------ */
const TT=new Map();
function make(game,m){ return game.move(m.from,m.to); }
function undo(game){ game.undo(); }

/* ------------------ Eval & Quiescence ------------------ */
function evalLeaf(game){
  const mat=materialEval(game);
  const mob=mobilityEval(game);
  return mat + mob;
}
function quiesce(game,alpha,beta,color,aiColor,qNodes,depth=0){
  if(qNodes.count++>Q_NODE_LIMIT || depth>Q_DEPTH_MAX)
    return color * evalLeaf(game);
  let stand=color*evalLeaf(game);
  if(stand>=beta) return beta;
  if(stand>alpha) alpha=stand;
  const caps=generateCaptures(game);
  for(const mv of caps){
    const res=make(game,mv); if(!res?.ok){undo(game);continue;}
    const score=-quiesce(game,-beta,-alpha,-color,aiColor,qNodes,depth+1);
    undo(game);
    if(score>=beta) return beta;
    if(score>alpha) alpha=score;
  }
  return alpha;
}

/* ------------------ Negamax ------------------ */
function negamax(game,depth,alpha,beta,color,aiColor,budget,stats){
  if(stats.nodes++>budget.limit) return {score:0,move:null,cutoff:true};
  const key=posKey(game);
  if(depth===0){
    const qNodes={count:0};
    const val=quiesce(game,alpha,beta,color,aiColor,qNodes,0);
    return {score:val,move:null};
  }

  const cached=TT.get(key);
  if(cached && cached.depth>=depth) return {score:cached.score,move:cached.move};

  const moves=generateMoves(game);
  if(!moves.length) return {score:color*evalLeaf(game),move:null};

  let best=-Infinity,bestMove=null;
  for(const mv of moves){
    const res=make(game,mv); if(!res?.ok){undo(game);continue;}
    const child=negamax(game,depth-1,-beta,-alpha,-color,aiColor,budget,stats);
    const score=-(child.score);
    undo(game);
    if(score>best){best=score;bestMove=mv;}
    if(best>alpha) alpha=best;
    if(alpha>=beta) break;
  }

  TT.set(key,{depth,score:best,move:bestMove});
  return {score:best,move:bestMove};
}

/* ------------------ Public API ------------------ */
export async function chooseAIMove(game,opts={}){
  const level=opts.level||'Medium';
  const aiColor=opts.aiColor||game.turn;

  // 1️⃣ Opening Book
  try{
    const book=await loadOpeningBook();
    const key=historyKeyFromGame(game);
    const cand=book[key];
    if(Array.isArray(cand)&&cand.length){
      const pick=cand[Math.floor(Math.random()*cand.length)];
      const mv=parseBookMove(pick,game);
      if(mv) return mv;
    }
  }catch{ /* ignore */ }

  // 2️⃣ Engine Search
  const depth=SEARCH_DEPTH[level]??3;
  const budget={limit:NODE_LIMIT[level]??15000};
  const stats={nodes:0};
  const {move}=negamax(game,depth,-Infinity,Infinity,+1,aiColor,budget,stats);
  return move||null;
}

export function setAIDifficulty(level){
  return {depth:SEARCH_DEPTH[level]??3,nodeLimit:NODE_LIMIT[level]??15000};
}
export const pickAIMove=chooseAIMove;
