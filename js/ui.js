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

      // Optional extra SFX (Counting Draw)
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
    this.turn=(prev===COLORS.WHITE)?COLORS.BLACK:COLORS.WHITE; this._u(this.msW,this.msB); this.start();
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

  // select pause icon/label from inside the button (no ids needed)
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

  // Counting Draw UI refs (optional elements)
  const elCountLabel = document.getElementById('count-label');
  const elCountNum   = document.getElementById('count-number');
  const elCountBar   = document.getElementById('count-bar');
  const elCountFill  = document.getElementById('count-bar-fill');

  const auCountStart = document.getElementById('snd-count-start');
  const auCountEnd   = document.getElementById('snd-count-end');

  const game = new Game();
  let settings = loadSettings();
  beeper.enabled = !!settings.sound;

  // ---- Mobile audio unlock for <audio> fallbacks
  function safePlay(el){
    if(!el) return;
    try{ el.currentTime = 0; el.play().catch(()=>{});}catch(e){}
  }
  window.addEventListener('pointerdown', ()=>{
    [auCountStart, auCountEnd].forEach(a=>{
      try{ a?.play()?.then(()=>a.pause()).catch(()=>{});}catch(e){}
    });
  }, { once:true });

  const clocks = new Clocks((w,b)=>{ clockW.textContent=clocks.format(w); clockB.textContent=clocks.format(b); });
  clocks.init(settings.minutes, settings.increment, COLORS.WHITE);

  // helper: apply .turn-white / .turn-black on the board element
  function applyTurnClass(){
    if (!elBoard) return;
    elBoard.classList.toggle('turn-white', game.turn === COLORS.WHITE);
    elBoard.classList.toggle('turn-black', game.turn === COLORS.BLACK);
  }

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
    const name=`${p.c==='w'?'w':'b'}-${map[p.t]}`;
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

  /* ----------------- Counting Draw (រាប់ស្មើ) ----------------- */
  const countState = {
    active:false, side:null, initial:0, remaining:0
  };

  function showCountUI(show){
    if(!elCountLabel || !elCountBar) return;
    elCountLabel.style.display = show ? 'inline' : 'none';
    elCountBar.style.display   = show ? 'block'  : 'none';
    elCountLabel.classList.toggle('pulse', !!show);
    if(!show){
      elCountBar.classList.remove('urgent');
      elCountFill?.classList.remove('low');
    }
  }
  function updateCountUI(){
    if(elCountNum) elCountNum.textContent = String(countState.remaining);
    if(elCountFill && countState.initial){
      const pct = (countState.remaining / countState.initial) * 100;
      elCountFill.style.width = `${pct}%`;
    }
    if(elCountBar && elCountFill){
      const urgent = countState.remaining <= 3;
      elCountBar.classList.toggle('urgent', urgent);
      elCountFill.classList.toggle('low', urgent);
    }
  }
  function startCountingDraw(side, limit){
    countState.active   = true;
    countState.side     = side;     // 'w' or 'b'
    countState.initial  = limit;
    countState.remaining= limit;
    showCountUI(true);
    updateCountUI();
    // sound
    if (beeper.enabled) beeper.countStart(); else safePlay(auCountStart);
  }
  function tickCountingDraw(){
    if(!countState.active) return;
    countState.remaining = Math.max(0, countState.remaining - 1);
    updateCountUI();
    if(countState.remaining === 0){
      if (beeper.enabled) beeper.countEnd(); else safePlay(auCountEnd);
      alert('ស្មើតាមច្បាប់រាប់ (រាប់ស្មើ)');
      stopCountingDraw('draw');
      // Optionally: set a formal draw flag in your app state
      // game.winner = 'draw';
    }
  }
  function stopCountingDraw(/*reason*/){
    if(!countState.active && countState.remaining===0) { showCountUI(false); return; }
    countState.active=false; countState.side=null;
    countState.initial=0; countState.remaining=0;
    showCountUI(false);
  }

  // Summaries for material (maps to your Khmer pieces)
  function summarizeMaterial(board){
    const cnt = (c,t) => {
      let n=0;
      for (let y=0;y<SIZE;y++) for(let x=0;x<SIZE;x++){
        const p = board[y][x]; if(!p) continue;
        if (p.c===c && p.t===t) n++;
      }
      return n;
    };
    const S = (c)=>({
      boats:   cnt(c, 'R'),   // ទូក
      horses:  cnt(c, 'N'),   // សេះ
      generals:cnt(c, 'B'),   // ខុន (using Bishop slot)
      queens:  cnt(c, 'Q'),   // នាង
      fishes:  cnt(c, 'P'),   // ត្រី
      kings:   cnt(c, 'K')    // ស្តេច
    });
    return { w: S('w'), b: S('b') };
  }

  // Simple attacker inference: the side that matches the qualifying set
  function inferAttackerFromPattern(board, limit){
    const s = summarizeMaterial(board);
    const matches = (S)=>{
      if (S.boats===2 && limit===8) return true;
      if (S.boats===1 && limit===16) return true;
      if (S.boats===0 && S.generals===2 && limit===22) return true;
      if (S.boats===0 && S.generals===1 && limit===44) return true;
      if (S.boats===0 && S.generals===0 && S.horses===2 && limit===32) return true;
      if (S.boats===0 && S.generals===0 && S.horses===1 && S.fishes===1 && limit===64) return true;
      if (S.boats===0 && S.generals===0 && S.fishes===3 && limit===64) return true; // “3 fish” case (unless tied-fish special handling)
      return false;
    };
    const wMatch = matches(s.w);
    const bMatch = matches(s.b);
    if (wMatch && !bMatch) return 'w';
    if (bMatch && !wMatch) return 'b';
    return game.turn; // fallback to side to move
  }

  // Detection per Khmer counting rule
  // Returns: {active, limit, side} OR {active:false, immediateDraw:true} OR {active:false}
  function checkCountingDrawRule(board){
    const s = summarizeMaterial(board);
    const total = {
      boats:   s.w.boats    + s.b.boats,
      generals:s.w.generals + s.b.generals,
      horses:  s.w.horses   + s.b.horses,
      fishes:  s.w.fishes   + s.b.fishes,
      queens:  s.w.queens   + s.b.queens
    };

    // Immediate draw (cannot mate): only fishes 1 or 2, no other pieces
    if (total.boats===0 && total.generals===0 && total.horses===0 && total.queens===0){
      if (total.fishes===1 || total.fishes===2){
        return { active:false, immediateDraw:true };
      }
      if (total.fishes===3){
        // If you later add precise “tied-fish (ត្រីចង)” detection, convert to immediate draw.
        return { active:true, limit:64, side: inferAttackerFromPattern(board,64) };
      }
    }

    // Normal mapping
    if (total.boats===2 && total.generals===0 && total.horses===0){
      return { active:true, limit:8, side: inferAttackerFromPattern(board,8) };
    }
    if (total.boats===1 && total.generals===0 && total.horses===0){
      return { active:true, limit:16, side: inferAttackerFromPattern(board,16) };
    }
    if (total.boats===0 && total.generals===2 && total.horses===0){
      return { active:true, limit:22, side: inferAttackerFromPattern(board,22) };
    }
    if (total.boats===0 && total.generals===1 && total.horses===0){
      return { active:true, limit:44, side: inferAttackerFromPattern(board,44) };
    }
    if (total.boats===0 && total.generals===0 && total.horses===2){
      return { active:true, limit:32, side: inferAttackerFromPattern(board,32) };
    }
    if (total.boats===0 && total.generals===0 && total.horses===1 && total.fishes===1){
      return { active:true, limit:64, side: inferAttackerFromPattern(board,64) };
    }

    return { active:false };
  }

  function onPositionUpdated(){
    const rule = checkCountingDrawRule(game.board);

    // Immediate draw cases (fish only 1–2)
    if (rule.immediateDraw){
      stopCountingDraw('immediate');
      // Optional UX: alert once, or show a subtle banner instead of an alert
      // alert('ស្មើ (មិនអាចអុកបាន — សល់តែត្រីតិច)');
      return;
    }

    if (rule.active){
      const needsRestart = !countState.active
        || countState.initial !== rule.limit
        || countState.side    !== rule.side;

      if (needsRestart){
        startCountingDraw(rule.side, rule.limit);
      } else {
        showCountUI(true);
      }
    } else if (countState.active){
      // No longer qualifies (position changed)
      stopCountingDraw('reset');
    }
  }

  function onMoveCommitted(sideJustMoved){
    // Decrement ONLY if the attacking side (who must mate) just moved
    if (countState.active && sideJustMoved === countState.side){
      tickCountingDraw();
    }
  }
  /* ----------------- /Counting Draw (រាប់ស្មើ) ----------------- */

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

    // Re-evaluate counting rule each paint
    onPositionUpdated();
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

      // 🔵 Decrement the counting rule if the attacking side just moved
      onMoveCommitted(prevTurn);

      selected=null; legal=[]; clearHints(); render();
      saveGameState(game,clocks);

      if(res.status?.state==='checkmate'){
        stopCountingDraw('mate');
        setTimeout(()=> alert('អុកស្លាប់! ការប្រកួតបានបញ្ចប់'), 50);
      }else if(res.status?.state==='stalemate'){
        stopCountingDraw('draw');
        setTimeout(()=> alert('អាប់ — ការប្រកួតស្មើគ្នា!'), 50);
      }
    }
  }
  for(const c of cells) c.addEventListener('click', onCellTap, {passive:true});

  // --- Pause UI helper (single source of truth) ---
  function updatePauseUI(running){
    // running=true  -> show PAUSE
    // running=false -> show PLAY
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

  // ensure pause button shows PAUSE on first paint
  updatePauseUI(true);

  /* ---------------------------- controls ---------------------------- */
  btnReset?.addEventListener('click', ()=>{
    game.reset(); selected=null; legal=[]; clearHints();
    clearGameState(); clocks.init(settings.minutes, settings.increment, COLORS.WHITE);
    render(); clocks.start();
    updatePauseUI(true);
    stopCountingDraw('reset'); // clear counting rule UI/state
  });

  btnUndo?.addEventListener('click', ()=>{
    if(game.undo()){
      selected=null; legal=[]; clearHints(); render(); saveGameState(game,clocks);
      // Optionally stop to avoid stale UI after undo (render() will re-detect anyway)
      stopCountingDraw('reset');
    }
  });

  // Reliable toggle: derive the new state and then update UI
  btnPause?.addEventListener('click', ()=>{
    const wasRunning = clocks.running;
    clocks.pauseResume();
    updatePauseUI(!wasRunning);
  });

  // persist on unload
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
        bar.classList.remove('is-hidden');
        lastY = y;
        ticking = false;
        return;
      }
      if (Math.abs(dy) > 6) {
        if (dy > 0) bar.classList.add('is-hidden');      // scrolling down -> hide
        else        bar.classList.remove('is-hidden');   // scrolling up   -> show
        lastY = y;
      }
      ticking = false;
    };

    window.addEventListener('scroll', () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(onScroll);
      }
    }, { passive:true });

    // Reveal when user taps near the bottom (useful on short pages)
    window.addEventListener('touchstart', (e)=>{
      const vh = window.innerHeight || document.documentElement.clientHeight;
      if ((vh - e.touches[0].clientY) < 72) {
        bar.classList.remove('is-hidden');
      }
    }, { passive:true });
  })();
}
