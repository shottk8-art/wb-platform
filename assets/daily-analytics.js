(function () {
  const SHOP='853b81a0-e0e2-4195-bc80-1cdc362af946',OWNER='bbb002c4-cd7a-490d-b9c0-72aed5424261';
  const el=id=>document.getElementById(id);
  if(!el('secDailyAnalytics'))return;
  const allowed=(userId,shopId)=>userId===OWNER && shopId===SHOP;
  const money=value=>value==null?'—':Number(value).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
  const dateLabel=date=>date==='unallocated'?'Без даты операции':new Date(date+'T12:00:00Z').toLocaleDateString('ru-RU',{day:'numeric',month:'long',timeZone:'UTC'});
  const safe=text=>String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const currentMonth=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,7);
  let context=null,active=false,epoch=0,ticket=0,timer=null,busy=false,data=null,chart=null,selected=null,mode='daily';
  const tone=value=>value==null?'':Number(value)<0?'loss':'gain';
  const changeMarkup=change=>{
    if(!change)return '<span class="daily-change">—</span>';
    const value=Number(change.amount),direction=value>0?'up':value<0?'down':'flat';
    const percent=change.percent==null?'':` · ${change.percent>0?'+':''}${Number(change.percent).toLocaleString('ru-RU',{maximumFractionDigits:1})}%`;
    return `<span class="daily-change" data-direction="${direction}"><span>${value>0?'+':''}${safe(money(change.amount))}</span>${percent?`<span>${safe(percent)}</span>`:''}</span>`;
  };
  function reset() {
    clearTimeout(timer);data=null;selected=null;chart?.destroy();chart=null;
    el('dailyProfit').textContent=el('dailyAverage').textContent=el('dailyPositive').textContent='—';
    el('dailyProfit').removeAttribute('data-tone');
    el('dailyRows').replaceChildren();el('dailyDetails').replaceChildren();el('dailyChartValues').textContent='';
    el('dailyDetailProfit').textContent='—';el('dailyDetailTitle').textContent='Расходы за день';
    for(const id of ['dailyProfitChange','dailyAverageChange','dailyPositiveChange','dailyComparisonInfo','dailyDetailChange'])el(id).textContent='';
    el('dailyPrepareComparison').hidden=true;
    el('dailyPreviousLegend').hidden=true;
    status('');
    el('dailyResults').hidden=true;el('dailyUnallocated').hidden=true;el('dailyUnallocated').textContent='';
  }
  function fillMonths() {
    const now=new Date(Date.now()+3*3600000),dates=Array.from({length:12},(_,i)=>new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-i,1)));
    el('dailyMonth').innerHTML=dates.map(d=>`<option value="${d.toISOString().slice(0,7)}">${safe(d.toLocaleDateString('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}))}</option>`).join('');
    el('dailyMonth').value=currentMonth();
  }
  function status(text,error=false) {
    el('dailyStatus').textContent=text;el('dailyStatus').dataset.error=String(error);
  }
  function selectDay(date,focusChart=false) {
    const row=date==='unallocated'?data?.unallocated:data?.days?.find(d=>d.date===date);
    if(!row)return;
    selected=date;
    el('dailyDetailTitle').textContent='Расходы · '+dateLabel(date);
    const expenses=(row.expenses||[]).filter(e=>e.amount==null || Number(e.amount)!==0);
    el('dailyDetails').innerHTML=expenses.length?expenses.map(e=>`<div><dt>${safe(e.label)}${e.allocated?'<span class="daily-allocation-label">распределено</span>':''}</dt><dd>${safe(money(e.amount))}</dd></div>`).join(''):'<p class="hint">В полученных данных нет расходов за этот день.</p>';
    el('dailyDetailProfit').textContent=money(row.net_profit);el('dailyDetailProfit').dataset.tone=tone(row.net_profit);
    el('dailyDetailChange').innerHTML=row.previous_day?changeMarkup(row.previous_day.change)+' <span class="daily-note">к предыдущему дню</span>':'';
    el('dailyMissing').hidden=!row.missing?.length;
    el('dailyMissing').textContent=(row.missing||[]).join('. ')+(row.missing_costs?.length?' · '+row.missing_costs.join(', '):'');
    el('dailyNoOperations').hidden=!!row.rows;
    for(const button of el('dailyRows').querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.dailyDate===date));
    if(focusChart && chart && date!=='unallocated') {
      const index=data.days.findIndex(d=>d.date===date),point=chart.getDatasetMeta(0).data[index];
      if(point){chart.setActiveElements([{datasetIndex:0,index}]);chart.tooltip.setActiveElements([{datasetIndex:0,index}],{x:point.x,y:point.y});chart.update('none');}
    }
  }
  function drawChart() {
    if(!data?.days?.length || !window.Chart)return;
    chart?.destroy();
    const css=getComputedStyle(document.body),color=name=>css.getPropertyValue(name).trim();
    const cumulative=mode==='cumulative',values=data.days.map(d=>d[cumulative?'cumulative_profit':'net_profit']==null?null:Number(d[cumulative?'cumulative_profit':'net_profit']));
    let previousSum=0,previousKnown=true;
    const previousValues=data.days.map(d=>{
      const value=d.previous_period?.profit;
      if(value==null){previousKnown=false;return null;}
      if(!cumulative)return Number(value);
      previousSum+=Number(value);return previousKnown?previousSum:null;
    });
    const datasets=[{
      label:cumulative?'Накопленная прибыль':'Чистая прибыль',data:values,borderColor:color('--accent'),backgroundColor:color('--accent-soft'),
      borderWidth:2.5,tension:.25,fill:'origin',spanGaps:false,pointRadius:2,pointHoverRadius:5,pointBackgroundColor:color('--surface'),pointBorderWidth:2,
    }];
    if(previousValues.some(v=>v!=null))datasets.push({label:'Предыдущий месяц',data:previousValues,borderColor:color('--violet'),backgroundColor:'transparent',borderWidth:2,borderDash:[5,5],tension:.25,fill:false,spanGaps:false,pointRadius:1.5,pointHoverRadius:4,pointBorderWidth:1});
    chart=new window.Chart(el('dailyChart'),{
      type:'line',data:{labels:data.days.map(d=>Number(d.date.slice(-2))),datasets},
      options:{responsive:true,maintainAspectRatio:false,animation:matchMedia('(prefers-reduced-motion: reduce)').matches?false:{duration:550},
        interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{
          backgroundColor:color('--ink'),titleColor:color('--surface'),bodyColor:color('--surface'),padding:12,cornerRadius:12,displayColors:false,
          callbacks:{title:items=>dateLabel(data.days[items[0].dataIndex].date),label:item=>`${item.datasetIndex===1?'Предыдущий месяц':cumulative?'Накоплено':'Чистая прибыль'}: ${money(item.raw)}`,
            afterBody:items=>{const row=data.days[items[0].dataIndex];return ['Продажи: '+money(row.sales),'Учтённые расходы: '+money(row.net_profit==null||row.sales==null?null:Number(row.sales)-Number(row.net_profit)),...(row.previous_period?.date?['Сравнение: '+dateLabel(row.previous_period.date)]:[])];}},
        }},scales:{x:{grid:{display:false},border:{display:false},ticks:{maxTicksLimit:12,color:color('--ink-mute')}},
          y:{border:{display:false},grid:{color:color('--line')},ticks:{color:color('--ink-mute'),maxTicksLimit:6,callback:v=>Number(v).toLocaleString('ru-RU',{notation:'compact',maximumFractionDigits:1})+' ₽'}}},
        onHover:(_event,items)=>{if(items.length)selectDay(data.days[items[0].index].date);},
      },
    });
    el('dailyChart').setAttribute('aria-label',cumulative?'Накопленная чистая прибыль по дням':'Ежедневная чистая прибыль');
    el('dailyChartValues').textContent=data.days.map((d,i)=>`${dateLabel(d.date)}: ${money(values[i])}; предыдущий месяц: ${money(previousValues[i])}`).join('; ');
  }
  function render(result) {
    data=result;
    el('dailyPreviousLegend').hidden=!(result.days||[]).some(day=>day.previous_period?.profit!=null);
    const ready=result.status==='ready';
    el('dailyResults').hidden=!ready;
    el('dailyRefresh').textContent=ready?'Обновить данные':result.status==='loading'?'Данные загружаются':'Подготовить по дням';
    el('dailyRefresh').disabled=busy || result.refreshing || result.status==='loading';
    if(!ready){status(result.status==='loading'?'Собираем ежедневные данные на сервере. Можно закрыть страницу.':result.refresh_error || 'За этот месяц сохранены только месячные итоги. Нажмите «Подготовить по дням» — загрузка продолжится в фоне.',!!result.refresh_error);return;}
    const known=result.days.every(d=>d.net_profit!=null),sum=result.days.reduce((n,d)=>n+Number(d.net_profit||0),0);
    el('dailyProfit').textContent=money(result.monthly_profit);el('dailyProfit').dataset.tone=tone(result.monthly_profit);
    el('dailyAverage').textContent=money(known?sum/result.days.length:null);
    el('dailyPositive').textContent=known?`${result.days.filter(d=>Number(d.net_profit)>0).length} из ${result.days.length}`:'—';
    const comparison=result.comparison;
    const comparable=comparison?.status==='ready';
    el('dailyAverageChange').textContent='';el('dailyPositiveChange').textContent='';
    el('dailyProfitChange').innerHTML=comparable?changeMarkup(comparison.change):'';
    if(comparable && known && comparison.average!=null) {
      const average=sum/result.days.length,prior=Number(comparison.average);
      el('dailyAverageChange').innerHTML=changeMarkup({amount:average-prior,percent:prior===0?null:(average-prior)/Math.abs(prior)*100});
    }
    if(comparable && known && comparison.positive_days!=null) {
      const diff=result.days.filter(d=>Number(d.net_profit)>0).length-comparison.positive_days;
      el('dailyPositiveChange').innerHTML=`<span class="daily-change" data-direction="${diff>0?'up':diff<0?'down':'flat'}">${diff>0?'+':''}${diff} дн.</span>`;
    }
    const preparing=comparison?.status==='loading' || comparison?.refreshing;
    el('dailyPrepareComparison').hidden=!['needs_preparation','loading'].includes(comparison?.status) && !preparing;
    el('dailyPrepareComparison').disabled=busy || preparing;
    el('dailyPrepareComparison').textContent=preparing?'Сравнение загружается':'Подготовить сравнение';
    el('dailyComparisonInfo').textContent=comparable && comparison.period
      ? comparison.change ? `Сравнение с ${dateLabel(comparison.period.dateFrom)} — ${dateLabel(comparison.period.dateTo)}. Изменение в таблице — к предыдущему дню.`
        : 'Недостаточно данных для сравнения итогов предыдущего периода. Доступные дни показаны на графике.'
      : preparing?'Предыдущий период загружается на сервере. Текущие данные доступны.'
        : comparison?.status==='needs_preparation'?'Для сравнения нужно подготовить ежедневные данные предыдущего месяца.'
          : comparison?.error?'Сравнение недоступно: '+comparison.error:'';
    const updated=result.updated_at?new Date(result.updated_at).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Moscow'}):'';
    status(result.refresh_error?'Не удалось обновить данные: '+result.refresh_error+'. Показана предыдущая готовая выгрузка.':result.refreshing?'Обновление идёт в фоне. Пока показана предыдущая готовая выгрузка.':`По данным WB${updated?' от '+updated+' (МСК)':''}. ${result.period.dateFrom.slice(0,7)===currentMonth()?'Текущий месяц предварительный.':''}`,!!result.refresh_error);
    el('dailyRows').innerHTML=result.days.map(row=>`<tr><th scope="row"><button type="button" data-daily-date="${row.date}" aria-pressed="false">${safe(dateLabel(row.date))}</button></th><td data-label="Продажи">${safe(money(row.sales))}</td><td data-label="Учтённые расходы">${safe(money(row.net_profit==null||row.sales==null?null:Number(row.sales)-Number(row.net_profit)))}</td><td data-label="Чистая прибыль" data-tone="${tone(row.net_profit)}">${safe(money(row.net_profit))}<small class="daily-row-change">${changeMarkup(row.previous_day?.change)}</small></td></tr>`).join('');
    if(result.unallocated) {
      el('dailyUnallocated').hidden=false;
      el('dailyUnallocated').innerHTML=`<p>В месячном итоге есть операции без даты внутри периода: ${safe(money(result.unallocated.net_profit))} чистой прибыли. Они не нанесены на график.</p><button type="button" class="ghost small" data-unallocated>Посмотреть расходы</button>`;
    }
    drawChart();
    selectDay(result.days.some(d=>d.date===selected)?selected:[...result.days].reverse().find(d=>d.rows)?.date || result.days[result.days.length-1].date);
  }
  function schedule() {
    clearTimeout(timer);
    if(active && !document.hidden && (data?.refreshing || data?.status==='loading' || data?.comparison?.refreshing || data?.comparison?.status==='loading'))timer=setTimeout(()=>load(false,true),30000);
  }
  async function load(refresh=false,background=false,comparisonMonth=null) {
    if(!active || !context?.allowed || busy)return;
    const ownEpoch=epoch,ownTicket=++ticket,month=el('dailyMonth').value;
    busy=true;el('secDailyAnalytics').setAttribute('aria-busy','true');el('dailyRefresh').disabled=true;
    if(!background){reset();status(refresh||comparisonMonth?'Ставим обновление в очередь сервера…':'Загружаем ежедневную аналитику…');}
    try {
      if(refresh || comparisonMonth)await window.WBApi.cabinet('daily_start',comparisonMonth||month);
      if(ownEpoch!==epoch || ownTicket!==ticket)return;
      const result=await window.WBApi.cabinet('daily',month);
      if(ownEpoch!==epoch || ownTicket!==ticket)return;
      busy=false;render(result);
    } catch(error) {
      if(ownEpoch!==epoch || ownTicket!==ticket)return;
      reset();status(error.message || 'Не удалось загрузить аналитику. Повторите попытку.',true);
      el('dailyRefresh').textContent='Повторить загрузку';
    } finally {
      if(ownEpoch===epoch && ownTicket===ticket){busy=false;el('secDailyAnalytics').setAttribute('aria-busy','false');el('dailyRefresh').disabled=!!(data?.refreshing || data?.status==='loading');schedule();}
    }
  }
  function setContext(next) {
    const enabled=allowed(next.userId,next.shopId);
    const changed=context?.shopId!==next.shopId || context?.userId!==next.userId || context?.allowed!==enabled;
    context={...next,allowed:enabled};el('dailyAnalyticsLink').hidden=!enabled;
    if(changed){epoch++;ticket++;busy=false;reset();fillMonths();}
    const wasActive=active;
    active=enabled && next.active===true;
    if(!active){clearTimeout(timer);if(wasActive){epoch++;busy=false;reset();}return;}
    if(changed || !wasActive)load();
  }
  el('dailyMonth').addEventListener('change',()=>{epoch++;busy=false;reset();load();});
  el('dailyRefresh').addEventListener('click',()=>load(['needs_preparation','ready'].includes(data?.status)));
  el('dailyPrepareComparison').addEventListener('click',()=>{if(data?.comparison?.month)load(false,false,data.comparison.month);});
  el('dailyMode').addEventListener('click',event=>{
    const button=event.target.closest('[data-daily-mode]');if(!button)return;
    mode=button.dataset.dailyMode;
    for(const node of el('dailyMode').querySelectorAll('button')){const on=node===button;node.classList.toggle('active',on);node.setAttribute('aria-pressed',String(on));}
    drawChart();
  });
  el('dailyRows').addEventListener('click',event=>{const button=event.target.closest('[data-daily-date]');if(button)selectDay(button.dataset.dailyDate,true);});
  el('dailyUnallocated').addEventListener('click',event=>{if(event.target.closest('[data-unallocated]'))selectDay('unallocated');});
  el('dailyChart').addEventListener('pointerleave',()=>{if(chart){chart.setActiveElements([]);chart.tooltip.setActiveElements([],{x:0,y:0});chart.update('none');}});
  window.addEventListener('seller:themechange',drawChart);
  document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(!document.hidden && active && (data?.refreshing || data?.status==='loading' || data?.comparison?.refreshing || data?.comparison?.status==='loading'))load(false,true);});
  window.WBDaily={allowed,setContext,reload:()=>{if(active){epoch++;busy=false;reset();load();}},get active(){return active;}};
})();
