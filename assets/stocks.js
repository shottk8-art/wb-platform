(function(){
  'use strict';
  const el=id=>document.getElementById(id);
  if(!el('secStocks'))return;
  const allowed=(user,shop)=>user==='bbb002c4-cd7a-490d-b9c0-72aed5424261'&&shop==='853b81a0-e0e2-4195-bc80-1cdc362af946';
  const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=(v,d=0)=>v==null?'—':Number(v).toLocaleString('ru-RU',{maximumFractionDigits:d});
  const dailyCount=v=>v!=null&&v>0&&v<0.1?'< 0,1':number(v,1);
  const date=v=>v?new Date(v).toLocaleString('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}):'—';
  const statusNames={ok:'В наличии',low:'Мало запаса',out:'Нет в наличии',unknown:'Нет прогноза'};
  const attention=p=>p.status==='low'||p.status==='out'&&p.orders>0;
  let context=null,active=false,epoch=0,busy=false,saving=false,data=null,selected=null,segment='all',timer=null,subscribed=false,focusPending=false,detailAnimation=null;
  const enabled=()=>allowed(context?.userId,context?.shopId);
  const canRead=()=>enabled()&&window.WBApi?.shopId===context.shopId&&window.WBApi.connected;
  const inventory=()=>data?.inventory;
  const matches=(p,key)=>key==='all'||key==='attention'&&attention(p)||key===p.status;
  const days=p=>p.days_left==null?'—':p.days_left===0?'0 дн.':p.days_left<1?'< 1 дня':`${number(p.days_left,1)} дн.`;
  function status(text,error=false){el('stockStatus').textContent=text;el('stockStatus').dataset.error=String(error);}
  function closeNotifications(focus=false){el('stockNotifications').hidden=true;el('stockBell').setAttribute('aria-expanded','false');if(focus&&!el('stockBell').hidden)el('stockBell').focus();}
  function reset(){clearTimeout(timer);detailAnimation?.cancel();detailAnimation=null;data=null;selected=null;focusPending=false;segment='all';busy=false;saving=false;el('stockResults').hidden=true;el('stockDetail').hidden=true;el('stockRows').replaceChildren();el('stockLocations').replaceChildren();el('stockNotificationList').replaceChildren();el('stockNotificationInfo').textContent='';el('stockBellCount').hidden=true;el('stockBell').setAttribute('aria-label','Уведомления об остатках');el('stockWarehouse').innerHTML='<option value="all">Все склады</option>';el('stockSearch').value='';el('stockSort').value='priority';el('stockAlertDays').value='14';el('stockTargetDays').value='30';el('stockSettingsStatus').textContent='';el('stockDemandPeriod').textContent='';el('stockWarning').hidden=true;for(const id of ['stockTotal','stockLow','stockOut','stockWarehouses','stockDetailTitle','stockDetailArticle','stockDetailQuantity','stockDetailWb','stockDetailSeller','stockDetailToClient','stockDetailFromClient'])el(id).textContent='—';el('stockRecommendation').textContent='';closeNotifications();}
  function settingsDirty(){return !!data&&(Number(el('stockAlertDays').value)!==data.settings.alert_days||Number(el('stockTargetDays').value)!==data.settings.target_days);}
  function controls(){el('stockRefresh').disabled=busy||saving||!canRead();el('secStocks').setAttribute('aria-busy',String(busy));el('stockSaveSettings').disabled=busy||saving||!canRead()||!data||data.status==='not_connected'||!settingsDirty();el('stockAlertDays').disabled=el('stockTargetDays').disabled=saving;}
  function drawNotifications(){
    const items=(inventory()?.products||[]).filter(attention).sort(comparePriority),total=items.length;
    el('stockBellCount').textContent=total>99?'99+':String(total);el('stockBellCount').hidden=!total;
    el('stockBell').setAttribute('aria-label',total?`Уведомления об остатках: ${total} товаров требуют пополнения`:'Уведомления об остатках');
    el('stockNotificationInfo').textContent=inventory()?`Все склады · порог ${data.settings.alert_days} дн. · получено ${date(data.fetched_at)}${data.stale?' · данные устарели':''}`:el('stockStatus').textContent;
    el('stockNotificationList').innerHTML=items.length?items.map(p=>`<button type="button" class="stock-notification-item" data-stock-notify="${safe(p.nm_id)}"><svg class="icon" aria-hidden="true"><use href="#icon-store"/></svg><span><strong>${safe(p.name)}</strong><small>${safe(p.article)} · ${number(p.quantity)} шт. · ${p.status==='out'?'Нет в наличии':`запаса на ${safe(days(p))}`}${p.recommended!=null?` · пополнить ≈ ${number(p.recommended)} шт.`:''}</small></span></button>`).join(''):`<p class="stock-notification-empty">${inventory()?'Сейчас нет товаров, требующих пополнения по выбранному правилу.':safe(el('stockStatus').textContent)}</p>`;
  }
  function comparePriority(a,b){const rank=p=>attention(p)?p.status==='out'?0:1:p.status==='ok'?2:p.status==='unknown'?3:4;return rank(a)-rank(b)||(a.days_left??Infinity)-(b.days_left??Infinity)||a.name.localeCompare(b.name,'ru');}
  function filteredRows(){
    const q=el('stockSearch').value.trim().toLocaleLowerCase('ru-RU'),sort=el('stockSort').value;
    const rows=(inventory()?.products||[]).filter(p=>matches(p,segment)&&(!q||`${p.name} ${p.article} ${p.nm_id}`.toLocaleLowerCase('ru-RU').includes(q)));
    return rows.sort(sort==='quantity'?(a,b)=>quantity(a)-quantity(b)||a.name.localeCompare(b.name,'ru'):sort==='name'?(a,b)=>a.name.localeCompare(b.name,'ru'):comparePriority);
  }
  function quantity(p){const w=el('stockWarehouse').value;return w==='all'?p.quantity:p.warehouses.find(x=>x.id===w)?.quantity||0;}
  function selectProduct(id){
    const p=inventory()?.products.find(x=>x.nm_id===id);if(!p)return;selected=id;el('stockDetail').hidden=false;
    el('stockDetailTitle').textContent=p.name;el('stockDetailArticle').textContent=`${p.article} · WB ${p.nm_id}`;el('stockDetailQuantity').textContent=number(p.quantity)+' шт.';
    for(const [id,key] of [['stockDetailWb','wb'],['stockDetailSeller','seller'],['stockDetailToClient','to_client'],['stockDetailFromClient','from_client']])el(id).textContent=number(p[key])+' шт.';
    el('stockRecommendation').textContent=p.recommended==null?'Нет данных для прогноза срока и объёма пополнения.':`${p.status==='out'?'Товар закончился. ':''}Средний спрос ${dailyCount(p.daily_orders)} шт./день. ${p.days_left===0?'Запаса нет.':`Запаса примерно на ${days(p)}.`} ${p.recommended>0?`До ${data.settings.target_days} дней запаса: поставить ≈ ${number(p.recommended)} шт.`:'Запас выше целевого уровня.'}`;
    const locations=inventory().warehouses;
    el('stockLocations').innerHTML=p.warehouses.length?p.warehouses.map(w=>{const loc=locations.find(x=>x.id===w.id);return `<div class="stock-location"><div><span>${safe(loc?.name||w.id)}</span><strong>${number(w.quantity)} шт.</strong></div><small>${loc?.kind==='seller'?'Склад продавца':'Склад WB'}${loc?.region?` · ${safe(loc.region)}`:''}${w.to_client?` · к клиентам ${number(w.to_client)}`:''}${w.from_client?` · возвраты ${number(w.from_client)}`:''}</small>${w.sizes.length>1?`<details><summary>Размеры: ${w.sizes.length}</summary><dl>${w.sizes.map(s=>`<div><dt>ID ${safe(s.id)}</dt><dd>${number(s.quantity)} шт.</dd></div>`).join('')}</dl></details>`:''}</div>`;}).join(''):'<p class="stock-caption">В полных отчётах WB нет остатков этого товара на складах.</p>';
  }
  function table(){
    if(!inventory())return;const rows=filteredRows();
    if(!rows.some(p=>p.nm_id===selected))selected=rows[0]?.nm_id||null;
    const w=el('stockWarehouse').value,warehouse=inventory().warehouses.find(x=>x.id===w);
    el('stockRows').innerHTML=rows.length?rows.map(p=>`<tr data-stock-row="${safe(p.nm_id)}"><th scope="row"><button type="button" data-stock-product="${safe(p.nm_id)}" aria-pressed="${p.nm_id===selected}" aria-controls="stockDetail"><span class="stock-product-mark" aria-hidden="true">${safe(p.name.split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase())}</span><span class="stock-product-copy"><strong>${safe(p.name)}</strong><span>${safe(p.article)} · WB ${safe(p.nm_id)}</span></span></button></th><td data-label="Доступно${warehouse?' · выбранный склад':''}"><strong>${number(quantity(p))}</strong></td><td data-label="Заказов в день, все склады">${dailyCount(p.daily_orders)}</td><td data-label="Запас, все склады">${safe(days(p))}</td><td data-label="Статус, все склады"><span class="stock-badge" data-stock-state="${safe(p.status)}">${safe(statusNames[p.status])}</span></td></tr>`).join(''):'<tr><td colspan="5" class="stock-empty">Товары не найдены</td></tr>';
    el('stockShowing').textContent=number(rows.length);el('stockCount').textContent=`${rows.length} из ${inventory().products.length} товаров${warehouse?` · количество: ${warehouse.name}; прогноз и статус — по всем складам`:''}`;
    el('stockDetail').hidden=!selected;if(selected)selectProduct(selected);
    const counts={All:inventory().products.length,Attention:inventory().products.filter(attention).length,Out:inventory().totals.out,Unknown:inventory().totals.unknown};
    for(const [k,v] of Object.entries(counts))el('stockCount'+k).textContent=number(v);
    for(const b of el('stockSegments').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.stockSegment===segment));
  }
  function render(result){
    const dirty=settingsDirty();data=result;
    if(!dirty){el('stockAlertDays').value=String(result.settings.alert_days);el('stockTargetDays').value=String(result.settings.target_days);}
    const inv=inventory();el('stockResults').hidden=!inv;
    if(inv){
      el('stockTotal').textContent=number(inv.totals.quantity);el('stockLow').textContent=number(inv.products.filter(attention).length);el('stockOut').textContent=number(inv.totals.out);el('stockWarehouses').textContent=number(inv.totals.warehouses);
      const old=el('stockWarehouse').value;el('stockWarehouse').innerHTML='<option value="all">Все склады</option>'+inv.warehouses.map(w=>`<option value="${safe(w.id)}">${safe(w.name)}${w.kind==='seller'?' · продавец':''}</option>`).join('');el('stockWarehouse').value=inv.warehouses.some(w=>w.id===old)?old:'all';
      status(`Получено ${date(result.fetched_at)}${result.status==='loading'?' · обновляем на сервере':' · автообновление каждые 30 минут'}`);
      if(inv.demand)el('stockDemandPeriod').textContent=`Период спроса: ${inv.demand.from} — ${inv.demand.to}, ${inv.demand.days} полных дней по московскому времени.`;
      table();
    }else status(result.status==='not_connected'?'Подключите API Wildberries в настройках магазина.':result.status==='error'?'Не удалось загрузить остатки. Обновление будет повторено автоматически.':'Собираем остатки по всем складам и спрос по товарам. Можно закрыть страницу — загрузка продолжится на сервере.');
    el('stockWarning').hidden=!(result.error||result.stale&&inv);el('stockWarning').textContent=result.error||'Последний снимок устарел. До завершения обновления показаны ранее полученные остатки.';
    drawNotifications();controls();
  }
  function schedule(){clearTimeout(timer);if(canRead()&&!document.hidden)timer=setTimeout(()=>load(),data?.status==='loading'?30000:300000);}
  async function load(refresh=false){
    if(!canRead()||busy||saving)return;const ticket=epoch;busy=true;controls();if(!inventory())status('Загружаем остатки…');
    try{const result=await window.WBApi.cabinet(refresh?'stocks_refresh':'stocks');if(ticket!==epoch)return;render(result);}
    catch(e){if(ticket!==epoch)return;status((e.message||'Не удалось загрузить остатки. Попробуйте ещё раз.')+(inventory()?` Последний снимок: ${date(data.fetched_at)}.`:''),true);if(inventory()){el('stockWarning').hidden=false;el('stockWarning').textContent='Не удалось проверить обновление. Показан последний полученный снимок.';}drawNotifications();}
    finally{if(ticket===epoch){busy=false;controls();schedule();}}
  }
  function sourceChanged(){if(!enabled())return;epoch++;reset();if(canRead())load();else{status('Подключите API Wildberries в настройках магазина.');controls();drawNotifications();}}
  function focusDetail(){if(!selected||!active)return;if(el('secStocks').getBoundingClientRect().width<1120){el('stockDetail').focus({preventScroll:true});el('stockDetail').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});}}
  function openProduct(id){if(!enabled())return;segment='all';el('stockSearch').value='';el('stockWarehouse').value='all';selected=id;focusPending=true;closeNotifications();document.dispatchEvent(new CustomEvent('wb-open-stocks'));table();if(active&&focusPending){focusPending=false;requestAnimationFrame(focusDetail);}}
  function setContext(next){
    if(!subscribed){window.WBApi?.subscribe(sourceChanged);subscribed=true;}
    const changed=context?.shopId!==next.shopId||context?.userId!==next.userId;
    context=next;active=next.active===true&&enabled();
    if(changed){epoch++;reset();}
    const on=enabled();el('stocksLink').hidden=el('stockBell').hidden=el('secStocks').hidden=!on;
    if(!on){clearTimeout(timer);controls();return;}
    if(changed){if(canRead())load();else{status('Проверяем подключение WB…');controls();}}
    if(active&&focusPending){focusPending=false;requestAnimationFrame(focusDetail);}
  }
  el('stockRefresh').addEventListener('click',()=>load(true));
  el('stockSearch').addEventListener('input',table);el('stockSort').addEventListener('change',table);el('stockWarehouse').addEventListener('change',table);
  el('stockSegments').addEventListener('click',e=>{const b=e.target.closest('[data-stock-segment]');if(!b)return;segment=b.dataset.stockSegment;table();});
  el('stockRows').addEventListener('click',e=>{if(window.getSelection?.().toString())return;const b=e.target.closest('[data-stock-product]')||e.target.closest('[data-stock-row]')?.querySelector('[data-stock-product]');if(!b)return;selected=b.dataset.stockProduct;table();detailAnimation?.cancel();if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches)detailAnimation=el('stockDetail').animate?.([{opacity:.7,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],{duration:220,easing:'cubic-bezier(.16,1,.3,1)'});focusDetail();});
  el('stockBack').addEventListener('click',()=>{[...el('stockRows').querySelectorAll('button')].find(b=>b.dataset.stockProduct===selected)?.focus();});
  el('stockBell').addEventListener('click',()=>{if(!enabled())return;if(!el('stockNotifications').hidden){closeNotifications(true);return;}drawNotifications();const r=el('stockBell').getBoundingClientRect(),p=el('stockNotifications'),width=Math.min(380,window.innerWidth-24);p.style.top=Math.min(r.bottom+10,Math.max(12,window.innerHeight-300))+'px';p.style.right=Math.min(Math.max(12,window.innerWidth-r.right),window.innerWidth-width-12)+'px';p.style.maxHeight=`${Math.max(120,window.innerHeight-parseFloat(p.style.top)-16)}px`;p.hidden=false;el('stockBell').setAttribute('aria-expanded','true');el('stockNotificationsClose').focus();});
  el('stockNotificationsClose').addEventListener('click',()=>closeNotifications(true));
  el('stockNotificationList').addEventListener('click',e=>{const b=e.target.closest('[data-stock-notify]');if(b)openProduct(b.dataset.stockNotify);});
  el('stockOpenAttention').addEventListener('click',()=>{if(!enabled())return;segment='attention';el('stockSearch').value='';closeNotifications();document.dispatchEvent(new CustomEvent('wb-open-stocks'));table();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!el('stockNotifications').hidden){e.preventDefault();closeNotifications(true);}});
  document.addEventListener('pointerdown',e=>{if(!el('stockNotifications').hidden&&!el('stockNotifications').contains(e.target)&&!el('stockBell').contains(e.target))closeNotifications();});
  for(const id of ['stockAlertDays','stockTargetDays'])el(id).addEventListener('input',()=>{el('stockSettingsStatus').textContent='';controls();});
  el('stockSettingsForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!canRead()||busy||saving||!settingsDirty())return;
    const alert=Number(el('stockAlertDays').value),target=Number(el('stockTargetDays').value);
    if(!Number.isInteger(alert)||alert<1||alert>180||!Number.isInteger(target)||target<alert||target>365){el('stockSettingsStatus').textContent='Порог: 1–180 дней. Целевой запас — от порога до 365 дней.';return;}
    const ticket=epoch;saving=true;controls();el('stockSettingsStatus').textContent='Сохраняем…';
    try{const result=await window.WBApi.cabinet('stocks_settings',undefined,false,{alert_days:alert,target_days:target});if(ticket!==epoch)return;data=null;render(result);el('stockSettingsStatus').textContent='Правила уведомлений сохранены.';}
    catch(e){if(ticket===epoch)el('stockSettingsStatus').textContent=e.message||'Не удалось сохранить. Повторите попытку.';}
    finally{if(ticket===epoch){saving=false;controls();schedule();}}
  });
  document.addEventListener('visibilitychange',()=>{clearTimeout(timer);detailAnimation?.cancel();if(!document.hidden&&canRead())load();else closeNotifications();});
  window.addEventListener('resize',()=>closeNotifications());
  window.WBStock={allowed,setContext};
})();
