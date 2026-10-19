// Reference-style chart presentation. Reads only the already loaded series.
// No services, storage, financial mutations or extra history requests.
(function () {
  'use strict';
  const states = new WeakMap();
  const live = new Set();
  const money = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  const rate = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const short = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });
  const months = ['','январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const numeric = v => (typeof v === 'number' || typeof v === 'string' && v.trim() !== '') && Number.isFinite(Number(v)) ? Number(v) : null;
  const key = row => `${row.year}-${Number(row.month)}`;
  const format = (value, unit, compact = false) => value == null ? '—' : `${unit === '%' ? rate.format(value) : (compact ? short : money).format(value)}${unit === '%' ? '%' : ' '+unit}`;
  const total = values => values.length && values.every(v=>v!=null) ? values.reduce((a,b)=>a+b,0) : null;

  function model(rows, metricKey, metric, selected, now = new Date()) {
    const values = rows.map(row=>numeric(row[metricKey]));
    const byMonth = new Map(rows.map(row=>[key(row),row]));
    const periodRate = () => {
      const base = metricKey === 'drrOrders' ? 'orders' : 'sales';
      // A weighted monthly rate is exact only when every monthly denominator
      // is known and positive. Never average rates or drop a zero-base month.
      const bases = rows.map(row=>numeric(row[base]));
      if (!values.length || values.some(v=>v==null) || bases.some(v=>v==null || v<=0)) return null;
      return values.reduce((sum,value,i)=>sum+value*bases[i],0)/bases.reduce((a,b)=>a+b,0);
    };
    const summary = metric.unit === '%' ? periodRate() : total(values);
    const known = values.filter(v=>v!=null);
    const average = metric.unit === '%' ? summary : known.length ? known.reduce((a,b)=>a+b,0)/known.length : null;
    let initial = rows.findIndex(row=>key(row)===selected);
    if(initial<0) initial = values.findLastIndex(v=>v!=null);
    if(initial<0 && rows.length) initial=rows.length-1;
    return { rows, values, initial, summary, average, metric, metricKey,
      detail(index) {
        const row=rows[index]; if(!row)return null;
        const date=new Date(Number(row.year),Number(row.month)-2,1);
        const prior=byMonth.get(`${date.getFullYear()}-${date.getMonth()+1}`);
        const previous=numeric(prior?.[metricKey]);
        const value=values[index];
        const partial=Number(row.year)===now.getFullYear() && Number(row.month)===now.getMonth()+1;
        let delta=null;
        if(!partial && value!=null && previous!=null && (metric.unit==='%' || previous!==0)) delta=metric.unit==='%' ? value-previous : (value-previous)/Math.abs(previous)*100;
        const inverse=['internalAds','mediaAds','drrOrders','drrSales'].includes(metricKey);
        const sentiment=delta==null || delta===0 || metricKey==='promo' ? 'neutral' : (delta>0)!==inverse ? 'up' : 'down';
        const secondary=metricKey==='quantity' ? numeric(row.sales) : numeric(row.quantity);
        return { index, month:`${months[Number(row.month)]} ${row.year}`, value, secondary,
          secondaryLabel:metricKey==='quantity'?'Сумма продаж':'Выкупили',secondaryUnit:metricKey==='quantity'?'₽':'шт.',
          comparisonLabel:partial?'Месяц не закрыт':'К пред. месяцу',delta,sentiment,
          deltaText:delta==null?'—':`${delta>0?'+':delta<0?'−':''}${rate.format(Math.abs(delta))}${metric.unit==='%'?' п.п.':'%'}` };
      },
    };
  }

  function dispose(chart) {
    const state=states.get(chart); if(!state)return;
    if(state.frame) cancelAnimationFrame(state.frame);
    state.root.remove();state.summary.remove();live.delete(state);states.delete(chart);
    state.chart.canvas.parentElement?.classList.remove('has-trend-interaction');
  }

  function mount(chart) {
    const canvas=chart.canvas,parent=canvas.parentElement;
    if(!parent)return null;
    const root=document.createElement('div');root.className='trend-interaction';
    root.innerHTML='<div class="trend-average" hidden><span></span></div><div class="trend-highlight" hidden><i class="trend-highlight-cap"></i></div><div class="trend-months" role="group" aria-label="Месяцы графика: используйте стрелки"></div><div class="trend-tooltip" aria-hidden="true" hidden><p class="trend-tooltip-month"></p><dl><div><dt class="trend-tooltip-metric"></dt><dd data-tip-value></dd></div><div><dt class="trend-tooltip-secondary"></dt><dd data-tip-secondary></dd></div><div><dt class="trend-tooltip-comparison"></dt><dd data-tip-delta></dd></div></dl></div>';
    const summary=document.createElement('span');summary.className='trend-period-summary';
    const heading=canvas.closest('#secTrend')?.querySelector('.section-head');
    heading?.append(summary);
    parent.append(root);parent.classList.add('has-trend-interaction');
    const state={chart,root,summary,plot:root.querySelector('.trend-months'),mark:root.querySelector('.trend-highlight'),cap:root.querySelector('.trend-highlight-cap'),tip:root.querySelector('.trend-tooltip'),guide:root.querySelector('.trend-average'),buttons:[],active:-1,frame:0,visual:[null,null,null],geometry:'',source:null};
    state.values=[root.querySelector('[data-tip-value]'),root.querySelector('[data-tip-secondary]'),root.querySelector('[data-tip-delta]')];
    const readIndex=event=>{const button=event.target.closest?.('[data-trend-index]');return button && state.plot.contains(button)?Number(button.dataset.trendIndex):null;};
    state.plot.addEventListener('pointermove',event=>{const index=readIndex(event);if(index!=null)choose(state,index);});
    state.plot.addEventListener('click',event=>{const index=readIndex(event);if(index!=null)choose(state,index);});
    state.plot.addEventListener('focusin',event=>{const index=readIndex(event);if(index!=null)choose(state,index);});
    state.plot.addEventListener('pointerleave',()=>choose(state,state.model.initial));
    state.plot.addEventListener('focusout',event=>{if(!state.plot.contains(event.relatedTarget))choose(state,state.model.initial);});
    state.plot.addEventListener('keydown',event=>{
      const index=readIndex(event);if(index==null)return;
      if(event.key==='Escape'){event.preventDefault();choose(state,state.model.initial);state.buttons[state.model.initial]?.focus({preventScroll:true});return;}
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      const next=event.key==='Home'?0:event.key==='End'?state.buttons.length-1:Math.max(0,Math.min(state.buttons.length-1,index+(event.key==='ArrowRight'?1:-1)));
      state.buttons[next]?.focus({preventScroll:true});
    });
    states.set(chart,state);live.add(state);return state;
  }

  function numbers(state, detail, animate) {
    if(state.frame)cancelAnimationFrame(state.frame);state.frame=0;
    const targets=[detail.value,detail.secondary,detail.delta];
    const starts=state.visual.slice();
    const print=values=>{
      state.visual=values;
      state.values[0].textContent=format(values[0],state.model.metric.unit);
      state.values[1].textContent=format(values[1],detail.secondaryUnit);
      const delta=values[2];
      state.values[2].textContent=delta==null?'—':`${delta>.049?'+':delta<-.049?'−':''}${rate.format(Math.abs(delta))}${state.model.metric.unit==='%'?' п.п.':'%'}`;
    };
    if(!animate || reduced() || document.hidden || starts.every((v,i)=>v===targets[i])){print(targets);return;}
    const begin=performance.now();
    const step=time=>{
      const progress=Math.min(1,Math.max(0,(time-begin)/450)),ease=1-Math.pow(1-progress,4);
      print(targets.map((value,i)=>value==null || starts[i]==null ? value : starts[i]+(value-starts[i])*ease));
      state.frame=progress<1?requestAnimationFrame(step):0;
    };
    state.frame=requestAnimationFrame(step);
  }

  function position(state) {
    const {chart,model,mark,cap,tip}=state,area=chart.chartArea,detail=model.detail(state.active);
    if(!detail || !area)return;
    const x=chart.scales.x.getPixelForValue(state.active),y=detail.value==null?null:chart.scales.y.getPixelForValue(detail.value),zero=chart.scales.y.getPixelForValue(0);
    const pitch=(area.right-area.left)/Math.max(model.rows.length,1);
    const isBar=chart.config.type==='bar',width=isBar?Math.min(30,pitch*.66):10;
    mark.hidden=y==null;
    mark.classList.toggle('is-point',!isBar);mark.classList.toggle('is-negative',detail.value<0);
    if(y!=null){
      // Only an isolated overlay changes height; chart/page layout never moves.
      const height=isBar?Math.max(2,Math.abs(zero-y)):10,top=isBar?Math.min(y,zero):y-5;
      Object.assign(mark.style,{width:`${width}px`,height:`${height}px`,transform:`translate(${x-width/2}px,${top}px)`});
      cap.hidden=!isBar || height<24;
    }
    const tipWidth=tip.offsetWidth;
    const left=Math.max(4,Math.min(x-tipWidth/2,chart.width-tipWidth-4));
    tip.style.transform=`translate(${left}px,${Math.max(0,area.top-10)}px)`;
  }

  function choose(state,index,snap=false) {
    const detail=state.model?.detail(index);if(!detail)return;
    if(state.active===index && !snap)return;
    const first=state.active<0;state.active=index;
    state.buttons.forEach((button,i)=>{button.classList.toggle('is-active',i===index);button.tabIndex=i===index?0:-1;button.setAttribute('aria-pressed',String(i===index));});
    state.tip.hidden=false;
    state.tip.querySelector('.trend-tooltip-month').textContent=detail.month;
    state.tip.querySelector('.trend-tooltip-metric').textContent=state.model.metric.label;
    state.tip.querySelector('.trend-tooltip-secondary').textContent=detail.secondaryLabel;
    state.tip.querySelector('.trend-tooltip-comparison').textContent=detail.comparisonLabel;
    state.values[2].dataset.sentiment=detail.sentiment;
    numbers(state,detail,!snap&&!first);
    state.root.classList.toggle('is-instant',snap||first||reduced());
    position(state);
  }

  function sync(chart,force=false) {
    const ds=chart.data.datasets[0],rows=ds?.sellerRows;
    if(!rows || !chart.chartArea || !chart.scales.x || !chart.scales.y)return;
    let state=states.get(chart);if(!state)state=mount(chart);if(!state)return;
    const area=chart.chartArea;
    if(!rows.length || area.right<=area.left || area.bottom<=area.top){state.root.hidden=true;state.summary.textContent='';state.active=-1;if(state.frame)cancelAnimationFrame(state.frame);state.frame=0;return;}
    const selected=document.getElementById('periodSelect')?.value || '';
    const changed=state.active<0 || state.dataset!==ds || state.source!==rows || state.metricKey!==ds.sellerMetric || state.selected!==selected || state.type!==chart.config.type;
    const geometry=[chart.width,chart.height,area.left,area.right,area.top,area.bottom,chart.scales.y.min,chart.scales.y.max].join(':');
    // Canvas entrance frames must not trigger DOM writes or number animations.
    if(!changed && !force && geometry===state.geometry)return;
    state.root.hidden=false;
    if(changed){
      state.dataset=ds;state.source=rows;state.metricKey=ds.sellerMetric;state.selected=selected;state.type=chart.config.type;
      state.model=model(rows,ds.sellerMetric,window.WBDashboard.getTrendMetric(ds.sellerMetric,ds.sellerMarketplace),selected);
      if(state.frame)cancelAnimationFrame(state.frame);state.frame=0;state.visual=[null,null,null];state.active=-1;
      state.plot.replaceChildren();state.buttons=rows.map((row,i)=>{
        const button=document.createElement('button');button.type='button';button.className='trend-month';button.dataset.trendIndex=String(i);
        const detail=state.model.detail(i);button.setAttribute('aria-label',`${detail.month}: ${state.model.metric.label} ${format(detail.value,state.model.metric.unit)}; ${detail.secondaryLabel} ${format(detail.secondary,detail.secondaryUnit)}; ${detail.comparisonLabel} ${detail.deltaText}`);
        const label=document.createElement('span');label.dataset.month=months[Number(row.month)].slice(0,3);label.textContent=`${label.dataset.month} ${String(row.year).slice(-2)}`;button.append(label);state.plot.append(button);return button;
      });
      state.geometry='';
    }
    state.model.metric.color=window.WBDashboard.getTrendMetric(ds.sellerMetric,ds.sellerMarketplace).color;
    state.root.style.setProperty('--trend-color',state.model.metric.color);
    state.summary.textContent=`${format(state.model.summary,state.model.metric.unit,true)} ${state.model.metric.unit==='%'?'за период':`за ${rows.length} мес.`}`;
    state.summary.title=`${state.model.metric.label}: ${format(state.model.summary,state.model.metric.unit)}. ${state.model.detail(0).month} — ${state.model.detail(rows.length-1).month}. Неизвестные месячные суммы не подменяются нулём.`;
    if(changed || force || geometry!==state.geometry){
      state.geometry=geometry;
      Object.assign(state.plot.style,{left:`${area.left}px`,top:`${area.top}px`,width:`${area.right-area.left}px`,height:`${area.bottom-area.top}px`,gridTemplateColumns:`repeat(${rows.length},minmax(0,1fr))`});
      state.plot.style.setProperty('--plot-height',`${area.bottom-area.top}px`);
      state.buttons.forEach((button,i)=>{
        const x=chart.scales.x.getPixelForValue(i),before=i?chart.scales.x.getPixelForValue(i-1):null,after=i<rows.length-1?chart.scales.x.getPixelForValue(i+1):null;
        const left=before==null?area.left:(before+x)/2,right=after==null?area.right:(after+x)/2;
        Object.assign(button.style,{left:`${left-area.left}px`,width:`${right-left}px`});
        button.style.setProperty('--month-x',`${x-left}px`);
      });
      state.guide.hidden=state.model.average==null;
      if(state.model.average!=null){
        const y=chart.scales.y.getPixelForValue(state.model.average);
        Object.assign(state.guide.style,{left:`${area.left}px`,width:`${area.right-area.left}px`,transform:`translateY(${y}px)`});
        state.guide.querySelector('span').textContent=`${state.model.metric.unit==='%'?'ДРР периода':'ср.'} ${format(state.model.average,state.model.metric.unit,true)}`;
        state.guide.title=state.model.metric.unit==='%'?'ДРР взвешен по суммам заказов или продаж':'Среднее по месяцам с известным значением';
      }
    }
    if(changed)choose(state,state.model.initial,true);else position(state);
  }

  const plugin={id:'seller-trend-interaction',afterUpdate:chart=>sync(chart,true),afterDraw:chart=>sync(chart),afterDestroy:dispose};
  window.WBTrend={plugin,model,format,numeric};
  document.addEventListener?.('visibilitychange',()=>{if(document.hidden)for(const state of live)choose(state,state.active,true);});
  const preference=window.matchMedia('(prefers-reduced-motion: reduce)');
  preference.addEventListener?.('change',()=>{for(const state of live)choose(state,state.active,true);});
})();
