(function(){
  'use strict';
  const $=id=>document.getElementById(id),sample=window.WBDemo.sample,money=n=>(n/100).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽',number=n=>n.toLocaleString('ru-RU');
  const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let metric='sales',chart=null,active=false,result=null;
  const defaultMonth=sample.key(sample.periods.at(-2));
  $('demoPromoFrom').value=defaultMonth+'-01';$('demoPromoTo').value=sample.end(defaultMonth);
  $('demoPromoFrom').min=sample.key(sample.available()[0])+'-01';$('demoPromoTo').max=sample.today;
  const picker=window.WBDateRange.create({prefix:'demoPromoRange',from:$('demoPromoFrom'),to:$('demoPromoTo'),trigger:$('demoPromoToggle'),onApply:render});
  function table(){
    const q=$('demoPromoSearch').value.trim().toLowerCase(),rows=result.rows.filter(r=>`${r.name} ${r.code} ${r.id}`.toLowerCase().includes(q));
    $('demoPromoCount').textContent=rows.length;
    $('demoPromoRows').innerHTML=rows.map(r=>`<tr><td><strong>${safe(r.name)}</strong><small>${safe(r.code)} · ID: ${safe(r.id)}</small></td><td data-label="Выкуплено">${number(r.quantity)} шт.</td><td data-label="Сумма выкупов">${money(r.sales)}</td><td data-label="Возвраты">${money(r.returns)}</td><td data-label="После возвратов"><strong>${money(r.net)}</strong></td></tr>`).join('')||'<tr><td colspan="5" class="demo-empty-cell">Промокоды не найдены</td></tr>';
  }
  function draw(){
    chart?.destroy();chart=null;if(!active||!window.Chart)return;
    const rows=sample.available().map(p=>{const m=sample.key(p),d=sample.promos(m+'-01',sample.end(m));return {...p,...d.totals};});
    const isQty=metric==='quantity'||metric==='active',values=rows.map(r=>r[metric]/(isQty?1:100)),labels=rows.map(r=>new Date(Date.UTC(r.year,r.month-1,1)).toLocaleDateString('ru-RU',{month:'short'}));
    const color=getComputedStyle(document.body).getPropertyValue('--accent').trim(),label=metric==='active'?'Промокодов с выкупами':isQty?'Выкуплено товаров':metric==='net'?'После возвратов':'Сумма выкупов',canvas=$('demoPromoChart');
    const model={rows,values,labels,metric:{label,unit:metric==='active'?'промокода':isQty?'шт.':'₽',color},metricKey:'demo-promos-'+metric,initial:Math.max(0,rows.findIndex(r=>sample.key(r)===$('demoPromoTo').value.slice(0,7))),average:values.reduce((a,b)=>a+b,0)/values.length,summary:metric==='active'?Math.max(...values):values.reduce((a,b)=>a+b,0),summaryText:'12 месяцев · демонстрационные данные',summaryTitle:'Вымышленная история промокодов за 12 месяцев. Текущий месяц неполный.',axisLabel:'Месяцы промокодов: используйте стрелки',
      detail(i){const r=rows[i],before=rows[i-1],delta=sample.key(r)!==sample.current&&before?.[metric]?((r[metric]-before[metric])/Math.abs(before[metric])*100):null;return {month:new Date(Date.UTC(r.year,r.month-1,1)).toLocaleDateString('ru-RU',{month:'long',year:'numeric'}),value:values[i],secondary:isQty?r.sales/100:r.quantity,secondaryLabel:isQty?'Сумма выкупов':'Выкуплено товаров',secondaryUnit:isQty?'₽':'шт.',comparisonLabel:sample.key(r)===sample.current?'Месяц не закрыт':'К пред. месяцу',delta,deltaText:delta==null?'—':`${delta>0?'+':delta<0?'−':''}${Math.abs(delta).toLocaleString('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1})}%`,sentiment:delta==null||delta===0?'neutral':delta>0?'up':'down',note:sample.key(r)===sample.current?'Текущий месяц · неполный период':''};}};
    $('demoPromoChartValues').textContent=rows.map((r,i)=>`${labels[i]}: ${isQty?number(r[metric]):money(r[metric])}`).join('; ');
    chart=new Chart(canvas,{type:'bar',plugins:window.WBTrend?[window.WBTrend.plugin]:[],data:{labels,datasets:[{label,data:values,sellerInteraction:model,backgroundColor:WBDashboard.trendBarColors(canvas,rows.map(r=>({...r,sales:r[metric]/(isQty?1:100)})),color,'sales'),borderRadius:99,borderWidth:0,maxBarThickness:30}]},options:{responsive:true,maintainAspectRatio:false,events:[],animation:matchMedia('(prefers-reduced-motion: reduce)').matches?false:{duration:700,easing:'easeOutCubic'},plugins:{legend:{display:false},tooltip:{enabled:false}},scales:{x:{ticks:{color:'transparent'},grid:{display:false},border:{display:false}},y:{beginAtZero:true,border:{display:false,dash:[3,3]},grid:{color:getComputedStyle(document.body).getPropertyValue('--chart-grid').trim()},ticks:{maxTicksLimit:5,callback:v=>Number(v).toLocaleString('ru-RU',{notation:'compact'})+(isQty?'':' ₽')}}}}});
  }
  function render(){
    const from=$('demoPromoFrom').value,to=$('demoPromoTo').value;result=sample.promos(from,to);
    const previous=window.WBDayRange.previous(from,to),before=previous.dateFrom>=sample.key(sample.periods[0])+'-01'?sample.promos(previous.dateFrom,previous.dateTo):null;
    $('demoPromoKpis').innerHTML=[['active','Промокодов с выкупами'],['quantity','Выкуплено товаров'],['sales','Сумма выкупов'],['net','После возвратов']].map(([k,label])=>{
      const a=result.totals[k],b=before?.totals[k],diff=b?((a-b)/Math.abs(b)*100):null;
      return `<button type="button" class="demo-stat" data-demo-promo-metric="${k}" aria-pressed="${metric===k}"><span>${label}</span><strong title="${k==='sales'||k==='net'?money(a):number(a)}">${k==='sales'||k==='net'?money(a):number(a)}</strong><small>${diff==null?'Нет сравнения':`${diff>=0?'+':''}${diff.toLocaleString('ru-RU',{maximumFractionDigits:1})}% к предыдущему периоду`}</small></button>`;
    }).join('');
    $('demoPromoComparison').textContent=before?`Сравнение с ${previous.dateFrom.split('-').reverse().join('.')} — ${previous.dateTo.split('-').reverse().join('.')}. Суммы в ценах покупателя.`:'Предыдущий период выходит за пределы примера.';
    table();draw();
  }
  $('demoPromoKpis').addEventListener('click',e=>{const b=e.target.closest('[data-demo-promo-metric]');if(!b)return;metric=b.dataset.demoPromoMetric;$('demoPromoMetric').value=metric;render();});
  $('demoPromoMetric').addEventListener('change',()=>{metric=$('demoPromoMetric').value;render();});
  $('demoPromoSearch').addEventListener('input',()=>{if(result)table();});
  window.addEventListener('seller:themechange',()=>{if(active)draw();});
  window.WBDemoPromos={setActive(value){active=value;if(active)render();else{picker.close(false);chart?.destroy();chart=null;}}};
})();
