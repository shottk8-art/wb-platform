// Presentation of prepared promo totals only. No fetching or financial writes.
(function(root){
  'use strict';
  const metrics={active_codes:{label:'Промокодов с выкупами',unit:'кодов',delta:'promoCountDelta'},sold_qty:{label:'Выкуплено товаров',unit:'шт.',delta:'promoUnitsDelta'},sold_amount:{label:'Сумма выкупов',unit:'₽',delta:'promoSalesDelta'},net_amount:{label:'После возвратов',unit:'₽',delta:'promoNetDelta'}};
  const number=v=>(typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isFinite(Number(v))?Number(v):null;
  const integer=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}),short=new Intl.NumberFormat('ru-RU',{notation:'compact',maximumFractionDigits:1}),rate=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1});
  function change(now,before){now=number(now);before=number(before);if(now==null||before==null)return null;const amount=now-before;return {amount,percent:before===0?amount===0?0:null:amount/Math.abs(before)*100,direction:amount>0?'up':amount<0?'down':'flat'};}
  const chartReady=root=>typeof root.Chart==='function'&&typeof root.WBDashboard?.trendBarColors==='function'&&!!root.WBTrend?.plugin;
  const range=p=>p?`${p.dateFrom.split('-').reverse().join('.')} — ${p.dateTo.split('-').reverse().join('.')}`:'';
  const monthLabel=row=>new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(row.year,row.month-1,1))).replace(/ г\.$/,'');
  function makeModel(rows,key,metric,selected,summary){
    const values=rows.map(row=>number(row[key])),known=values.filter(v=>v!=null),byMonth=new Map(rows.map(r=>[`${r.year}-${r.month}`,r]));
    let initial=rows.findIndex(row=>`${row.year}-${row.month}`===selected);if(initial<0)initial=values.findLastIndex(v=>v!=null);if(initial<0)initial=Math.max(0,rows.length-1);
    return {rows,values,metric,metricKey:key,selected,initial,labels:rows.map(row=>new Intl.DateTimeFormat('ru-RU',{month:'short',timeZone:'UTC'}).format(new Date(Date.UTC(row.year,row.month-1,1))).replace('.','')),axisLabel:'Месяцы динамики промокодов: используйте стрелки',
      average:known.length?known.reduce((n,v)=>n+v,0)/known.length:null,
      summaryText:summary?.[key]==null?'Часть истории не загружена':`${short.format(Number(summary[key]))} ${metric.unit} за период графика`,summaryTitle:'Итог по всем месяцам графика. Промокоды считаются уникально.',
      detail(index){const row=rows[index];if(!row)return null;const beforeDate=new Date(Date.UTC(row.year,row.month-2,1)),previous=byMonth.get(`${beforeDate.getUTCFullYear()}-${beforeDate.getUTCMonth()+1}`),diff=change(row[key],previous?.[key]);
        const delta=row.partial?null:diff?.percent??null;
        return {month:monthLabel(row),value:values[index],secondary:number(row[key==='sold_qty'?'sold_amount':'sold_qty']),secondaryLabel:key==='sold_qty'?'Сумма выкупов':'Выкуплено товаров',secondaryUnit:key==='sold_qty'?'₽':'шт.',comparisonLabel:row.partial?'Месяц не закрыт':'К пред. месяцу',delta,
          sentiment:delta==null||delta===0?'neutral':delta>0?'up':'down',deltaText:delta==null?'—':`${delta>0?'+':delta<0?'−':''}${rate.format(Math.abs(delta))}%`,
          note:values[index]==null?'Нет полной загрузки финансового отчёта за месяц.':row.partial?'Текущий месяц ещё не завершён.':diff?.percent==null&&number(previous?.[key])===0?'В предыдущем месяце значение было равно 0.':''};},
    };
  }
  if(typeof module==='object'&&module.exports)module.exports={change,makeModel,metrics,chartReady};
  if(!root.document)return;
  const el=id=>root.document.getElementById(id),section=el('secTrend');if(!section)return;
  let data=null,chart=null,key='sold_amount';
  const color=name=>getComputedStyle(root.document.body).getPropertyValue(name).trim();
  const arrow=direction=>`<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="${direction==='up'?'m5 15 5-5 4 4 5-6m0 0h-5m5 0v5':direction==='down'?'m5 9 5 5 4-4 5 6m0 0h-5m5 0v-5':'M5 12h14'}"/></svg>`;
  function compare(){
    const comparison=data.comparison;
    for(const [field,metric] of Object.entries(metrics)){
      const node=el(metric.delta),diff=comparison?.status==='ready'?change(data.metrics?.[field],comparison.metrics?.[field]):null;
      if(!diff){node.textContent='Нет сравнения';node.title='Нет полных данных предыдущего периода';continue;}
      const sign=diff.amount>0?'+':diff.amount<0?'−':'',unit=field==='active_codes'?'':` ${metric.unit}`;
      const amount=field==='active_codes'||field==='sold_qty'?integer.format(Math.abs(diff.amount)):short.format(Math.abs(diff.amount));
      const text=diff.amount===0?'Без изменений':`${sign}${amount}${unit}${diff.percent==null?' · ранее 0':` · ${rate.format(Math.abs(diff.percent))}%`}`;
      node.innerHTML=`<span class="kpi-delta kpi-delta--${diff.direction==='flat'?'flat':diff.direction}">${arrow(diff.direction)}${text}</span>`;
      node.title=`Изменение: ${sign}${Math.abs(diff.amount).toLocaleString('ru-RU',{maximumFractionDigits:2})}${unit}. Было ${Number(comparison.metrics[field]).toLocaleString('ru-RU',{maximumFractionDigits:2})}${unit}.`;
    }
    const dates=range(comparison?.period);
    el('promoComparison').textContent=comparison?.status==='ready'?`Сравнение с ${dates}${comparison.period.basis==='equal_days'?' · столько же дней':''}.`:
      comparison?.status==='outside_history'?`Для сравнения нужен период ${dates}, который находится за пределами доступной истории.`:
        comparison?.status==='loading'||comparison?.refreshing?`Предыдущий период загружается: ${dates}. Текущие показатели доступны.`:`Нет полных данных для сравнения${dates?': '+dates:''}.`;
  }
  function chooseMetric(next,animate=true){
    key=metrics[next]?next:'sold_amount';
    for(const button of root.document.querySelectorAll('[data-promo-metric]'))button.setAttribute('aria-pressed',String(button.dataset.promoMetric===key));
    const select=el('promoTrendMetric');if(select.value!==key){select.value=key;select.dispatchEvent(new Event('change',{bubbles:true}));}
    draw(animate);
  }
  function draw(animate=true){
    if(chart){chart.destroy();chart=null;}
    if(!data?.trend?.rows?.length)return;
    const rows=data.trend.rows,metric={...metrics[key],color:color('--accent'),...(key==='net_amount'?{lossColor:color('--bad')}:{})};
    const selected=data.period.dateTo.slice(0,7).replace(/-0(\d)$/,'-$1');
    const model=makeModel(rows,key,metric,selected,data.trend.metrics),canvas=el('promoTrend');
    el('promoTrendValues').textContent=rows.map((row,i)=>`${monthLabel(row)}: ${model.values[i]==null?'нет данных':integer.format(model.values[i])+' '+metric.unit}`).join('; ');
    canvas.setAttribute('aria-label',metric.label+': помесячная динамика промокодов');
    const ready=chartReady(root),hasValues=model.values.some(v=>v!=null);
    canvas.parentElement.hidden=!ready||!hasValues;
    el('promoTrendFallback').hidden=ready&&hasValues;
    el('promoTrendFallback').textContent=ready?'Для графика нужны полные месячные данные.':'График временно недоступен. Итоги и таблица доступны.';
    if(!ready||!hasValues)return;
    const formatted=rows.map(row=>({...row,sales:number(row[key]),profit:number(row[key])}));
    const reduced=root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    chart=new root.Chart(canvas,{type:'bar',plugins:root.WBTrend?[root.WBTrend.plugin]:[],
      data:{labels:model.labels,datasets:[{label:metric.label,data:model.values,sellerInteraction:model,borderColor:metric.color,backgroundColor:root.WBDashboard.trendBarColors(canvas,formatted,metric.color,key==='net_amount'?'profit':'sales'),borderWidth:0,borderRadius:99,borderSkipped:false,maxBarThickness:30,barPercentage:.66,categoryPercentage:1}]},
      options:{responsive:true,maintainAspectRatio:false,events:[],animation:!animate||reduced?false:{duration:1200,easing:'easeOutCubic',delay:ctx=>ctx.type==='data'&&ctx.mode==='default'?Math.min(ctx.dataIndex*35,385):0},
        plugins:{legend:{display:false},tooltip:{enabled:false}},scales:{x:{offset:true,grid:{display:false},border:{display:false},ticks:{color:'transparent',maxRotation:0}},y:{beginAtZero:true,border:{display:false,dash:[3,3]},grid:{color:color('--chart-grid'),tickLength:0},ticks:{color:color('--ink-mute'),maxTicksLimit:6,precision:key==='active_codes'||key==='sold_qty'?0:undefined,callback:v=>short.format(v)+(metric.unit==='₽'?' ₽':'')}}}},
    });
  }
  function clear(){
    data=null;if(chart){chart.destroy();chart=null;}section.hidden=true;
    for(const metric of Object.values(metrics)){el(metric.delta).replaceChildren();el(metric.delta).title='';}
    el('promoComparison').textContent='';el('promoTrendValues').textContent='';el('promoTrendFallback').hidden=true;
  }
  function render(result){
    data=result;compare();section.hidden=!result.trend?.rows?.length;
    if(!section.hidden){el('promoTrendPeriod').textContent=`Последние 12 месяцев · ${range(result.trend.period)}. Подсказка сравнивает соседние месяцы.`;chooseMetric(key);}
  }
  for(const button of root.document.querySelectorAll('[data-promo-metric]'))button.addEventListener('click',()=>chooseMetric(button.dataset.promoMetric));
  el('promoTrendMetric').addEventListener('change',event=>{if(event.target.value!==key)chooseMetric(event.target.value);});
  root.addEventListener('seller:themechange',()=>{if(data)draw(false);});
  root.matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change',()=>{if(data)draw(false);});
  root.WBPromoCharts={render,clear};
})(typeof window==='undefined'?globalThis:window);
