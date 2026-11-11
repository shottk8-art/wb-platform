(function(){
  'use strict';
  const el=id=>document.getElementById(id);
  if(!el('unitPane'))return;
  const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=value=>value==null?'—':Number(value).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
  const metricMoney=value=>value==null?'—':Number(value).toLocaleString('ru-RU',{maximumFractionDigits:0})+' ₽';
  const rate=value=>value==null?'—':Number(value).toLocaleString('ru-RU',{maximumFractionDigits:1})+'%';
  const tone=value=>value==null?'':Number(value)<0?'loss':'gain';
  let context=null,active=false,epoch=0,busy=false,data=null,selected=null,timer=null,perUnit=false,showZero=false,segment='all',sortDirection='desc';
  let rowAnimations=[],detailAnimation=null;
  function stopMotion(){rowAnimations.forEach(a=>a.cancel());rowAnimations=[];detailAnimation?.cancel();detailAnimation=null;}
  const motionAllowed=()=>!document.hidden && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const segmentNames={all:'Экономика товаров',gain:'Прибыльные товары',loss:'Убыточные товары',ads:'Товары с рекламой',unknown:'Нет расчёта прибыли'};
  const matchesSegment=(p,key)=>key==='all'||key==='gain'&&p.net_profit!=null&&Number(p.net_profit)>0||key==='loss'&&p.net_profit!=null&&Number(p.net_profit)<0||key==='ads'&&p.internal_ads!=null&&Number(p.internal_ads)>0||key==='unknown'&&p.net_profit==null;
  let numberFrame=null;
  function stopCounter(){if(numberFrame!=null)window.cancelAnimationFrame?.(numberFrame);numberFrame=null;}
  function animateStats(result){
    stopCounter();const values=[['unitSales',result.totals.sales,metricMoney],['unitProfit',result.totals.net_profit,metricMoney],['unitAds',result.totals.internal_ads,metricMoney],['unitDrr',result.totals.drr,rate]];
    const settle=()=>values.forEach(([id,v,format])=>el(id).textContent=format(v));
    if(!window.requestAnimationFrame || document.hidden || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){settle();return;}
    let start;const frame=now=>{start??=now;const t=Math.min(1,(now-start)/450),progress=1-Math.pow(1-t,4);values.forEach(([id,v,format])=>el(id).textContent=format(v==null?null:Number(v)*progress));if(t<1)numberFrame=window.requestAnimationFrame(frame);else{numberFrame=null;settle();}};
    numberFrame=window.requestAnimationFrame(frame);
  }
  let cache=new Map(),cacheGeneration=0,subscribed=false;
  const enabled=()=>window.WBDaily?.allowed(context?.userId,context?.shopId)===true;
  function read(from,to,force=false){
    const key=from+':'+to,ownCache=cache,generation=cacheGeneration,entry=ownCache.get(key);
    if(entry?.promise)return entry.promise;
    if(!force && entry?.value && entry.expires>Date.now())return Promise.resolve(entry.value);
    const promise=window.WBApi.cabinet('unit',from,false,{month_to:to}).then(result=>{
      if(cache===ownCache && generation===cacheGeneration && enabled()){
        if(result.status==='ready'){
          const current=new Date(Date.now()+3*3600000).toISOString().slice(0,7);
          ownCache.set(key,{value:result,expires:Date.now()+(to===current?60000:300000)});
          while(ownCache.size>6)ownCache.delete(ownCache.keys().next().value);
        }else ownCache.delete(key);
      }
      return result;
    }).catch(error=>{if(ownCache.get(key)?.promise===promise)ownCache.delete(key);throw error;});
    ownCache.set(key,{promise});return promise;
  }
  function prefetch(){
    if(!enabled() || window.WBApi?.connected!==true)return;
    const now=new Date(Date.now()+3*3600000);
    for(let i=0;i<2;i++){
      const month=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-i,1)).toISOString().slice(0,7);
      read(month,month).catch(()=>{}); // A warm-up failure never blocks the cabinet.
    }
  }
  function invalidate(){cache=new Map();cacheGeneration++;}
  function sourceChanged(){if(!enabled())return;invalidate();cancelLoad();prefetch();if(active)load();}
  const status=(text,error=false)=>{el('unitStatus').textContent=text;el('unitStatus').dataset.error=String(error);};
  function reset(){stopCounter();stopMotion();clearTimeout(timer);data=null;selected=null;el('unitResults').hidden=true;el('unitRows').replaceChildren();el('unitExpenses').replaceChildren();el('unitCommon').replaceChildren();el('unitZeroCosts').hidden=true;el('unitPrepare').hidden=true;for(const id of ['unitSales','unitProfit','unitMargin','unitProfitability','unitAds','unitDrr','unitDetailDrr'])el(id).textContent='—';}
  function cancelLoad(){epoch++;busy=false;reset();el('unitPane').setAttribute('aria-busy','false');el('unitLoad').disabled=el('unitPrepare').disabled=false;}
  function fillMonths(){
    const now=new Date(Date.now()+3*3600000),dates=Array.from({length:12},(_,i)=>new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-i,1)));
    const options=dates.map(d=>`<option value="${d.toISOString().slice(0,7)}">${safe(d.toLocaleDateString('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}))}</option>`).join('');
    for(const id of ['unitFrom','unitTo']){el(id).innerHTML=options;el(id).value=dates[0].toISOString().slice(0,7);}
  }
  function details(article){
    const product=data?.products.find(p=>p.article===article);if(!product)return;
    selected=article;el('unitDetailTitle').textContent=product.name||product.article;el('unitDetailArticle').textContent=product.article;
    el('unitMargin').textContent=rate(product.margin);el('unitProfitability').textContent=rate(product.profitability);el('unitDetailDrr').textContent=rate(product.drr);
    el('unitAdNotice').hidden=!product.advertising_unknown;el('unitAdNotice').textContent=product.advertising_unknown?'WB не позволяет точно отделить денежную рекламу этого товара от промобонусов или не вернул полную привязку. Реклама, ДРР и прибыль показаны прочерком.':'';
    const divisor=perUnit && product.quantity>0?product.quantity:1;
    el('unitUnitNotice').textContent=perUnit?(product.quantity>0?`На единицу · ${product.quantity.toLocaleString('ru-RU')} выкупленных товаров за вычетом возвратов`:'Нет положительного количества выкупов: показаны суммы за период'):'Суммы за выбранный период';
    el('unitExpenses').innerHTML=product.expenses.map(e=>`<div data-zero="${e.amount!=null && Number(e.amount)===0}"><dt>${safe(e.label)}</dt><dd>${safe(money(e.amount==null?null:Number(e.amount)/divisor))}</dd></div>`).join('');
    const zeros=product.expenses.filter(e=>e.amount!=null && Number(e.amount)===0).length;
    el('unitZeroCosts').hidden=!zeros;el('unitZeroCosts').textContent=showZero?'Скрыть нулевые статьи':`Ещё ${zeros} нулевых статей`;
    el('unitExpenses').classList.toggle('show-zero',showZero);el('unitZeroCosts').setAttribute('aria-expanded',String(showZero));
    el('unitDetailSales').textContent=money(product.sales==null?null:Number(product.sales)/divisor);
    el('unitDetailProfit').textContent=money(product.net_profit==null?null:Number(product.net_profit)/divisor);el('unitDetailProfit').dataset.tone=tone(product.net_profit);
    el('unitDetailMissing').hidden=!product.missing_costs;el('unitDetailMissing').textContent=product.missing_costs?'Заполните себестоимость этого артикула — прибыль и проценты пока неизвестны.':'';
    for(const button of el('unitRows').querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.unitArticle===article));
  }
  function table(){
    if(!data)return;
    const previous=new Map([...el('unitRows').querySelectorAll('tr[data-unit-row]')].map(row=>[row.dataset.unitRow,row.getBoundingClientRect().top]));
    rowAnimations.forEach(a=>a.cancel());rowAnimations=[];
    for(const key of Object.keys(segmentNames)){const count=data.products.filter(p=>matchesSegment(p,key)).length;el('unitSegmentCount'+key[0].toUpperCase()+key.slice(1)).textContent=count;}
    el('unitUnknownSegment').hidden=!data.products.some(p=>p.net_profit==null);
    if(segment==='unknown'&&el('unitUnknownSegment').hidden)segment='all';
    for(const b of el('unitSegments').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.unitSegment===segment));
    const query=el('unitSearch').value.trim().toLocaleLowerCase('ru-RU'),sort=el('unitSort').value;
    const rows=data.products.filter(p=>matchesSegment(p,segment)&&(p.article+' '+p.name).toLocaleLowerCase('ru-RU').includes(query)).sort((a,b)=>a[sort]==null?b[sort]==null?a.article.localeCompare(b.article):1:b[sort]==null?-1:(sortDirection==='desc'?1:-1)*(Number(b[sort])-Number(a[sort]))||a.article.localeCompare(b.article));
    el('unitRows').innerHTML=rows.length?rows.map(p=>{
      const initials=(p.name||p.article).split(/\s+/).filter(Boolean).slice(0,2).map(s=>s[0]).join('').toUpperCase();
      const share=Math.max(0,Math.min(100,Number(p.sales)>0 && Number(data.totals.sales)>0?Number(p.sales)/Number(data.totals.sales)*100:0));
      return `<tr data-unit-row="${safe(p.article)}"><th scope="row"><button type="button" data-unit-article="${safe(p.article)}" aria-pressed="${p.article===selected}" aria-controls="unitDetail"><span class="unit-product-mark" aria-hidden="true">${safe(initials)}</span><span class="unit-product-name"><strong>${safe(p.name||p.article)}</strong><span>${safe(p.article)}</span></span></button></th><td data-label="Выкупили" class="unit-extra-col">${p.quantity.toLocaleString('ru-RU')}</td><td data-label="Продажи"><strong>${safe(money(p.sales))}</strong><span class="unit-sales-track" aria-hidden="true"><i style="width:${share}%"></i></span></td><td data-label="Внутренняя реклама">${safe(money(p.internal_ads))}</td><td data-label="ДРР"><span class="unit-rate">${rate(p.drr)}</span></td><td data-label="Прямые расходы" class="unit-extra-col">${safe(money(p.total_expenses))}</td><td data-label="Чистая прибыль" data-tone="${tone(p.net_profit)}"><strong>${safe(money(p.net_profit))}</strong></td><td data-label="Маржинальность" class="unit-extra-col">${rate(p.margin)}</td><td data-label="Рентабельность" class="unit-extra-col">${rate(p.profitability)}</td></tr>`;
    }).join(''):'<tr><td colspan="9" class="unit-empty">Товары не найдены</td></tr>';
    el('unitDetail').hidden=!rows.length;
    if(rows.length&&!rows.some(p=>p.article===selected))details(rows[0].article);
    el('unitSegmentTitle').textContent=segmentNames[segment];el('unitShowing').textContent=rows.length;
    for(const head of el('unitTable').querySelectorAll('[data-unit-sort-head]')){if(head.dataset.unitSortHead===sort)head.setAttribute('aria-sort',sortDirection==='asc'?'ascending':'descending');else head.removeAttribute('aria-sort');}
    if(motionAllowed())for(const row of el('unitRows').querySelectorAll('tr[data-unit-row]')){const before=previous.get(row.dataset.unitRow),bounds=row.getBoundingClientRect();if(bounds.bottom<0||bounds.top>(window.innerHeight||2000))continue;const offset=before==null?6:before-bounds.top;if(Math.abs(offset)>.5){const a=row.animate?.([{opacity:.65,transform:`translateY(${offset}px)`},{opacity:1,transform:'translateY(0)'}],{duration:360,easing:'cubic-bezier(.16,1,.3,1)'});if(a)rowAnimations.push(a);}}
    el('unitCount').textContent=`${rows.length} из ${data.products.length} товаров`;
  }
  function render(result){
    data=result;const ready=result.status==='ready';el('unitResults').hidden=!ready;
    el('unitPrepare').hidden=ready || !(result.pending||[]).some(p=>p.status!=='loading');
    el('unitPrepare').disabled=busy;el('unitLoad').disabled=busy;
    if(!ready){
      const pending=(result.pending||[]).map(p=>p.month).join(', ');
      status(result.status==='loading'?`Данные за ${pending} загружаются на сервере. Можно закрыть страницу.`:`Нужно подготовить расходы по артикулам за ${pending}. Это отдельная обработка финансовой выгрузки.`,!!result.pending?.some(p=>p.error));return;
    }
    el('unitSales').textContent=metricMoney(result.totals.sales);el('unitProfit').textContent=metricMoney(result.totals.net_profit);el('unitProfit').dataset.tone=tone(result.totals.net_profit);
    for(const [id,value] of [['unitSales',result.totals.sales],['unitProfit',result.totals.net_profit],['unitAds',result.totals.internal_ads]])el(id).setAttribute('title',money(value));
    el('unitAds').textContent=metricMoney(result.totals.internal_ads);el('unitDrr').textContent=rate(result.totals.drr);
    animateStats(result);
    const date=value=>new Date(value+'T12:00:00Z').toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).replace(/\s*г\.$/,'');
    const unknown=result.products.filter(p=>p.advertising_unknown).length;
    status(`${date(result.period.dateFrom)} — ${date(result.period.dateTo)}${unknown?' У '+unknown+' товаров нет точного разделения денежной рекламы и бонусов — откройте товар для пояснения.':''}`);
    el('unitCommon').innerHTML=result.common_expenses.filter(e=>e.amount==null || Number(e.amount)!==0).map(e=>`<div><dt>${safe(e.label)}</dt><dd>${safe(money(e.amount))}</dd></div>`).join('')||'<p class="hint">В полученных данных нет общих расходов.</p>';
    el('unitSearch').value=el('unitSearch').value||'';table();
    if(result.products.length)details(result.products.some(p=>p.article===selected)?selected:result.products[0].article);
    else {for(const id of ['unitMargin','unitProfitability','unitDetailDrr'])el(id).textContent='—';el('unitAdNotice').hidden=true;el('unitAdNotice').textContent='';el('unitZeroCosts').hidden=true;el('unitDetailTitle').textContent='Нет операций по артикулам';el('unitDetailArticle').textContent='';el('unitUnitNotice').textContent='';el('unitDetailMissing').textContent='';el('unitDetailMissing').hidden=true;el('unitExpenses').replaceChildren();el('unitDetailSales').textContent=el('unitDetailProfit').textContent='—';}
  }
  el('unitShowAll').addEventListener('click',()=>{const button=el('unitShowAll'),on=button.getAttribute('aria-expanded')!=='true';button.setAttribute('aria-expanded',String(on));button.textContent=on?'Краткий вид':'Все показатели';el('unitTable').classList.toggle('is-expanded',on);});
  function schedule(){clearTimeout(timer);if(active&&!document.hidden&&data?.status==='loading')timer=setTimeout(()=>load(false,true),30000);}
  async function load(prepare=false,background=false,force=false){
    if(!active || busy)return;const ownEpoch=epoch,from=el('unitFrom').value,to=el('unitTo').value;
    if(from>to){reset();status('Начало периода должно быть раньше окончания.',true);return;}
    const pending=(data?.pending||[]).filter(p=>p.status!=='loading');
    busy=true;el('unitPane').setAttribute('aria-busy','true');el('unitLoad').disabled=el('unitPrepare').disabled=true;
    if(!background){reset();status(prepare?'Ставим подготовку выбранных месяцев в очередь…':'Загружаем расходы по артикулам…');}
    try{
      if(prepare){invalidate();for(const item of pending){if(ownEpoch!==epoch)return;await window.WBApi.cabinet('daily_start',item.month);}}
      if(ownEpoch!==epoch)return;
      const result=await read(from,to,prepare||background||force);
      if(ownEpoch!==epoch)return;busy=false;render(result);
    }catch(error){if(ownEpoch!==epoch)return;reset();status(error.message||'Не удалось загрузить юнит-экономику. Повторите попытку.',true);}
    finally{if(ownEpoch===epoch){busy=false;el('unitPane').setAttribute('aria-busy','false');el('unitLoad').disabled=el('unitPrepare').disabled=false;schedule();}}
  }
  function setContext(next){
    if(!subscribed){window.WBApi?.subscribe?.(sourceChanged);window.WBApiCabinet?.subscribe?.(sourceChanged);subscribed=true;}
    const enabled=window.WBDaily?.allowed(next.userId,next.shopId)===true;
    const changed=context?.shopId!==next.shopId || context?.userId!==next.userId;
    const wasActive=active;context=next;active=enabled&&next.active===true;
    if(changed){invalidate();cancelLoad();fillMonths();el('unitSearch').value='';segment='all';sortDirection='desc';}
    if(enabled)prefetch();
    if(!active){clearTimeout(timer);if(wasActive)cancelLoad();return;}
    if(changed||!wasActive)load();
  }
  for(const id of ['unitFrom','unitTo'])el(id).addEventListener('change',()=>{cancelLoad();status('Выберите период и нажмите «Показать».');});
  el('unitLoad').addEventListener('click',()=>load(false,false,true));el('unitPrepare').addEventListener('click',()=>load(true));
  el('unitSearch').addEventListener('input',table);el('unitSort').addEventListener('change',event=>{if(!event?.detail?.unitHeader)sortDirection='desc';table();});
  el('unitSegments').addEventListener('click',event=>{const b=event.target.closest('[data-unit-segment]');if(!b||!Object.hasOwn(segmentNames,b.dataset.unitSegment))return;segment=b.dataset.unitSegment;table();});
  el('unitTable').addEventListener('click',event=>{const b=event.target.closest('[data-unit-sort]');if(!b)return;const select=el('unitSort'),key=b.dataset.unitSort;if(!['sales','internal_ads','net_profit'].includes(key))return;sortDirection=select.value===key&&sortDirection==='desc'?'asc':'desc';select.value=key;if(select.dispatchEvent)select.dispatchEvent(new CustomEvent('change',{bubbles:true,detail:{unitHeader:true}}));else table();});
  el('unitRows').addEventListener('click',event=>{
    if(window.getSelection?.().toString())return;
    const button=event.target.closest('[data-unit-article]')||event.target.closest('[data-unit-row]')?.querySelector('button[data-unit-article]');if(!button)return;
    details(button.dataset.unitArticle);
    detailAnimation?.cancel();if(motionAllowed())detailAnimation=el('unitDetail').animate?.([{opacity:.65,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],{duration:260,easing:'cubic-bezier(.16,1,.3,1)'});
    if((el('unitPane').getBoundingClientRect?.().width??Infinity)<1100){
      const behavior=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';
      el('unitDetail').focus?.({preventScroll:true});el('unitDetail').scrollIntoView?.({behavior,block:'start'});
    }
  });
  el('unitBackToTable').addEventListener('click',()=>{
    const row=[...el('unitRows').querySelectorAll('button')].find(b=>b.dataset.unitArticle===selected);
    if(row)row.focus?.();else el('unitTableTitle').focus?.();
  });
  el('unitZeroCosts').addEventListener('click',()=>{showZero=!showZero;if(selected)details(selected);});
  el('unitBasis').addEventListener('click',event=>{const button=event.target.closest('[data-unit-basis]');if(!button)return;perUnit=button.dataset.unitBasis==='unit';for(const node of el('unitBasis').querySelectorAll('button')){const on=node===button;node.classList.toggle('active',on);node.setAttribute('aria-pressed',String(on));}if(selected)details(selected);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stopMotion();stopCounter();if(data?.status==='ready')animateStats(data);}clearTimeout(timer);if(!document.hidden&&active&&data?.status==='loading')load(false,true);});
  window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change',()=>{stopMotion();if(data?.status==='ready')animateStats(data);});
  window.WBUnit={setContext};
})();
