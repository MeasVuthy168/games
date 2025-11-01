// js/ai.js — Khmer Chess AI (authentic rules, tuned for Ouk Chatrang)

import { KhmerGame } from './game.js';

/* Khmer piece values */
const VAL = { P:100, N:350, G:330, R:500, D:200, S:0 };
const SEARCH_DEPTH = { Easy:2, Medium:3, Hard:4 };
const NODE_LIMIT = { Easy:4000, Medium:12000, Hard:30000 };

/* Mapping from Khmer letters */
const TYPE_MAP = { F:'P', H:'N', G:'G', T:'R', D:'D', S:'S' };

function normType(t){ return TYPE_MAP[t]||t; }

function materialEval(game){
  let w=0,b=0;
  for(let y=0;y<8;y++)
    for(let x=0;x<8;x++){
      const p=game.at(x,y); if(!p) continue;
      const v=VAL[normType(p.t)]||0;
      if(p.c==='w') w+=v; else b+=v;
    }
  return w-b;
}

function mobilityEval(game){
  let moves=0;
  for(let y=0;y<8;y++)
    for(let x=0;x<8;x++){
      const p=game.at(x,y); if(!p||p.c!==game.turn) continue;
      moves += game.legalMoves(x,y).length;
    }
  return (game.turn==='w'?1:-1)*Math.min(20,moves);
}

function generateMoves(game){
  const out=[];
  for(let y=0;y<8;y++)
    for(let x=0;x<8;x++){
      const p=game.at(x,y);
      if(!p||p.c!==game.turn) continue;
      const moves=game.legalMoves(x,y);
      for(const m of moves){
        const t=game.at(m.x,m.y);
        out.push({from:{x,y},to:m,capture:t?VAL[normType(t.t)]||0:0});
      }
    }
  out.sort((a,b)=>b.capture-a.capture);
  return out;
}

function evalLeaf(game){
  return materialEval(game) + mobilityEval(game);
}

function make(game,mv){ return game.move(mv.from,mv.to); }
function undo(){}

/* simplified negamax */
function negamax(game,depth,alpha,beta,color,stats){
  if(stats.nodes++>stats.limit) return {score:0,move:null,cutoff:true};
  const st=game.status();
  if(st.state==='checkmate') return {score:color*-10000,move:null};
  if(st.state==='stalemate') return {score:0,move:null};
  if(depth===0) return {score:color*evalLeaf(game),move:null};

  const moves=generateMoves(game);
  if(!moves.length) return {score:color*evalLeaf(game),move:null};

  let best=-Infinity,bestMove=null;
  for(const mv of moves){
    const clone=game.clone();
    const res=make(clone,mv);
    if(!res.ok) continue;
    const child=negamax(clone,depth-1,-beta,-alpha,-color,stats);
    const score=-child.score;
    if(score>best){best=score;bestMove=mv;}
    if(score>alpha) alpha=score;
    if(alpha>=beta) break;
  }
  return {score:best,move:bestMove};
}

/* --------- Public API ---------- */
export async function chooseAIMove(game,opts={}){
  const level=opts.level||'Medium';
  const aiColor=opts.aiColor||game.turn;
  const depth=SEARCH_DEPTH[level];
  const stats={nodes:0,limit:NODE_LIMIT[level]};

  const color=+1;
  const {move}=negamax(game,depth,-Infinity,Infinity,color,stats);
  return move;
}

export function setAIDifficulty(level){
  return {depth:SEARCH_DEPTH[level],nodeLimit:NODE_LIMIT[level]};
}
export const pickAIMove = chooseAIMove;
