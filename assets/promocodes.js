(function(){
  'use strict';
  const shop='853b81a0-e0e2-4195-bc80-1cdc362af946',el=id=>document.getElementById(id);
  const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>Number(v).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});
  const integer=v=>Number(v).toLocaleString('ru-RU',{maximumFractionDigits:0});
  const metricMoney=v=>Math.abs(v)>=1000000?Number(v).toLocaleString('ru-RU',{notation:'compact',maximumFractionDigits:1})+' ₽':Number(v).toLocaleString('ru-RU',{maximumFractionDigits:0})+' ₽';
  const date=v=>v?new Date(v).toLocaleString('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}):'—';
  const today=()=>new Date(Date.now()+10800000).toISOString().slice(0,10);
  let userId,epoch=0,busy=false,writing=false,result=null,owner=false,timer=null,page=0,widget=false,counter=null;
  let counterTargets=[];
  function stopCounter(settle=false){if(counter!=null)cancelAnimationFrame(counter);counter=null;if(settle)counterTargets.forEach(([id,value,format])=>{el(id).textContent=format(value);});}
  function stats(){
    stopCounter();const sum=k=>result.rows.reduce((n,r)=>n+Number(r[k]),0);
    counterTargets=[['promoCount',result.metrics?.active_codes??result.rows.filter(r=>r.sold_qty>0).length,integer],['promoUnits',sum('sold_qty'),integer],['promoSales',sum('sold_amount'),metricMoney],['promoNet',sum('net_amount'),metricMoney]];
    for(const [id,value] of counterTargets)el(id).title=id==='promoSales'||id==='promoNet'?money(value)+' ₽':integer(value);
    if(!window.requestAnimationFrame||document.hidden||window.matchMedia('(prefers-reduced-motion: reduce)').matches){stopCounter(true);return;}
    let start;const ticket=epoch;const frame=now=>{if(ticket!==epoch)return;start??=now;const t=Math.min(1,(now-start)/450),p=1-Math.pow(1-t,4);counterTargets.forEach(([id,value,format])=>{el(id).textContent=format(value*p);});if(t<1)counter=requestAnimationFrame(frame);else stopCounter(true);};counter=requestAnimationFrame(frame);
  }
  const status=(id,text,error=false)=>{el(id).textContent=text;el(id).dataset.error=String(error);};
  function defaults(current=false){const d=today(),m=+d.slice(5,7)-(current?1:2),y=+d.slice(0,4);
    el('promoFrom').value=new Date(Date.UTC(y,m,1)).toISOString().slice(0,10);
    el('promoTo').value=current?d:new Date(Date.UTC(y,m+1,0)).toISOString().slice(0,10);}
  for(const id of ['promoFrom','promoTo']){el(id).max=today();const d=today();el(id).min=new Date(Date.UTC(+d.slice(0,4),+d.slice(5,7)-12,1)).toISOString().slice(0,10);}
  defaults();
  function controls(){
    el('promoRangeToggle').disabled=busy||writing;
    el('promoAccessRetry').disabled=busy||writing;
    for(const id of ['promoFrom','promoTo','promoShow','promoPrevious','promoCurrent','promoRefresh'])el(id).disabled=busy||writing;
    if(result?.status==='needs_catalog')el('promoRefresh').disabled=true;
    for(const id of ['promoNameSave','promoInvite'])el(id).disabled=busy||writing;
    el('promoRefresh').hidden=el('promoManagement').hidden=el('promoCabinetLink').hidden=!owner;
    el('promoMain').setAttribute('aria-busy',String(busy));
    window.WBPromoRange?.sync();
  }
  function clear(){window.WBPromoRange?.close(false);window.WBPromoCharts?.clear();stopCounter();counterTargets=[];result=null;page=0;clearTimeout(timer);el('promoRows').replaceChildren();el('promoMatching').textContent='';el('promoPagination').hidden=true;el('promoEmpty').hidden=false;el('promoEmpty').textContent='Загружаем статистику…';
    for(const id of ['promoCount','promoUnits','promoSales','promoNet']){el(id).textContent='—';el(id).title='';}}
  async function request(action,payload={}){
    const session=await window.WBAuth.getSession();
    if(!session||session.user.id!==userId){applySession(session);throw new Error('Сессия изменилась. Войдите ещё раз');}
    let response;
    try{response=await fetch(window.WB_CONFIG.SUPABASE_URL+'/functions/v1/wb-api',{method:'POST',cache:'no-store',signal:AbortSignal.timeout(55000),headers:{Authorization:'Bearer '+session.access_token,apikey:window.WB_CONFIG.SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({...payload,action,shop_id:shop})});}
    catch{throw new Error('Не удалось связаться с сервером. Попробуйте ещё раз');}
    let value;try{value=await response.json();}catch{throw new Error('Сервер не вернул результат. Попробуйте ещё раз');}
    if(!response.ok){const error=new Error(value.error||'Не удалось выполнить запрос');error.status=response.status;throw error;}return value;
  }
  function table(){
    if(result?.status!=='ready')return;
    const query=el('promoSearch').value.trim().toLowerCase(),sort=el('promoSort').value;
    const rows=result.rows.filter(r=>!query||(r.name+' '+(r.code||'')+' '+r.promo_id).toLowerCase().includes(query));
    rows.sort(sort==='name'?(a,b)=>(a.name||a.promo_id).localeCompare(b.name||b.promo_id,'ru'):(a,b)=>Number(b[sort==='quantity'?'sold_qty':sort==='net'?'net_amount':'sold_amount'])-Number(a[sort==='quantity'?'sold_qty':sort==='net'?'net_amount':'sold_amount'])||a.promo_id.localeCompare(b.promo_id));
    const pages=Math.max(1,Math.ceil(rows.length/50));page=Math.min(page,pages-1);
    el('promoMatching').textContent=integer(rows.length);
    el('promoRows').innerHTML=rows.slice(page*50,page*50+50).map(r=>`<tr><td>${owner?`<button type="button" class="promo-edit" data-promo-edit="${safe(r.promo_id)}" aria-label="Изменить промокод: ${safe(r.name||r.promo_id)}">${safe(r.name||'Указать название')}</button>`:`<span class="promo-promo-name">${safe(r.name||'Промокод без названия')}</span>`}${r.code?`<span class="promo-promo-id">Код: ${safe(r.code)}</span>`:''}<span class="promo-promo-id">ID: ${safe(r.promo_id)}</span></td><td data-label="Выкуплено, шт.">${integer(r.sold_qty)}</td><td data-label="Сумма выкупов, ₽" class="promo-amount">${money(r.sold_amount)}</td><td data-label="Возвраты" class="promo-return">${integer(r.returned_qty)} шт.<br>${money(r.returned_amount)} ₽</td><td data-label="Итог, ₽" class="promo-amount">${money(r.net_amount)}</td></tr>`).join('');
    el('promoEmpty').hidden=rows.length>0;el('promoEmpty').textContent=query?'По этому названию, промокоду или ID ничего не найдено.':'В сохранённом списке пока нет промокодов.';
    el('promoPagination').hidden=rows.length<=50;el('promoPageInfo').textContent=`${page+1} из ${pages}`;el('promoPageBack').disabled=page===0;el('promoPageNext').disabled=page===pages-1;
  }
  function render(){
    controls();if(!result)return;
    if(result.status==='ready'){
      stats();window.WBPromoCharts?.render(result);table();
      status('promoStatus',`${result.refreshing?'Обновляем на сервере. Пока показан последний полный результат. ':''}Данные получены ${date(result.fetched_at)}.`);
    }else{
      window.WBPromoCharts?.clear();stopCounter();counterTargets=[];for(const id of ['promoCount','promoUnits','promoSales','promoNet']){el(id).textContent='—';el(id).title='';}el('promoPagination').hidden=true;el('promoMatching').textContent='';
      el('promoRows').replaceChildren();el('promoEmpty').hidden=false;
      const loading=result.status==='loading',needsCatalog=result.status==='needs_catalog';
      el('promoEmpty').textContent=needsCatalog?(owner?'Добавьте ID и название в разделе «Названия промо и доступ».':'Владелец TOPLASH ещё не добавил промокоды для отслеживания.'):loading?'Собираем статистику из финансовых отчётов WB. Страницу можно закрыть — загрузка продолжится на сервере.':owner?'Статистика за этот период ещё не подготовлена. Нажмите «Обновить из WB».':'Статистика за этот период ещё не подготовлена. Попросите владельца TOPLASH загрузить её.';
      status('promoStatus',needsCatalog?'Список промокодов пока не настроен.':result.error||`${loading?'Загружаются':'Нет полных данных за'}: ${(result.missing_months||[]).join(', ')}.`,!!result.error);
    }
  }
  function schedule(){clearTimeout(timer);if(userId&&!document.hidden&&(result?.status==='loading'||result?.refreshing||result?.comparison?.status==='loading'||result?.comparison?.refreshing))timer=setTimeout(()=>load(false,false),30000);}
  async function load(refresh=false,reset=true){
    if(!userId||busy||writing)return;
    if(!el('promoPeriodForm').reportValidity())return;
    const from=el('promoFrom').value,to=el('promoTo').value;
    const rangeError=window.WBPromoRange?.validate(from,to);if(rangeError){status('promoStatus',rangeError,true);return;}
    if(from>to){status('promoStatus','Начало периода должно быть не позже окончания',true);return;}
    const ticket=++epoch;busy=true;if(reset)clear();controls();status('promoStatus',refresh?'Запускаем обновление…':'Читаем статистику…');
    try{
      let value=await request(refresh?'promocodes_start':'promocodes_read',{from,to,refresh});if(ticket!==epoch)return;
      if(value.owner&&(value.status==='needs_preparation'||value.comparison?.status==='needs_preparation')&&!refresh){value=await request('promocodes_start',{from,to});if(ticket!==epoch)return;}
      owner=!!value.owner;result=value;el('promoAccessStatus').hidden=true;el('promoAccessRetry').hidden=true;el('promoLogin').hidden=true;el('promoMain').hidden=false;render();
      if(owner&&!el('promoViewers').dataset.loaded)await viewers(ticket);
    }catch(error){if(ticket!==epoch)return;
      if(error.status===401||error.status===403){clear();owner=false;el('promoMain').hidden=true;el('promoAccessRetry').hidden=true;status('promoAccessStatus',error.message,true);el('promoAccessStatus').hidden=false;}
      else if(el('promoMain').hidden){status('promoAccessStatus',error.message,true);el('promoAccessStatus').hidden=false;el('promoAccessRetry').hidden=false;}
      else{status('promoStatus',error.message,true);el('promoEmpty').textContent='Не удалось загрузить статистику. Выберите период и попробуйте ещё раз.';}
    }finally{if(ticket===epoch){busy=false;controls();schedule();}}
  }
  async function viewers(ticket=epoch){
    const value=await request('promocodes_viewers');if(ticket!==epoch)return;
    el('promoViewers').dataset.loaded='true';
    el('promoViewers').innerHTML=value.viewers.length?value.viewers.map(v=>`<li><span>@${safe(v.telegram_username)}<small>${v.user_id?'Доступ активирован':'Ожидает входа через Telegram'}</small></span><button type="button" data-promo-revoke="${safe(v.id)}">Убрать доступ</button></li>`).join(''):'<li class="promo-muted">Доступ пока есть только у владельца</li>';
  }
  async function write(action,payload,success){
    if(!owner||busy||writing)return false;const ticket=epoch;writing=true;controls();status('promoManageStatus','Сохраняем…');
    try{await request(action,payload);if(ticket!==epoch)return false;status('promoManageStatus',success);return true;}
    catch(error){if(ticket===epoch)status('promoManageStatus',error.message,true);return false;}
    finally{if(ticket===epoch){writing=false;controls();}}
  }
  function login(){
    el('promoLogin').hidden=false;el('promoMain').hidden=true;el('promoAccessStatus').hidden=true;el('promoAccessRetry').hidden=true;
    if(widget)return;widget=true;const script=document.createElement('script');script.async=true;script.src='https://telegram.org/js/telegram-widget.js?22';script.setAttribute('data-telegram-login','wb_platformbot');script.setAttribute('data-size','large');script.setAttribute('data-radius','8');script.setAttribute('data-onauth','onTelegramAuth(user)');el('promoTelegram').append(script);
  }
  function applySession(session){
    const id=session?.user?.id||null;if(id===userId)return;
    userId=id;++epoch;busy=false;writing=false;owner=false;clear();controls();el('promoAccessRetry').hidden=true;el('promoManagement').open=false;el('promoViewers').replaceChildren();delete el('promoViewers').dataset.loaded;
    el('promoSignOut').hidden=!id;el('promoIdentity').textContent=session?.user?.user_metadata?.full_name||'';
    if(!id){login();return;}el('promoLogin').hidden=true;el('promoMain').hidden=true;el('promoAccessStatus').hidden=false;status('promoAccessStatus','Проверяем доступ…');load();
  }
  window.onTelegramAuth=async tgUser=>{status('promoAuthStatus','Входим через Telegram…');try{const session=await window.WBAuth.signInWithTelegram(tgUser);applySession(session);}catch(error){status('promoAuthStatus',error.message,true);}};
  el('promoSignOut').addEventListener('click',async()=>{await window.supabaseClient.auth.signOut();applySession(null);});
  el('promoPeriodForm').addEventListener('submit',event=>{event.preventDefault();load();});
  el('promoRefresh').addEventListener('click',()=>load(true));
  el('promoAccessRetry').addEventListener('click',()=>load());
  for(const [id,current] of [['promoPrevious',false],['promoCurrent',true]])el(id).addEventListener('click',()=>{defaults(current);load();});
  el('promoSearch').addEventListener('input',()=>{page=0;table();});el('promoSort').addEventListener('change',()=>{page=0;table();});
  el('promoPageBack').addEventListener('click',()=>{page--;table();});el('promoPageNext').addEventListener('click',()=>{page++;table();});
  el('promoRows').addEventListener('click',event=>{const button=event.target.closest('[data-promo-edit]');if(!button||!owner)return;const row=result?.rows.find(r=>r.promo_id===button.dataset.promoEdit);if(!row)return;
    el('promoNameId').value=row.promo_id;el('promoName').value=row.name;el('promoCode').value=row.code||'';el('promoManagement').open=true;el('promoName').focus();});
  el('promoNameForm').addEventListener('submit',async event=>{event.preventDefault();const id=el('promoNameId').value.trim(),name=el('promoName').value.trim(),code=el('promoCode').value.trim();
    if(await write('promocodes_name',{promo_id:id,name,code},'Промокод сохранён')){const row=result?.rows.find(r=>r.promo_id===id.toLowerCase());if(row){row.name=name;row.code=code;table();}else await load(false,false);}});
  el('promoInviteForm').addEventListener('submit',async event=>{event.preventDefault();if(await write('promocodes_invite',{username:el('promoUsername').value},'Приглашение добавлено. Отправьте пользователю ссылку для входа.')){el('promoUsername').value='';try{await viewers();}catch(error){status('promoManageStatus',error.message,true);}}});
  el('promoViewers').addEventListener('click',async event=>{const button=event.target.closest('[data-promo-revoke]');if(!button)return;
    if(await write('promocodes_revoke',{viewer_id:button.dataset.promoRevoke},'Доступ отозван'))try{await viewers();}catch(error){status('promoManageStatus',error.message,true);}});
  el('promoCopyLink').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(location.origin+'/promocodes.html');status('promoManageStatus','Ссылка для входа скопирована');}catch{status('promoManageStatus','Ссылка для входа: '+location.origin+'/promocodes.html');}});
  document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(document.hidden)stopCounter(true);else if(userId)load(false,false);});
  window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change',event=>{if(event.matches)stopCounter(true);});
  window.supabaseClient.auth.onAuthStateChange((_event,session)=>setTimeout(()=>applySession(session),0));
  window.WBAuth.waitForSession().then(applySession).catch(error=>{login();status('promoAuthStatus',error.message,true);});
})();
