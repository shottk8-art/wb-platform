// Presentation only. The renderer retains all rows, totals and financial values.
(function(){
  'use strict';
  const states=new WeakMap(),live=new Set();
  const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
  function stop(state){state.observer?.disconnect();state.observer=null;state.animations.forEach(animation=>animation.cancel());state.animations=[];}
  function reveal(state){
    state.observer?.disconnect();state.observer=null;
    if(preference.matches||document.hidden)return;
    [...state.card.querySelectorAll('.sku-sales-fill')].slice(0,12).forEach((bar,index)=>{
      const share=Number(bar.style.getPropertyValue('--sku-share'))||0;
      const animation=bar.animate?.([{transform:'scaleX(0)'},{transform:`scaleX(${share})`}],{duration:760,delay:Math.min(index*30,150),easing:'cubic-bezier(.16,1,.3,1)',fill:'backwards'});
      if(animation)state.animations.push(animation);
    });
  }
  function enhance(card){
    let state=states.get(card);
    if(!state){state={card,details:false,filters:false,observer:null,animations:[]};states.set(card,state);live.add(state);}
    stop(state);
    const scope=card.parentElement||card;
    const details=scope.querySelector('#skuDetailsToggle'),filters=scope.querySelector('#skuFilterToggle'),toolbar=card.querySelector('.sku-toolbar');
    state.controls={details,filters,toolbar};
    const sync=()=>{
      card.classList.toggle('is-sku-details',state.details);
      if(details){details.setAttribute('aria-expanded',String(state.details));details.textContent=state.details?'Краткий вид':'Все показатели';}
      if(filters)filters.setAttribute('aria-expanded',String(state.filters));
      if(toolbar)toolbar.hidden=!state.filters;
    };
    if(details)details.onclick=()=>{state.details=!state.details;sync();};
    if(filters)filters.onclick=()=>{state.filters=!state.filters;sync();};
    if(toolbar)toolbar.onkeydown=event=>{if(event.key==='Escape'){state.filters=false;sync();filters?.focus();}};
    sync();
    if(typeof IntersectionObserver==='function'){
      state.observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))reveal(state);},{threshold:.05});state.observer.observe(card);
    }else reveal(state);
  }
  function dispose(card){const state=states.get(card);if(!state)return;stop(state);const {details,filters,toolbar}=state.controls;if(details)details.onclick=null;if(filters)filters.onclick=null;if(toolbar)toolbar.onkeydown=null;states.delete(card);live.delete(state);}
  window.WBSkuProducts={enhance,dispose};
  document.addEventListener?.('visibilitychange',()=>{if(document.hidden)for(const state of live)stop(state);});
  preference.addEventListener?.('change',()=>{for(const state of live)stop(state);});
})();
