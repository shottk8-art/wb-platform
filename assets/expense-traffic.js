// Presentation only: receives the existing signed totals and known magnitudes.
// Independently authored Traffic-sources interaction, with no service calls.
(function(){
  'use strict';
  const states=new WeakMap(),live=new Set(),ns='http://www.w3.org/2000/svg';
  const percent=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1});
  const reduced=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pct=value=>value>0&&value<.1?'<0,1%':`${percent.format(value)}%`;
  const svgElement=(name,attrs={})=>{const node=document.createElementNS(ns,name);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));return node;};

  function geometry(items,total){
    let offset=0;
    return items.map(item=>{
      const share=total>0?Math.abs(item.value)/total*100:0;
      // Keep tiny real categories visible; a fixed gap would erase them.
      const gap=Math.min(.8,share*.2),dash=Math.max(0,share-gap);
      const part={share,dash,offset:-offset};offset+=share;return part;
    });
  }

  function cancel(state){
    if(state.frame)cancelAnimationFrame(state.frame);state.frame=0;
    state.textAnimation?.cancel();state.textAnimation=null;
  }
  function dispose(canvas){
    const state=states.get(canvas);if(!state)return;
    cancel(state);state.observer?.disconnect();state.entrance.forEach(a=>a.cancel());
    state.svg.remove();state.canvas.hidden=false;state.card.classList.remove('is-traffic');
    state.listEl.removeEventListener('focusin',state.focusIn);
    state.listEl.removeEventListener('focusout',state.focusOut);
    for(const name of ['onpointerover','onpointerout','onpointerleave','onfocusin','onfocusout','onclick','onkeydown'])state.listEl[name]=null;
    states.delete(canvas);live.delete(state);
  }

  function centre(state,index,animate){
    const item=state.items[index],target=item?state.parts[index].share:null;
    const previous=state.visual;
    cancel(state);state.target=target;
    state.centerLabel.textContent=item?item.label:state.unknownItems.length?'нет данных':state.items.length?'расходы':'нет расходов';
    state.centerLabel.title=item?`${item.label}: ${new Intl.NumberFormat('ru-RU').format(item.value)} ₽`:state.totalText;
    const write=value=>{state.visual=value;const text=value==null?state.totalText:pct(value);state.centerValue.textContent=text;state.centerValue.title=text;state.centerValue.dataset.expenseSize=text.length>16?'extra':text.length>11?'long':'normal';};
    // Rubles and percentages are different units: never show a money-sized %.
    if(!animate||reduced()||document.hidden||previous==null||target==null){
      write(target);
      if(animate&&!reduced()&&!document.hidden)state.textAnimation=state.centerValue.animate?.([{opacity:.35,transform:'translateY(3px)'},{opacity:1,transform:'none'}],{duration:180,easing:'cubic-bezier(.16,1,.3,1)'});
      return;
    }
    if(previous===target){write(target);return;}
    const start=performance.now();
    const frame=now=>{const progress=Math.min(1,Math.max(0,(now-start)/360)),ease=1-Math.pow(1-progress,4);write(previous+(target-previous)*ease);state.frame=progress<1?requestAnimationFrame(frame):0;};
    state.frame=requestAnimationFrame(frame);
  }

  function select(state,index,animate=true){
    if(!Number.isInteger(index)||index<0||index>=state.items.length)index=-1;
    if(state.active===index)return;
    state.active=index;
    state.svg.classList.toggle('has-selection',index>=0);
    state.parts.forEach((part,i)=>part.node.classList.toggle('is-selected',i===index));
    state.buttons.forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));
    centre(state,index,animate);
  }

  function paint(state){
    const colors=state.paletteForTheme();
    state.items.forEach((item,i)=>{
      item.color=colors[i%colors.length];
      state.parts[i].node.style.stroke=item.color;
      state.buttons[i]?.querySelector('i')?.style.setProperty('--expense-color',item.color);
    });
  }

  function reveal(state){
    state.observer?.disconnect();state.observer=null;
    if(reduced()||document.hidden)return;
    state.parts.forEach((part,i)=>{
      const animation=part.node.animate?.([{strokeDasharray:'0 100'},{strokeDasharray:`${part.dash} ${100-part.dash}`}],{duration:800,delay:Math.min(i*45,225),easing:'cubic-bezier(.16,1,.3,1)',fill:'backwards'});
      if(animation)state.entrance.push(animation);
    });
  }

  function render(options){
    const {canvas,listEl,centerValue,centerLabel}=options;
    const card=canvas.closest?.('.expense-card');
    if(!card||!centerValue||!centerLabel)return false;
    dispose(canvas);
    const svg=svgElement('svg',{viewBox:'0 0 180 180',class:'expense-traffic-ring',role:'img','aria-label':canvas.getAttribute('aria-label')});
    svg.append(svgElement('circle',{cx:90,cy:90,r:70,class:'expense-traffic-track'}));
    const group=svgElement('g',{transform:'rotate(-90 90 90)'});svg.append(group);
    const state={...options,card,svg,parts:geometry(options.items,options.chartTotal),buttons:[...listEl.querySelectorAll('[data-expense-index]')],active:-2,visual:null,target:null,frame:0,entrance:[],observer:null,textAnimation:null};
    state.parts.forEach((part,i)=>{
      const node=svgElement('circle',{cx:90,cy:90,r:70,pathLength:100,class:'expense-traffic-segment','data-expense-segment':i,'stroke-dasharray':`${part.dash} ${100-part.dash}`,'stroke-dashoffset':part.offset});
      part.node=node;group.append(node);
    });
    canvas.hidden=true;canvas.after(svg);card.classList.add('is-traffic');
    const indexOf=(target,scope,attribute)=>{const row=target?.closest?.(`[${attribute}]`);return row&&scope.contains(row)?Number(row.dataset[attribute==='data-expense-index'?'expenseIndex':'expenseSegment']):null;};
    const rowIndex=target=>indexOf(target,listEl,'data-expense-index');
    state.focusIn=listEl.onpointerover=listEl.onclick=event=>{const index=rowIndex(event.target);if(index!=null)select(state,index);};
    listEl.addEventListener('focusin',state.focusIn);
    listEl.onpointerout=event=>{
      const index=rowIndex(event.target);if(index==null)return;
      const next=rowIndex(event.relatedTarget);if(next!==index)select(state,next??-1);
    };
    listEl.onpointerleave=()=>select(state,-1);
    state.focusOut=event=>{if(!listEl.contains(event.relatedTarget))select(state,-1);};
    listEl.addEventListener('focusout',state.focusOut);
    listEl.onkeydown=event=>{
      const index=rowIndex(event.target);if(index==null)return;
      if(event.key==='Escape'){event.preventDefault();select(state,-1);return;}
      if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
      event.preventDefault();
      const next=event.key==='Home'?0:event.key==='End'?state.buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+state.buttons.length)%state.buttons.length;
      state.buttons[next]?.focus();
    };
    svg.onpointerover=event=>{const index=indexOf(event.target,svg,'data-expense-segment');if(index!=null)select(state,index);};
    svg.onpointerout=event=>{const next=indexOf(event.relatedTarget,svg,'data-expense-segment');select(state,next??-1);};
    svg.onpointerleave=()=>select(state,-1);
    svg.onclick=event=>{const index=indexOf(event.target,svg,'data-expense-segment');if(index!=null){select(state,index);state.buttons[index]?.focus({preventScroll:true});state.buttons[index]?.scrollIntoView?.({block:'nearest',inline:'nearest'});}};
    states.set(canvas,state);live.add(state);paint(state);select(state,-1,false);
    if(typeof IntersectionObserver==='function'){
      state.observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))reveal(state);},{threshold:.15});state.observer.observe(svg);
    }else reveal(state);
    return true;
  }

  window.WBExpenseTraffic={render,dispose,geometry,formatPercent:pct};
  window.addEventListener?.('seller:themechange',()=>{for(const state of live)paint(state);});
  document.addEventListener?.('visibilitychange',()=>{if(document.hidden)for(const state of live){cancel(state);state.entrance.forEach(a=>a.cancel());select(state,-1,false);}});
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change',()=>{for(const state of live){cancel(state);state.entrance.forEach(a=>a.cancel());centre(state,state.active,false);}});
})();
