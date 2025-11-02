// js/ai.js — Remote-first AI with local Master fallback
// Public API:
//   chooseAIMove(game, { aiColor: 'w'|'b' })
//   setAIDifficulty() -> returns Master config
//   pickAIMove alias

/***********************
 * Remote (backend) API
 ***********************/
const BACKEND_BASE =
  (localStorage.getItem('kc_backend_url') || 'https://ouk-ai-backend.onrender.com').replace(/\/+$/,'');

function fenFromGame(game){
  if (typeof game.fen === 'function') return game.fen();
  if (typeof game.toFEN === 'function') return game.toFEN();
  if (typeof game.exportFEN === 'function') return game.exportFEN();
  if (typeof game.getFEN === 'function') return game.getFEN();
  const st = (typeof game.status==='function') ? game.status() : null;
  if (st?.fen) return st.fen;
  throw new Error('FEN not available');
}
function parseUciToMove(uci, game){
  if (!uci || uci.length < 4) return null;
  const fx=uci.charCodeAt(0)-97, fy=8-(uci.charCodeAt(1)-48);
  const tx=uci.charCodeAt(2)-97, ty=8-(uci.charCodeAt(3)-48);
  if (fx|fy|tx|ty & ~7) return null;
  const legals=game.legalMoves(fx,fy)||[];
  for(const m of legals){ if(m.x===tx && m.y===ty) return {from:{x:fx,y:fy}, to:{x:tx,y:ty}}; }
  return null;
}
async function requestRemoteMove(game, { aiColor }){
  // spinner label
  try{ window.__aiShow?.('remote'); }catch{}

  const fen = fenFromGame(game);
  const body = { fen, variant:'makruk', movetime:1200 };

  const controller = new AbortController();
  const to = setTimeout(()=> controller.abort(), 3000);

  try{
    const res = await fetch(`${BACKEND_BASE}/api/ai/move`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(body), signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json().catch(()=> ({}));
    const uci = data?.uci || data?.bestmove || data?.move;
    const mv = parseUciToMove(uci, game);
    if (!mv) throw new Error('no legal move from remote');
    return mv;
  } finally {
    clearTimeout(to);
  }
}

/******************************************
 * Local Master++ Search (same as before)
 ******************************************/
const MASTER = { timeMs:1200, maxDepth:9, nodeCap:400_000 };
const USE_BOOK=true; const BOOK_URL='assets/book-khmer.json'; const TEMP_T=0.00;

const FUT_MARGIN_BASE=120, RAZOR_MARGIN=220, Q_NODE_CAP=40_000, Q_DEPTH_MAX=8, LMR_MIN_DEPTH=3, LMR_BASE_RED=1, NULL_MOVE_MIND=3;
const REP_SHORT_WINDOW=8, REP_SOFT_PENALTY=15, REP_HARD_PENALTY=220;
const COUNT_BURN_PENALTY=6, COUNT_URGENT_NEAR=3;
const VAL={P:100,N:320,B:330,R:500,Q:900,K:10000}, ATTACKER_VAL={P:100,N:320,B:330,R:500,Q:900,K:10000};
const TYPE_MAP={R:'R',N:'N',B:'B',Q:'Q',P:'P',K:'K',T:'R',H:'N',G:'B',D:'Q',F:'P',S:'K'};
function normType(t){ return TYPE_MAP[t]||t; }
const log = (s)=>{ try{ window.__dbglog?.('[AI] '+s); }catch{} };

let _bookPromise=null;
async function loadOpeningBook(){ if(!USE_BOOK) return {}; if(_bookPromise) return _bookPromise;
  _bookPromise = fetch(BOOK_URL).then(r=> r.ok ? r.json() : {}).catch(()=> ({})); return _bookPromise; }
function toAlg(sq){ return String.fromCharCode(97+sq.x)+String(8-sq.y); }
function historyKeyFromGame(game){ if(!Array.isArray(game.history)||!game.history.length) return ''; return game.history.map(m=>toAlg(m.from)+toAlg(m.to)).join(' '); }
function parseBookMove(uci,game){ if(!uci||uci.length<4) return null; const fx=uci.charCodeAt(0)-97, fy=8-(uci.charCodeAt(1)-48); const tx=uci.charCodeAt(2)-97, ty=8-(uci.charCodeAt(3)-48); if(fx|fy|tx|ty & ~7) return null; const legals=game.legalMoves(fx,fy)||[]; for(const m of legals){ if(m.x===tx&&m.y===ty) return {from:{x:fx,y:fy},to:{x:tx,y:ty}} } return null; }

let _seed=0x9e3779b1|0; function rnd32(){ _seed|=0; _seed=(_seed+0x6D2B79F5)|0; let t=Math.imul(_seed^(_seed>>>15),1|_seed); t^=t+Math.imul(t^(t>>>7),61|t); return (t^(t>>>14))>>>0; }
const Z={table:[],side:rnd32()}, Z_PIECES=[]; (function(){ const kinds=['P','N','B','R','Q','K'], cols=['w','b']; cols.forEach(c=>kinds.forEach(k=>Z_PIECES.push(c+k)));
  for(let y=0;y<8;y++){ Z.table[y]=[]; for(let x=0;x<8;x++){ Z.table[y][x]=new Uint32Array(Z_PIECES.length); for(let i=0;i<Z_PIECES.length;i++) Z.table[y][x][i]=rnd32(); } }})();
function pieceIndex(p){ if(!p) return -1; const t=normType(p.t); return Z_PIECES.indexOf(p.c+t); }
function zobrist(game){ let h=0>>>0; for(let y=0;y<8;y++) for(let x=0;x<8;x++){ const p=game.at(x,y); const idx=pieceIndex(p); if(idx>=0) h^=Z.table[y][x][idx]; } if(game.turn==='w') h^=Z.side; return h>>>0; }
class RepTracker{ constructor(){ this.list=[] } push(k){ this.list.push(k); if(this.list.length>200) this.list.shift(); } pop(){ this.list.pop() } softCount(k){ let n=0,s=Math.max(0,this.list.length-REP_SHORT_WINDOW); for(let i=s;i<this.list.length;i++) if(this.list[i]===k) n++; return n } wouldThreefold(k){ return (this.list.filter(x=>x===k).length+1)>=3 } }
function repetitionPenalty(rep,key){ let p=0,soft=rep.softCount(key); if(soft>0)p-=REP_SOFT_PENALTY*soft; if(rep.wouldThreefold(key
