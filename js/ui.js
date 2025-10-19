// js/ui.js
import { Game, LABEL, SIZE, COLORS } from './game.js';

export function initUI(){
  const elBoard = document.getElementById('board');
  const elMoves = document.getElementById('moveList');
  const elTurn = document.getElementById('turnLabel');
  const elReset= document.getElementById('btnReset');
  const elUndo = document.getElementById('btnUndo');
  const optHints = document.getElementById('optShowHints');

  const game = new Game();

  // Build cells
  const cells = [];
  for(let y=0;y<SIZE;y++){
    for(let x=0;x<SIZE;x++){
      const cell = document.createElement('div');
      cell.className = 'cell ' + ((x+y)%2? 'dark':'light');
      cell.dataset.x = x;
      cell.dataset.y = y;
      cell.dataset.ax = (String.fromCharCode(97+x) + (8-y)); // a8..h1
      elBoard.appendChild(cell);
      cells.push(cell);
    }
  }

  function render(){
    // clear
    for(const c of cells){
      c.innerHTML = '';
      c.classList.remove('selected','hint-move','hint-capture');
    }
    // pieces
    for(let y=0;y<SIZE;y++){
      for(let x=0;x<SIZE;x++){
        const p = game.at(x,y);
        const cell = cells[y*SIZE+x];
        if(p){
          const span = document.createElement('div');
          span.className = `piece ${p.c===COLORS.WHITE?'white':'black'}`;
          // Text label placeholder (replace later with PNG by CSS background-image)
          span.textContent = LABEL[p.t];
          span.draggable = false;
          cell.appendChild(span);
        }
      }
    }
    elTurn.textContent = game.turn===COLORS.WHITE ? 'ស - White to move' : 'ខ - Black to move';
  }

  let selected = null;
  let legal = [];

  function clearHints(){
    for(const c of cells){
      c.classList.remove('selected','hint-move','hint-capture');
    }
  }

  function showHints(x,y){
    clearHints();
    const cell = cells[y*SIZE+x];
    cell.classList.add('selected');
    const moves = game.legalMoves(x,y);
    legal = moves;
    if(!optHints.checked) return;
    for(const m of moves){
      const t = game.at(m.x,m.y);
      const c = cells[m.y*SIZE+m.x];
      if(t) c.classList.add('hint-capture');
      else c.classList.add('hint-move');
    }
  }

  function onCellTap(e){
    const target = e.currentTarget;
    const x = +target.dataset.x, y = +target.dataset.y;
    const p = game.at(x,y);

    // if selecting own piece
    if(p && p.c===game.turn){
      selected = {x,y};
      showHints(x,y);
      return;
    }

    // if we have a selection, attempt move
    if(selected){
      const ok = legal.some(m=> m.x===x && m.y===y);
      if(ok){
        const from = {...selected};
        const to = {x,y};
        const before = game.at(to.x,to.y);
        const res = game.move(from, to);
        if(res.ok){
          // history list entry
          const idx = Math.ceil((game.history.length)/2);
          const moveText = `${String.fromCharCode(97+from.x)}${8-from.y} → ${String.fromCharCode(97+to.x)}${8-to.y}` +
                           (before ? ' ×' : '') + (res.promo ? ' =Q' : '');
          if(game.turn===COLORS.BLACK){ // just completed white move
            const li = document.createElement('li');
            li.textContent = `${idx}. ${moveText}`;
            elMoves.appendChild(li);
          }else{
            // append to last li
            const last = elMoves.lastElementChild;
            if(last) last.textContent = `${last.textContent}    |    ${moveText}`;
            else{
              const li = document.createElement('li');
              li.textContent = `${idx}. ... ${moveText}`;
              elMoves.appendChild(li);
            }
          }
          elMoves.parentElement.scrollTop = elMoves.parentElement.scrollHeight;

          selected=null; legal=[];
          clearHints();
          render();
          return;
        }
      }
      // otherwise, reselect / clear
      selected=null; legal=[];
      clearHints();
      if(p && p.c===game.turn){ selected={x,y}; showHints(x,y); }
    }
  }

  for(const c of cells){ c.addEventListener('click', onCellTap, {passive:true}); }

  elReset.addEventListener('click', ()=>{
    game.reset();
    elMoves.innerHTML='';
    selected=null; legal=[];
    clearHints();
    render();
  });

  elUndo.addEventListener('click', ()=>{
    if(game.undo()){
      // update move list (very simple pop UI)
      if(elMoves.lastElementChild){
        const hasPipe = elMoves.lastElementChild.textContent.includes('|');
        if(hasPipe){
          // remove part after pipe
          const t = elMoves.lastElementChild.textContent.split('|')[0].trim();
          elMoves.lastElementChild.textContent = t;
        }else{
          elMoves.removeChild(elMoves.lastElementChild);
        }
      }
      selected=null; legal=[];
      clearHints();
      render();
    }
  });

  document.getElementById('btnBack')?.addEventListener('click', ()=> history.back());
  document.getElementById('btnHome')?.addEventListener('click', (e)=>{ e.preventDefault(); location.href='./'; });

  render();
}
