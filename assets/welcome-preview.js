// Interactive, explicitly fictional first-run preview. No API or seller data.
(function(root){
  'use strict';
  const METRICS=[{id:'sales',label:'Продажи'},{id:'expenses',label:'Расходы'},{id:'profit',label:'Чистая прибыль'}];
  const money=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(n)+' ₽';
  const compact=n=>{const parts=new Intl.NumberFormat('ru-RU',{notation:'compact',maximumFractionDigits:1}).formatToParts(n);return{number:parts.filter(p=>['integer','group','decimal','fraction','minusSign'].includes(p.type)).map(p=>p.value).join(''),unit:(parts.find(p=>p.type==='compact')?.value||'')+' ₽'};};
  function buildSeries(sample,dashboard){
    return sample.periods.map((period,i)=>{
      const entries=['wildberries','ozon'].map(m=>{const row=sample.data[m][i];return dashboard.computeDerived(row.report,row.skus,sample.costs,sample.taxRate);});
      const sales=entries.reduce((sum,d)=>sum+d.rep.sales_amount,0),profit=entries.reduce((sum,d)=>sum+d.netProfit,0);
      return{...period,sales,profit,expenses:sales-profit};
    }).slice(-6);
  }
  function mount(node){
    if(!node||!root.WBDemoData||!root.WBDashboard)return{setName(){},dispose(){}};
    const series=buildSeries(root.WBDemoData.build(),root.WBDashboard),last=series.length-1;
    let metric='profit',active=last,disposed=false;
    const reduced=root.matchMedia('(prefers-reduced-motion: reduce)'),animations=new Map();
    const month=(row,short=false)=>new Date(row.year,row.month-1,1).toLocaleDateString('ru-RU',{month:short?'short':'long',...(short?{}:{year:'numeric'})});
    node.innerHTML=`
      <div class="welcome-board-head"><span class="welcome-shop-avatar" aria-hidden="true" data-preview-avatar>МБ</span><div><strong data-preview-name>Мой магазин</strong><span>Wildberries + Ozon</span></div><span class="welcome-demo-tag">Демо-данные</span></div>
      <div class="welcome-metrics" aria-label="Показатель на графике">${METRICS.map(m=>`<button type="button" data-preview-metric="${m.id}" aria-pressed="${m.id===metric}"><span>${m.label}</span><strong data-preview-value="${m.id}"><span></span><small></small></strong></button>`).join('')}</div>
      <div class="welcome-chart-head"><strong data-preview-title>Чистая прибыль</strong><span data-preview-period></span></div>
      <div class="welcome-chart">
        <div class="welcome-chart-grid" aria-hidden="true"><i></i><i></i><i></i></div>
        <div class="welcome-chart-tooltip" hidden aria-hidden="true"><span data-preview-month></span><strong data-preview-amount></strong></div>
        <div class="welcome-chart-bars" role="group" aria-label="Месяцы демо-графика">${series.map((row,i)=>`<button type="button" data-preview-month-index="${i}"><span class="welcome-bar-track" aria-hidden="true"><i class="welcome-bar-fill"></i></span><span class="welcome-bar-label">${month(row,true).replace('.','')}</span></button>`).join('')}</div>
      </div>
      <div class="welcome-board-foot"><span>Выберите показатель или месяц</span><a href="/demo.html">Открыть демо <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg></a></div>`;
    const $=selector=>node.querySelector(selector),buttons=[...node.querySelectorAll('[data-preview-month-index]')],metricButtons=[...node.querySelectorAll('[data-preview-metric]')],tooltip=$('.welcome-chart-tooltip'),chart=$('.welcome-chart');
    function stop(){animations.forEach(a=>a.cancel());animations.clear();}
    function animate(el,frames,options){
      animations.get(el)?.cancel();
      if(disposed||reduced.matches||document.hidden||!el.animate)return;
      const a=el.animate(frames,{duration:560,easing:'cubic-bezier(.16,1,.3,1)',...options});animations.set(el,a);
      a.finished.catch(()=>{}).finally(()=>{if(animations.get(el)===a)animations.delete(el);});
    }
    function inspect(index,show=true){
      active=index;
      buttons.forEach((b,i)=>{b.classList.toggle('is-active',i===index);b.setAttribute('aria-pressed',String(i===index));});
      $('[data-preview-month]').textContent=month(series[index]);
      $('[data-preview-amount]').textContent=money(series[index][metric]);
      tooltip.hidden=!show;
      tooltip.style.setProperty('--month-position',String((index+.5)/series.length));
      if(show)animate(tooltip,[{opacity:0,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{duration:180});
    }
    function draw(initial=false){
      const max=Math.max(...series.map(row=>row[metric]),1);
      metricButtons.forEach(button=>{
        const selected=button.dataset.previewMetric===metric;
        button.setAttribute('aria-pressed',String(selected));
        button.setAttribute('aria-label',METRICS.find(m=>m.id===button.dataset.previewMetric).label+': '+money(series[last][button.dataset.previewMetric])+'. Показать динамику');
        const value=button.querySelector('strong'),formatted=compact(series[last][button.dataset.previewMetric]);value.querySelector('span').textContent=formatted.number;value.querySelector('small').textContent=formatted.unit;
        if(selected&&!initial)animate(value,[{opacity:.45,filter:'blur(3px)'},{opacity:1,filter:'blur(0)'}],{duration:250});
      });
      $('[data-preview-title]').textContent=METRICS.find(m=>m.id===metric).label;
      $('[data-preview-period]').textContent=month(series[0],true)+' — '+month(series[last],true);
      buttons.forEach((button,i)=>{
        button.setAttribute('aria-label',month(series[i])+': '+money(series[i][metric]));
        const fill=button.querySelector('.welcome-bar-fill');
        fill.style.setProperty('--bar-size',String(Math.max(0,series[i][metric])/max));
        if(initial)animate(fill,[{transform:'scaleY(0)'},{transform:`scaleY(${Math.max(0,series[i][metric])/max})`}],{duration:760,delay:Math.min(i*35,140)});
      });
      inspect(active,false);
    }
    metricButtons.forEach(button=>button.onclick=()=>{metric=button.dataset.previewMetric;draw();});
    buttons.forEach((button,i)=>{
      button.onpointerenter=()=>inspect(i);button.onfocus=()=>inspect(i);button.onclick=()=>inspect(i);
      button.onkeydown=e=>{
        let next;
        if(e.key==='ArrowRight'||e.key==='ArrowUp')next=Math.min(last,i+1);
        if(e.key==='ArrowLeft'||e.key==='ArrowDown')next=Math.max(0,i-1);
        if(e.key==='Home')next=0;if(e.key==='End')next=last;
        if(next!==undefined){e.preventDefault();buttons[next].focus();}
        if(e.key==='Escape'){e.preventDefault();inspect(last,false);}
      };
    });
    const leave=()=>inspect(last,false),blur=e=>{if(!chart.contains(e.relatedTarget))leave();};
    chart.addEventListener('pointerleave',leave);chart.addEventListener('focusout',blur);
    const settle=()=>{stop();node.dataset.motionPaused=String(document.hidden||reduced.matches);};
    document.addEventListener('visibilitychange',settle);reduced.addEventListener?.('change',settle);
    draw(true);
    return{
      setName(value){const name=String(value||'').trim()||'Мой магазин';$('[data-preview-name]').textContent=name;$('[data-preview-avatar]').textContent=name.split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase();},
      dispose(){disposed=true;stop();chart.removeEventListener('pointerleave',leave);chart.removeEventListener('focusout',blur);document.removeEventListener('visibilitychange',settle);reduced.removeEventListener?.('change',settle);},
    };
  }
  const api={buildSeries,mount};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.WBWelcomePreview=api;
})(typeof window==='object'?window:globalThis);
