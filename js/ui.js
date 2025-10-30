// ui.js — Khmer Chess (Play page)
import { Game, SIZE, COLORS } from './game.js';

const LS_KEY   = 'kc_settings_v1';
const SAVE_KEY = 'kc_game_state_v2';
const DEFAULTS = { minutes: 10, increment: 5, sound: true, hints: true };

/* ------------------------------ storage ------------------------------ */
function saveGameState(game, clocks){
  const s = {
    board: game.board,
    turn: game.turn,
    history: game.history,
    msW: clocks.msW,
    msB: clocks.msB,
    clockTurn: clocks.turn
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch {}
}
function loadGameState(){
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; }
}
function clearGameState(){ try { localStorage.removeItem(SAVE_KEY); } catch {} }

function loadSettings(){
  try{
    const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    return s ? { ...DEFAULTS, ...s } : { ...DEFAULTS };
  }catch{
    return { ...DEFAULTS };
  }
}

/* ------------------------------ audio ------------------------------ */
class AudioBeeper{
  constructor(){
    this.enabled = true;
    this.bank = {
      move:    new Audio('assets/sfx/move.mp3'),
      capture: new Audio('assets/sfx/capture.mp3'),
      select:  new Audio('assets/sfx/select.mp3'),
      error:   new Audio('assets/sfx/error.mp3'),
      check:   new Audio('assets/sfx/check.mp3'),
      countStart: new Audio('assets/sfx/count-start.mp3'),
      countEnd:   new Audio('assets/sfx/count-end.mp3'),
    };
    for (const k in this.bank) this.bank[k].preload = 'auto';
  }
  play(name, vol=1){
    if(!this.enabled) return;
    const src = this.bank[name]; if(!src) return;
    const a = src.cloneNode(true);
    a.volume = Math.max(0, Math.min(1, vol));
    a.play().catch(()=>{});
  }
  move(){this.play('move', .9);} capture(){this.play('capture', 1);}
  select(){this.play('select', .85);} error(){this.play('error', .9);}
  check(){this.play('check', 1);}
  countStart(){this.play('countStart', 1);}
  countEnd(){this.play('countEnd', 1);}
}
const beeper = new AudioBeeper();
function vibrate(x){ if (navigator.vibrate) navigator.vibrate(x); }

/* ------------------------------ clocks ------------------------------ */
class Clocks{
  constructor(update){
    this.msW=0; this.msB=0; this.running=false; this.turn=COLORS.WHITE;
    this.increment=0; this._t=null; this._u=update;
  }
  init(min, inc, turn=COLORS.WHITE){
    this.msW=min*60*1000; this.msB=min*60*1000; this.increment=inc*1000; this.turn=turn;
    this.stop(); this._u(this.msW,this.msB);
  }
  start(){
    if(this.running) return; this.running=true; let last=performance.now();
    const tick=()=>{
      if(!this.running) return;
      const now=performance.now(), dt=now-last; last=now;
      if(this.turn===COLORS.WHITE) this.msW=Math.max(0,this.msW-dt); else this.msB=Math.max(0,this.msB-dt);
      this._u(this.msW,this.msB);
      if(this.msW<=0||this.msB<=0){ this.stop(); return; }
      this._t=requestAnimationFrame(tick);
    };
    this._t=requestAnimationFrame(tick);
  }
  stop(){ this.running=false; if(this._t) cancelAnimationFrame(this._t); this._t=null; }
  pauseResume(){ this.running?this.stop():this.start(); }
  switchedByMove(prev){
    if(prev===COLORS.WHITE) this.msW+=this.increment; else this.msB+=this.increment;
    this.turn=(prev===COLORS.WHITE)?COLORS.BLACK:COLORS.WHITE;
    this._u(this.msW,this.msB); this.start();
  }
  format(ms){
    const m=Math.floor(ms/60000), s=Math.floor((ms%60000)/1000), t=Math.floor((ms%1000)/100);
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${t}`;
  }
}

/* ------------------------------ UI init ------------------------------ */
export function initUI(){
  const elBoard  = document.getElementById('board');

  // Top status + controls
  const elTurn     = document.getElementById('turnLabel');
  const btnReset   = document.getElementById('btnReset');
  const btnUndo    = document.getElementById('btnUndo');
  const btnPause   = document.getElementById('btnPause');

  const pauseIcon  = btnPause ? btnPause.querySelector('img')  : null;
  const pauseLabel = btnPause ? btnPause.querySelector('span') : null;

  // Clocks
  const clockW   = document.getElementById('clockW');
  const clockB   = document.getElementById('clockB');

  const KH = {
    white: 'ស',
    black: 'ខ្មៅ',
    check: 'អុក',
    checkmate: 'អុកស្លាប់',
    stalemate: 'អាប់'
  };

  // Counting Draw UI refs (may be auto-injected)
  let elCountLabel = document.getElementById('count-label');
  let elCountNum   = document.getElementById('count-number');
  let elCountBar   = document.getElementById('count-bar');
  let elCountFill  = document.getElementById('count-bar-fill');
  let elCountBadge = document.getElementById('count-badge');

  const auCountStart = document.getElementById('snd-count-start');
  const auCountEnd   = document.getElementById('snd-count-end');

  // Ensure Count UI exists even if cached HTML is old
  (function ensureCountUI(){
    const wrap = document.querySelector('.turn-wrap') || document.body;
    let lbl  = document.getElementById('count-label');
    let num  = document.getElementById('count-number');
    let bar  = document.getElementById('count-bar');
    let fill = document.getElementById('count-bar-fill');
    let badge= document.getElementById('count-badge');

    if (!lbl || !num || !bar || !fill) {
      const frag = document.createDocumentFragment();
      if (!lbl) {
        lbl = document.createElement('span');
        lbl.id = 'count-label';
        lbl.className = 'count-label';
        lbl.style.display = 'none';
        lbl.innerHTML = '⏳ <b>រាប់ស្មើ៖ <span id="count-number">–</span></b>';
        frag.appendChild(lbl);
        num = lbl.querySelector('#count-number');
      }
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'count-bar';
        bar.className = 'count-bar';
        bar.style.display = 'none';

        fill = document.createElement('div');
        fill.id = 'count-bar-fill';
        fill.className = 'count-bar-fill';

        badge = document.createElement('span');
        badge.id = 'count-badge';
        badge.className = 'count-badge';
        badge.textContent = '–';

        bar.appendChild(fill);
        bar.appendChild(badge);
        frag.appendChild(bar);
      }
      wrap.appendChild(frag);
    }
    elCountLabel = document.getElementById('count-label');
    elCountNum   = document.getElementById('count-number');
    elCountBar   = document.getElementById('count-bar');
    elCountFill  = document.getElementById('count-bar-fill');
    elCountBadge = document.getElementById('count-badge');
  })();

  // Mobile audio unlock for <audio> fallbacks
  function safePlay(el){
    if(!el) return;
    try{ el.currentTime = 0; el.play().catch(()=>{});}catch(e){}
  }
  window.addEventListener('pointerdown', ()=>{
    [auCountStart, auCountEnd].forEach(a=>{
      try{ a?.play()?.then(()=>a.pause()).catch(()=>{});}catch(e){}
    });
  }, { once:true });

  /* Game + settings */
  const game = new Game();
  let settings = loadSettings();
  beeper.enabled = !!settings.sound;

  // Helper: board turn class
  function applyTurnClass(){
    if (!elBoard) return;
    elBoard.classList.toggle('turn-white', game.turn === COLORS.WHITE);
    elBoard.classList.toggle('turn-black', game.turn === COLORS.BLACK);
  }

  // Clocks (after settings exist)
  const clocks = new Clocks((w,b)=>{ clockW.textContent=clocks.format(w); clockB.textContent=clocks.format(b); });
  clocks.init(settings.minutes, settings.increment, COLORS.WHITE);

  // build board cells
  elBoard.innerHTML = '';
  const cells=[];
  for(let y=0;y<SIZE;y++){
    for(let x=0;x<SIZE;x++){
      const cell=document.createElement('div');
      cell.className='cell '+((x+y)%2?'dark':'light');
      cell.dataset.x=x; cell.dataset.y=y; cell.dataset.ax=(String.fromCharCode(97+x)+(8-y));
      elBoard.appendChild(cell); cells.push(cell);
    }
  }

  const setPieceBG=(span,p)=>{
    const map={K:'king',Q:'queen',B:'bishop',R:'rook',N:'knight',P:'pawn'};
    const name=`${p.c==='w'?'w':'b'}-${map[normType(p.t)] || map[p.t] || 'pawn'}`;
    span.style.backgroundImage=`url(./assets/pieces/${name}.png)`;
  };

  function khTurnLabel(){
    const side = game.turn===COLORS.WHITE ? KH.white : KH.black;
    const st = game.status();
    if(st.state==='checkmate'){
      const winner = side==='ស' ? 'ខ្មៅ' : 'ស';
      return `វេនខាង (${side}) · ${KH.checkmate} · ${winner} ឈ្នះ`;
    }
    if(st.state==='stalemate') return `${KH.stalemate}`;
    if(st.state==='check')     return `វេនខាង (${side}) · ${KH.check}`;
    return `វេនខាង (${side})`;
  }

  /* ========= Counting Draw (រាប់ស្មើ) ================================= */

  // Normalize piece types: accept both western and Khmer-coded letters
  const TYPE_MAP = {
    // western
    R:'R', N:'N', B:'B', Q:'Q', P:'P', K:'K',
    // Khmer-coded variants seen in projects
    T:'R',   // Tuk (Boat)
    H:'N',   // Horse
    G:'B',   // Khon / General
    D:'Q',   // Neang (บางโปรเจกต์ใช้ D)
    F:'P',   // Fish
    S:'K'    // Sdech (if used)
  };
  function normType(t){ return TYPE_MAP[t] || t; }

  const countState = {
  active:false,
  base:0,
  initial:0,
  remaining:0,
  side:null  // 'w' or 'b' — only this side decrements
};

  // (optional) mini debug bubble – tap the turn label to toggle
  let debugOn = false;
  function showDebugBubble(txt){
    let el = document.getElementById('count-debug');
    if (!el){
      el = document.createElement('div');
      el.id = 'count-debug';
      Object.assign(el.style, {
        position:'fixed', left:'8px', top:'8px', zIndex:'9999',
        background:'rgba(0,0,0,.65)', color:'#fff', padding:'6px 8px',
        borderRadius:'8px', fontSize:'12px', fontFamily:'monospace'
      });
      document.body.appendChild(el);
    }
    el.textContent = txt;
    el.style.display = debugOn ? 'block' : 'none';
  }
  (elTurn||document).addEventListener('click', ()=>{
    debugOn = !debugOn;
    const { totals, nonKingPieces } = summarizeMaterial(game.board);
    showDebugBubble(`boats:${totals.boats} horses:${totals.horses} generals:${totals.generals} queens:${totals.queens} fishes:${totals.fishes} | nonKing:${nonKingPieces}`);
  });

  function showCountUI(show){
    if (elCountLabel) elCountLabel.style.display = show ? 'inline' : 'none';
    if (elCountBar)   elCountBar.style.display   = show ? 'block'  : 'none';
    elCountLabel?.classList.toggle('pulse', !!show);
    if(!show){
      elCountBar?.classList.remove('urgent');
      elCountFill?.classList.remove('low');
    }
  }
  function updateCountUI(){
    if (elCountNum)   elCountNum.textContent   = String(countState.remaining);
    if (elCountBadge) elCountBadge.textContent = String(countState.remaining);
    if(elCountFill && countState.initial){
      const pct = Math.max(0, (countState.remaining / countState.initial) * 100);
      elCountFill.style.width = `${pct}%`;
    }
    const urgent = countState.remaining <= 3;
    elCountBar?.classList.toggle('urgent', urgent);
    elCountFill?.classList.toggle('low', urgent);
  }

  function summarizeMaterial(board){
    const cnt = (c, tWanted) => {
      let n = 0;
      for (let y=0;y<SIZE;y++){
        for (let x=0;x<SIZE;x++){
          const p = board[y][x]; if(!p) continue;
          const t = normType(p.t);
          if (p.c === c && t === tWanted) n++;
        }
      }
      return n;
    };
    const S = (c)=>({
      boats:    cnt(c,'R'),
      horses:   cnt(c,'N'),
      generals: cnt(c,'B'),
      queens:   cnt(c,'Q'),
      fishes:   cnt(c,'P'),
      kings:    cnt(c,'K')
    });
    const w = S('w'), b = S('b');
    const totals = {
      boats:    w.boats    + b.boats,
      horses:   w.horses   + b.horses,
      generals: w.generals + b.generals,
      queens:   w.queens   + b.queens,
      fishes:   w.fishes   + b.fishes,
      kings:    w.kings    + b.kings
    };
    const nonKingPieces = totals.boats + totals.horses + totals.generals + totals.queens + totals.fishes;
    return { totals, nonKingPieces };
  }

  function checkCountingDrawRule(board){
    const { totals, nonKingPieces } = summarizeMaterial(board);

    // Fish-only quick cases
    if (totals.boats===0 && totals.generals===0 && totals.horses===0 && totals.queens===0){
      if (totals.fishes===1 || totals.fishes===2){
        return { active:false, immediateDraw:true };
      }
      if (totals.fishes===3){
        const base = 64;
        const effective = Math.max(base - nonKingPieces, 1);
        return { active:true, base, effective };
      }
    }

    let base = 0;
    if (totals.boats >= 2 && totals.generals===0 && totals.horses===0) base = 8;
    else if (totals.boats === 1 && totals.generals===0 && totals.horses===0) base = 16;
    else if (totals.boats === 0 && totals.generals >= 2 && totals.horses===0) base = 22;
    else if (totals.boats === 0 && totals.generals === 1 && totals.horses===0) base = 44;
    else if (totals.boats === 0 && totals.generals === 0 && totals.horses >= 2) base = 32;
    else if (totals.boats === 0 && totals.generals === 0 && totals.horses >= 1 && totals.fishes >= 1) base = 64;

    if (!base) return { active:false };
    const effective = Math.max(base - nonKingPieces, 1);
    return { active:true, base, effective };
  }

  function startCountingDraw(base, effective, withSound=true){
  countState.active   = true;
  countState.base     = base;
  countState.initial  = effective;
  countState.remaining= effective;
  countState.side     = game.turn; // remember whose turn it is when counting starts
    showCountUI(true);
    updateCountUI();
    if (withSound){ if (beeper.enabled) beeper.countStart(); else safePlay(auCountStart); }
  }
  function stopCountingDraw(){
    countState.active=false; countState.base=0; countState.initial=0; countState.remaining=0;
    showCountUI(false);
  }

  function evaluateRuleAndMaybeStart(withSound=true){
    const rule = checkCountingDrawRule(game.board);
    if (rule.immediateDraw){ stopCountingDraw(); return; }
    if (rule.active){
      if (!countState.active || countState.base !== rule.base){
        startCountingDraw(rule.base, rule.effective, withSound);
      }
    } else if (countState.active){
      stopCountingDraw();
    }
  }

  function onMoveCommittedDecrement(prevTurn){
  if(!countState.active) return;
  // Decrease only if the side that *owns* the rule just moved
  if (prevTurn !== countState.side) return;
  countState.remaining = Math.max(0, countState.remaining - 1);
    updateCountUI();
    if (countState.remaining === 0){
      if (beeper.enabled) beeper.countEnd(); else safePlay(auCountEnd);
      alert('ស្មើតាមច្បាប់រាប់ (រាប់ស្មើ)');
      stopCountingDraw();
    }
  }

  function reseedCounterAfterCapture(){
    const rule = checkCountingDrawRule(game.board);
    if (rule.immediateDraw){ stopCountingDraw(); return; }
    if (rule.active){ startCountingDraw(rule.base, rule.effective, /*sound*/false); }
    else{ stopCountingDraw(); }
  }
  /* ========= /Counting Draw =========================================== */

  function render(){
    for(const c of cells){
      c.innerHTML='';
      c.classList.remove('selected','hint-move','hint-capture','last-from','last-to','last-capture');
    }
    for(let y=0;y<SIZE;y++) for(let x=0;x<SIZE;x++){
      const p=game.at(x,y); if(!p) continue;
      const cell=cells[y*SIZE+x];
      const span=document.createElement('div');
      span.className=`piece ${p.c==='w'?'white':'black'}`;
      setPieceBG(span,p);
      cell.appendChild(span);
    }
    const last = game.history[game.history.length-1];
    if(last){
      cells[last.from.y*SIZE+last.from.x].classList.add('last-from');
      const toCell = cells[last.to.y*SIZE+last.to.x];
      toCell.classList.add('last-to');
      if(last.captured) toCell.classList.add('last-capture');
    }
    if (elTurn) elTurn.textContent = khTurnLabel();
    applyTurnClass();
    evaluateRuleAndMaybeStart(false);
  }

  let selected=null, legal=[];
  const clearHints=()=>{ for(const c of cells) c.classList.remove('selected','hint-move','hint-capture'); };
  const hintsEnabled = () => settings.hints !== false;

  function showHints(x,y){
    clearHints(); const cell=cells[y*SIZE+x]; cell.classList.add('selected');
    legal=game.legalMoves(x,y); if(!hintsEnabled()) return;
    for(const m of legal){
      const t=game.at(m.x,m.y), c=cells[m.y*SIZE+m.x];
      if(t) c.classList.add('hint-capture'); else c.classList.add('hint-move');
    }
  }

  function onCellTap(e){
    const x=+e.currentTarget.dataset.x, y=+e.currentTarget.dataset.y, p=game.at(x,y);
    if(p && p.c===game.turn){
      selected={x,y}; showHints(x,y);
      if(beeper.enabled) beeper.select();
      return;
    }
    if(!selected){ if(beeper.enabled) beeper.error(); vibrate(40); return; }

    const ok=legal.some(m=>m.x===x&&m.y===y);
    if(!ok){
      selected=null; legal=[]; clearHints();
      if(beeper.enabled) beeper.error(); vibrate(40);
      return;
    }

    const from={...selected}, to={x,y}, before=game.at(to.x,to.y), prevTurn=game.turn;
    const res=game.move(from,to);

    if(res.ok){
      if(beeper.enabled){
        if(before){ beeper.capture(); vibrate([20,40,30]); }
        else beeper.move();
      }
      if(res.status?.state==='check' && beeper.enabled){ beeper.check(); vibrate(30); }

      clocks.switchedByMove(prevTurn);

      onMoveCommittedDecrement(prevTurn);
      if (before){ reseedCounterAfterCapture(); }

      selected=null; legal=[]; clearHints(); render();
      saveGameState(game,clocks);

      if(res.status?.state==='checkmate'){
        stopCountingDraw();
        setTimeout(()=> alert('អុកស្លាប់! ការប្រកួតបានបញ្ចប់'), 50);
      }else if(res.status?.state==='stalemate'){
        stopCountingDraw();
        setTimeout(()=> alert('អាប់ — ការប្រកួតស្មើគ្នា!'), 50);
      }
    }
  }
  for(const c of cells) c.addEventListener('click', onCellTap, {passive:true});

  // Pause UI helper
  function updatePauseUI(running){
    if (pauseIcon) pauseIcon.src = running ? 'assets/ui/pause.png' : 'assets/ui/play.png';
    if (pauseLabel) pauseLabel.textContent = running ? 'ផ្អាក' : 'ចាប់ផ្ដើម';
    if (btnPause) {
      btnPause.setAttribute('aria-pressed', running ? 'false' : 'true');
      btnPause.classList.toggle('is-paused', !running);
    }
  }

  // resume previous game or start fresh
  const saved=loadGameState();
  if(saved){
    game.board=saved.board; game.turn=saved.turn; game.history=saved.history||[];
    clocks.msW=saved.msW??clocks.msW; clocks.msB=saved.msB??clocks.msB; clocks.turn=saved.clockTurn??game.turn;
    clockW.textContent=clocks.format(clocks.msW); clockB.textContent=clocks.format(clocks.msB);
    render(); clocks.start();
  } else { render(); clocks.start(); }

  updatePauseUI(true);

  /* ---------------------------- controls ---------------------------- */
  btnReset?.addEventListener('click', ()=>{
    game.reset(); selected=null; legal=[]; clearHints();
    clearGameState(); clocks.init(settings.minutes, settings.increment, COLORS.WHITE);
    render(); clocks.start();
    updatePauseUI(true);
    stopCountingDraw();
  });

  btnUndo?.addEventListener('click', ()=>{
    if(game.undo()){
      selected=null; legal=[]; clearHints(); render(); saveGameState(game,clocks);
    }
  });

  btnPause?.addEventListener('click', ()=>{
    const wasRunning = clocks.running;
    clocks.pauseResume();
    updatePauseUI(!wasRunning);
  });

  window.addEventListener('beforeunload', ()=> saveGameState(game,clocks));

  /* ----------------------- Auto-hide bottom bar ---------------------- */
  (function(){
    const bar = document.getElementById('appTabbar');
    const spacer = document.getElementById('bottomSpacer');
    if(!bar || !spacer) return;

    const setSpacer = () => { spacer.style.height = (bar.offsetHeight || 56) + 'px'; };
    setSpacer();
    window.addEventListener('resize', setSpacer, { passive:true });

    let lastY = window.scrollY;
    let ticking = false;

    const onScroll = () => {
      const y = window.scrollY;
      const dy = y - lastY;
      if (y < 8) {
        bar?.classList.remove('is-hidden');
        lastY = y; ticking = false; return;
      }
      if (Math.abs(dy) > 6) {
        if (dy > 0) bar.classList.add('is-hidden'); else bar.classList.remove('is-hidden');
        lastY = y;
      }
      ticking = false;
    };

    window.addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
    }, { passive:true });

    window.addEventListener('touchstart', (e)=>{
      const vh = window.innerHeight || document.documentElement.clientHeight;
      if ((vh - e.touches[0].clientY) < 72) bar?.classList.remove('is-hidden');
    }, { passive:true });
  })();
}
