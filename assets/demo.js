document.addEventListener('DOMContentLoaded',()=>{
  'use strict';
  const $=id=>document.getElementById(id),{sample,shopId,userId}=window.WBDemo;
  const names={overview:['Обзор','Продажи, прибыль и расходы по двум маркетплейсам'],daily:['Углублённая аналитика','Прибыль по дням и прямые расходы каждого товара'],stocks:['Остатки','Запасы по складам, срок пополнения и исключения товаров'],promos:['Статистика по промокодам','Выкупы и возвраты по вымышленным промокодам WB'],reports:['Отчёты','Wildberries через API · Ozon из отчёта по начислениям'],costs:['Себестоимость','Общие закупочные цены для WB и Ozon'],settings:['Настройки','Попробуйте изменить название, налог и состав команды']};
  const key=p=>`${p.year}-${p.month}`,safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let view='overview',scope='wildberries',metric='sales',toastTimer;
  const empty=document.createElement('p');empty.id='demoOverviewEmpty';empty.className='hint';empty.hidden=true;empty.textContent='Нет примеров отчётов Ozon. Добавьте их в разделе «Отчёты», чтобы увидеть показатели.';$('overviewControls').after(empty);
  function toast(text){clearTimeout(toastTimer);$('demoToast').textContent=text;$('demoToast').hidden=false;toastTimer=setTimeout(()=>$('demoToast').hidden=true,4500);}
  function fillPeriods(){
    const periods=sample.available(scope==='wildberries'?'wildberries':'ozon'),old=$('periodSelect').value;
    $('periodSelect').innerHTML=[...periods].reverse().map(p=>`<option value="${key(p)}">${WBDashboard.formatPeriod(p.year,p.month)}</option>`).join('');
    $('periodSelect').value=periods.some(p=>key(p)===old)?old:WBDashboard.defaultPeriodValue([...periods].reverse());
    $('periodSelect').disabled=!periods.length;WBRange.sync([...periods].reverse());WBShell.components?.refreshSelects();
  }
  function periodData(periods){
    const sources=scope==='all'?['wildberries','ozon']:[scope],entries=[];
    for(const p of periods)for(const marketplace of sources){
      const m=sample.key(p);if(marketplace==='ozon'&&sample.state.removedReports.has(m))return null;
      const row=sample.month(m,marketplace);if(!row)return null;
      entries.push({marketplace,derived:WBDashboard.computeDerived(row.report,row.skus,sample.state.costs,sample.state.taxRate)});
    }
    return entries.length?WBRange.aggregate(entries):null;
  }
  function selected(){const end=$('periodSelect').value;return !end?[]:WBRange.active?WBRange.months($('periodStart').value,end):WBRange.months(end,end);}
  function manual(){
    const m=selected().at(-1),enabled=!!m&&scope!=='all'&&!WBRange.active;
    $('secManualExpenses').hidden=view!=='overview'||!enabled;
    if(!enabled)return;
    const r=sample.month(sample.key(m),scope).report;
    $('operationalExpensesInput').value=r.operational_expenses;$('externalPromotionInput').value=r.external_promotion_expenses;
    $('saveManualExpensesBtn').disabled=true;
  }
  function renderOverview(){
    const periods=selected(),d=periodData(periods),partial=periods.some(p=>sample.key(p)===sample.current);
    empty.hidden=!!d;
    for(const id of ['secKpis','secOverviewCharts','secAdvertising','secAnalytics'])if($(id))$(id).hidden=view!=='overview'||!d;
    if(!d){$('secManualExpenses').hidden=true;return;}
    const previousPeriods=WBRange.comparison(key(periods[0]),key(periods.at(-1))),previous=partial?null:periodData(previousPeriods);
    const trend=sample.available(scope==='wildberries'?'wildberries':'ozon').map(p=>({...WBRange.trendPoint(p,periodData([p])),partial:sample.key(p)===sample.current}));
    document.querySelectorAll('[data-scope]').forEach(b=>{const active=b.dataset.scope===scope;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
    document.querySelectorAll('[data-chart-style]').forEach(b=>{const active=b.dataset.chartStyle===WBShell.chartStyle;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
    WBDashboard.renderKPI($('kpiRow'),d,previous,scope,{activeMetric:metric,onSelect:k=>{metric=k;renderOverview();$('secTrend').scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}});
    WBDashboard.renderTrend($('trendChart'),trend,metric,scope,{selectedPeriod:periods.at(-1)});
    WBDashboard.renderExpenses($('expList'),$('expTotal'),$('expChart'),d,scope,previous);
    WBDashboard.renderSkuTable($('skuBody'),$('skuFoot'),$('skuHint'),$('skuChart'),d,previous);
    WBDashboard.renderProfitability(d,previous);
    $('rangeNotice').textContent=`${WBRange.label(periods)} · ${partial?'есть неполный текущий месяц':`сравнение с ${WBRange.label(previousPeriods)}`}`;
    manual();
  }
  const mobile=matchMedia('(max-width:900px)');
  function syncMenu(){const open=$('appScreen').classList.contains('menu-open');$('mobileSidebar').inert=mobile.matches&&!open;$('mobileMenuBtn').setAttribute('aria-expanded',String(open));$('mobileMenuBtn').setAttribute('aria-label',open?'Закрыть меню':'Открыть меню');}
  function closeMenu(focus=false){$('appScreen').classList.remove('menu-open');syncMenu();if(focus&&mobile.matches)$('mobileMenuBtn').focus();}
  function commitView(next){
    const previousView=view;view=names[next]?next:'overview';closeMenu();
    WBDaily.setContext({shopId,userId,marketplace:scope==='ozon'?'ozon':'wildberries',active:view==='daily'});
    WBStock.setContext({shopId,userId,active:view==='stocks'});
    document.querySelectorAll('.app-main .app-view').forEach(node=>{const on=node.dataset.view===view;node.hidden=!on;node.classList.toggle('is-active',on);});
    document.querySelectorAll('.side-menu a[data-view]').forEach(link=>{const on=link.dataset.view===view;link.classList.toggle('active',on);if(on)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
    $('pageTitle').textContent=names[view][0];$('pageSubtitle').textContent=names[view][1];
    document.title=`${names[view][0]} · Демомагазин`;
    if(view==='overview')renderOverview();if(view==='reports')reports();if(view==='costs')costs();if(view==='settings')settings();
    WBDemoPromos.setActive(view==='promos');WBShell.motion?.enter(view);
    if(previousView!==view){window.scrollTo({top:0,behavior:'instant'});$('pageTitle').focus({preventScroll:true});}
  }
  function navigate(next){if(!names[next])return;if(location.hash==='#'+next)commitView(next);else location.hash=next;}
  function changed(){
    WBDemo.notify();document.dispatchEvent(new CustomEvent('ozon-analytics-changed',{detail:{shopId}}));
    fillPeriods();if(view==='overview')renderOverview();if(view==='daily')WBDaily.reload();
  }
  function costs(){
    $('demoCostRows').innerHTML=sample.catalogue.map(p=>`<tr><td><strong>${safe(p.name)}</strong></td><td data-label="Артикул">${safe(p.article)}</td><td data-label="Себестоимость за штуку, ₽"><input type="number" min="0" step="0.01" required data-demo-cost="${safe(p.article)}" aria-label="Себестоимость ${safe(p.name)}" value="${sample.state.costs.get(p.article)}"></td></tr>`).join('');
  }
  function reports(){
    $('demoReportRows').innerHTML=sample.available('ozon').slice().reverse().map(p=>{const m=sample.key(p);return `<tr><td><strong>Отчёт по начислениям · ${safe(WBDashboard.formatPeriod(p.year,p.month))}</strong><small>Ozon · вымышленный файл</small></td><td data-label="Период">01.${String(p.month).padStart(2,'0')} — ${sample.end(m).split('-').reverse().join('.')}</td><td data-label="Статус"><span class="demo-state">Рассчитано</span></td><td><button type="button" class="icon-button" data-demo-remove-report="${m}" aria-label="Удалить пример отчёта за ${safe(WBDashboard.formatPeriod(p.year,p.month))}"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-trash"/></svg></button></td></tr>`;}).join('')||'<tr><td colspan="4" class="demo-empty-cell">Нет примеров отчётов. Выберите месяц и добавьте пример выше.</td></tr>';
  }
  function settings(){
    $('demoName').value=sample.state.name;$('demoTax').value=sample.state.taxRate;$('demoMemberCount').textContent=`${sample.members.length} участника`;
    $('demoMembers').innerHTML=sample.members.map(p=>`<li><div><strong>@${safe(p.username)}</strong><small>${p.joined?'Присоединился · пример':'Ожидает входа · пример'}</small></div><button class="icon-button" type="button" data-demo-remove-member="${p.id}" aria-label="Удалить участника ${safe(p.username)} из примера"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-trash"/></svg></button></li>`).join('')||'<li>В примере пока нет участников.</li>';
  }
  for(const link of document.querySelectorAll('.side-menu a[data-view],[data-demo-view]'))link.addEventListener('click',e=>{e.preventDefault();navigate(link.dataset.view||link.dataset.demoView);});
  window.addEventListener('hashchange',()=>WBShell.motion?WBShell.motion.navigate(()=>commitView(location.hash.slice(1))):commitView(location.hash.slice(1)));
  $('periodSelect').addEventListener('change',()=>{WBRange.clamp();renderOverview();});WBRange.wire(renderOverview,()=>{});
  for(const b of document.querySelectorAll('[data-scope]'))b.addEventListener('click',()=>{scope=b.dataset.scope;fillPeriods();renderOverview();});
  for(const b of document.querySelectorAll('[data-chart-style]'))b.addEventListener('click',()=>{WBShell.chartStyle=b.dataset.chartStyle;renderOverview();});
  $('profitabilityTrend')?.addEventListener('click',()=>{metric='profitability';renderOverview();$('secTrend').scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});});
  $('overviewRefresh').addEventListener('click',()=>{renderOverview();toast('Демонстрационные показатели пересчитаны. Реальные данные не запрашивались.');});
  for(const id of ['operationalExpensesInput','externalPromotionInput'])$(id).addEventListener('input',()=>{$('saveManualExpensesBtn').disabled=false;});
  $('saveManualExpensesBtn').addEventListener('click',()=>{try{sample.setManual(sample.key(selected()[0]),scope,$('operationalExpensesInput').value,$('externalPromotionInput').value);changed();toast('Расходы сохранены в демо. Прибыль и ДРР пересчитаны.');}catch(e){toast(e.message);}});
  $('demoCostsForm').addEventListener('submit',e=>{e.preventDefault();const prices=[...document.querySelectorAll('[data-demo-cost]')];if(prices.some(p=>!p.value.trim()||!Number.isFinite(Number(p.value))||Number(p.value)<0)){toast('Укажите неотрицательную цену у каждого товара.');return;}prices.forEach(p=>sample.setCost(p.dataset.demoCost,p.value));changed();$('demoCostStatus').textContent='Сохранено в демо';toast('Себестоимость обновлена. Расчёты WB и Ozon используют новые цены.');});
  $('demoNameForm').addEventListener('submit',e=>{e.preventDefault();const name=$('demoName').value.trim();if(!name){toast('Введите название магазина.');return;}sample.state.name=name;$('demoShopName').textContent=name;toast('Название демомагазина изменено.');});
  $('demoTaxForm').addEventListener('submit',e=>{e.preventDefault();try{sample.setTax($('demoTax').value);changed();toast('Налог изменён. Показатели обеих площадок пересчитаны.');}catch(error){toast(error.message);}});
  $('demoImportForm').addEventListener('submit',e=>{e.preventDefault();sample.state.removedReports.delete($('demoImportMonth').value);reports();changed();toast('Пример отчёта добавлен. Данные Ozon доступны в обзоре и аналитике.');});
  $('demoReportRows').addEventListener('click',e=>{const button=e.target.closest('[data-demo-remove-report]');if(!button)return;sample.state.removedReports.add(button.dataset.demoRemoveReport);reports();changed();toast('Пример удалён. Его можно добавить снова для этого же месяца.');});
  $('demoMembersForm').addEventListener('submit',e=>{e.preventDefault();const username=$('demoUsername').value.trim().replace(/^@/,'');if(!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username)){toast('Укажите ник: от 5 до 32 латинских букв, цифр и подчёркиваний.');return;}if(sample.members.some(p=>p.username.toLowerCase()===username.toLowerCase())){toast('Этот участник уже есть в примере.');return;}sample.members.push({id:Date.now(),username,joined:false});$('demoUsername').value='';settings();toast('Участник добавлен только в демо. Приглашение не отправлялось.');});
  $('demoMembers').addEventListener('click',e=>{const button=e.target.closest('[data-demo-remove-member]');if(!button)return;const index=sample.members.findIndex(p=>p.id===Number(button.dataset.demoRemoveMember));if(index>=0)sample.members.splice(index,1);settings();toast('Участник удалён из примера.');});
  $('demoReset').addEventListener('click',()=>location.reload());
  $('demoHelp').addEventListener('click',()=>$('demoHelpDialog').showModal());$('demoHelpClose').addEventListener('click',()=>$('demoHelpDialog').close());
  $('mobileMenuBtn').addEventListener('click',()=>{$('appScreen').classList.toggle('menu-open');syncMenu();if($('appScreen').classList.contains('menu-open'))$('mobileSidebar').querySelector('a.active')?.focus();});
  $('menuScrim').addEventListener('click',()=>closeMenu(true));mobile.addEventListener('change',()=>{closeMenu();syncMenu();});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape')closeMenu(true);
    if(e.key==='Tab'&&mobile.matches&&$('appScreen').classList.contains('menu-open')){
      const nodes=[...$('mobileSidebar').querySelectorAll('a[href],button:not([disabled])')].filter(n=>n.getClientRects().length),first=nodes[0],last=nodes.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  });
  document.addEventListener('wb-open-stocks',()=>navigate('stocks'));document.addEventListener('open-ozon-report',()=>navigate('reports'));
  window.addEventListener('seller:themechange',()=>{if(view==='overview')renderOverview();});
  $('demoImportMonth').innerHTML=sample.periods.slice(1).reverse().map(p=>`<option value="${sample.key(p)}">${WBDashboard.formatPeriod(p.year,p.month)}</option>`).join('');
  fillPeriods();syncMenu();commitView(location.hash.slice(1)||'overview');
});
