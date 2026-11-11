(function(){
  'use strict';
  const el=id=>document.getElementById(id);
  if(!el('unitPane'))return;
  const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=value=>value==null?'—':Number(value).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
  const rate=value=>value==null?'—':Number(value).toLocaleString('ru-RU',{maximumFractionDigits:1})+'%';
  const tone=value=>value==null?'':Number(value)<0?'loss':'gain';
  let context=null,active=false,epoch=0,busy=false,data=null,selected=null,timer=null,perUnit=false;
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
  function reset(){clearTimeout(timer);data=null;selected=null;el('unitResults').hidden=true;el('unitRows').replaceChildren();el('unitExpenses').replaceChildren();el('unitCommon').replaceChildren();el('unitPrepare').hidden=true;for(const id of ['unitSales','unitProfit','unitMargin','unitProfitability'])el(id).textContent='—';}
  function cancelLoad(){epoch++;busy=false;reset();el('unitPane').setAttribute('aria-busy','false');el('unitLoad').disabled=el('unitPrepare').disabled=false;}
  function fillMonths(){
    const now=new Date(Date.now()+3*3600000),dates=Array.from({length:12},(_,i)=>new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-i,1)));
    const options=dates.map(d=>`<option value="${d.toISOString().slice(0,7)}">${safe(d.toLocaleDateString('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}))}</option>`).join('');
    for(const id of ['unitFrom','unitTo']){el(id).innerHTML=options;el(id).value=dates[0].toISOString().slice(0,7);}
  }
  function details(article){
    const product=data?.products.find(p=>p.article===article);if(!product)return;
    selected=article;el('unitDetailTitle').textContent=product.name||product.article;el('unitDetailArticle').textContent=product.article;
    const divisor=perUnit && product.quantity>0?product.quantity:1;
    el('unitUnitNotice').textContent=perUnit?(product.quantity>0?`На единицу · ${product.quantity.toLocaleString('ru-RU')} выкупленных товаров за вычетом возвратов`:'Нет положительного количества выкупов: показаны суммы за период'):'Суммы за выбранный период';
    el('unitExpenses').innerHTML=product.expenses.map(e=>`<div><dt>${safe(e.label)}</dt><dd>${safe(money(e.amount==null?null:Number(e.amount)/divisor))}</dd></div>`).join('');
    el('unitDetailSales').textContent=money(product.sales==null?null:Number(product.sales)/divisor);
    el('unitDetailProfit').textContent=money(product.net_profit==null?null:Number(product.net_profit)/divisor);el('unitDetailProfit').dataset.tone=tone(product.net_profit);
    el('unitDetailMissing').hidden=!product.missing_costs;el('unitDetailMissing').textContent=product.missing_costs?'Заполните себестоимость этого артикула — прибыль и проценты пока неизвестны.':'';
    for(const button of el('unitRows').querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.unitArticle===article));
  }
  function table(){
    if(!data)return;
    const query=el('unitSearch').value.trim().toLocaleLowerCase('ru-RU'),sort=el('unitSort').value;
    const rows=data.products.filter(p=>(p.article+' '+p.name).toLocaleLowerCase('ru-RU').includes(query)).sort((a,b)=>a[sort]==null?b[sort]==null?a.article.localeCompare(b.article):1:b[sort]==null?-1:Number(b[sort])-Number(a[sort])||a.article.localeCompare(b.article));
    el('unitRows').innerHTML=rows.length?rows.map(p=>`<tr><th scope="row"><button type="button" data-unit-article="${safe(p.article)}" aria-pressed="${p.article===selected}" aria-controls="unitDetail"><strong>${safe(p.name||p.article)}</strong><span>${safe(p.article)}</span></button></th><td data-label="Выкупили">${p.quantity.toLocaleString('ru-RU')}</td><td data-label="Продажи">${safe(money(p.sales))}</td><td data-label="Прямые расходы">${safe(money(p.total_expenses))}</td><td data-label="Чистая прибыль" data-tone="${tone(p.net_profit)}">${safe(money(p.net_profit))}</td><td data-label="Маржинальность">${rate(p.margin)}</td><td data-label="Рентабельность">${rate(p.profitability)}</td></tr>`).join(''):'<tr><td colspan="7" class="unit-empty">Товары не найдены</td></tr>';
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
    el('unitSales').textContent=money(result.totals.sales);el('unitProfit').textContent=money(result.totals.net_profit);el('unitProfit').dataset.tone=tone(result.totals.net_profit);
    el('unitMargin').textContent=rate(result.totals.margin);el('unitProfitability').textContent=rate(result.totals.profitability);
    const date=value=>new Date(value+'T12:00:00Z').toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
    status(`${date(result.period.dateFrom)} — ${date(result.period.dateTo)}. Только прямые расходы; общие суммы не распределены.`);
    el('unitCommon').innerHTML=result.common_expenses.filter(e=>e.amount==null || Number(e.amount)!==0).map(e=>`<div><dt>${safe(e.label)}</dt><dd>${safe(money(e.amount))}</dd></div>`).join('')||'<p class="hint">В полученных данных нет общих расходов.</p>';
    el('unitSearch').value=el('unitSearch').value||'';table();
    if(result.products.length)details(result.products.some(p=>p.article===selected)?selected:result.products[0].article);
    else {el('unitDetailTitle').textContent='Нет операций по артикулам';el('unitDetailArticle').textContent='';el('unitUnitNotice').textContent='';el('unitDetailMissing').textContent='';el('unitDetailMissing').hidden=true;el('unitExpenses').replaceChildren();el('unitDetailSales').textContent=el('unitDetailProfit').textContent='—';}
  }
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
    if(changed){invalidate();cancelLoad();fillMonths();el('unitSearch').value='';}
    if(enabled)prefetch();
    if(!active){clearTimeout(timer);if(wasActive)cancelLoad();return;}
    if(changed||!wasActive)load();
  }
  for(const id of ['unitFrom','unitTo'])el(id).addEventListener('change',()=>{cancelLoad();status('Выберите период и нажмите «Показать».');});
  el('unitLoad').addEventListener('click',()=>load(false,false,true));el('unitPrepare').addEventListener('click',()=>load(true));
  el('unitSearch').addEventListener('input',table);el('unitSort').addEventListener('change',table);
  el('unitRows').addEventListener('click',event=>{const button=event.target.closest('[data-unit-article]');if(button)details(button.dataset.unitArticle);});
  el('unitBasis').addEventListener('click',event=>{const button=event.target.closest('[data-unit-basis]');if(!button)return;perUnit=button.dataset.unitBasis==='unit';for(const node of el('unitBasis').querySelectorAll('button')){const on=node===button;node.classList.toggle('active',on);node.setAttribute('aria-pressed',String(on));}if(selected)details(selected);});
  document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(!document.hidden&&active&&data?.status==='loading')load(false,true);});
  window.WBUnit={setContext};
})();
