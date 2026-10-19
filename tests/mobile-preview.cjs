// Local, synthetic responsive fixture. Never contacts Supabase or WB.
// Run: node tests/mobile-preview.cjs; inspect http://127.0.0.1:4178/app.html
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const fixture = `
<script src="/assets/corbel.js"></script>
<script src="/assets/corbel-motion.js"></script>
<script src="/assets/corbel-components.js?v=20261019-reference6"></script>
<script src="/assets/reference.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.5.1/chart.umd.min.js"></script>
<script src="/assets/trend-interaction.js?v=20261019-trend2"></script>
<script src="/assets/expense-traffic.js?v=20261019-traffic1"></script>
<script src="/assets/dashboard.js?v=20261019-traffic1"></script>
<script src="/assets/period-range.js?v=20261019-trend1"></script>
<script>
const byId=id=>document.getElementById(id);
// Deterministic still captures exercise the actual reduced-motion code path.
if(location.search.includes('still=1')){const original=window.matchMedia.bind(window);window.matchMedia=query=>query.includes('prefers-reduced-motion')?{matches:true}:original(query);document.body.classList.add('fixture-static');}
byId('loadingScreen').hidden=true;
const screen=byId('appScreen')||byId('adminScreen')||byId(location.search.includes('login')?'authScreen':'publicScreen');
screen.hidden=false;
const rows=[{article:'chlorophill/450new',name:'Хлорофилл жидкий пищевой',bought_qty:854,revenue:1182101,cost_price:398,total_cost:339892,profit:842209,abc:'A'},
{article:'magnesium/90',name:'Магний В6 Хелат 400 мг Бисглицинат (глицинат)',bought_qty:28,revenue:24950,cost_price:251,total_cost:7028,profit:17922,abc:'C'},
{article:'very-long-article-code-without-spaces-1234567890',name:'Очень длинное название товара для проверки переноса текста на маленьком экране',bought_qty:100001,revenue:99999999,cost_price:1,total_cost:100001,profit:-12345678,abc:'B'}];
const d={skuRows:rows,expenses:[['Себестоимость товара',696198],['Очень длинное название удержания маркетплейса',238988],['WB Продвижение',226553]],rep:{orders_amount:66640095,orders_qty:22998,sales_amount:2231708,bought_qty:1455,transfer_total:1826845,ads_spend:226553,wb_media_spend:0,ads_promo_spend:77511},netProfit:792508,rates:{drrOrders:6.3,drrSales:10.2}};
const prev={...d,rep:{...d.rep,orders_amount:52258000,orders_qty:19000},skuRows:rows.map(r=>({...r,bought_qty:r.bought_qty-12,revenue:r.revenue-46687,profit:r.profit-59423})),expenses:[['Себестоимость товара',481112],['Очень длинное название удержания маркетплейса',291552],['WB Продвижение',242868]]};
if(location.search.includes('expenses=long')){d.isApi=true;prev.isApi=true;d.expenses.push(['Логистика',56000],['WB Media',28000],['Налог',25000],['Хранение',6200],['Операционные расходы',4500],['Компенсация скидок WB',-11000],['Реклама уже в удержаниях',-6200]);}
if(location.search.includes('expenses=unknown')){d.isApi=true;d.expenses.push(['WB Media',null]);}
if(location.search.includes('expenses=empty')){d.expenses=[];prev.expenses=[];}
if(byId('skuBody')) WBDashboard.renderSkuTable(byId('skuBody'),byId('skuFoot'),byId('skuHint'),byId('skuChart'),d,prev);
if(byId('expList')) WBDashboard.renderExpenses(byId('expList'),byId('expTotal'),byId('expChart'),d,'wildberries',prev);
const trend=Array.from({length:12},(_,i)=>({year:i<2?2025:2026,month:(i+10)%12+1,sales:1250000+i*91000,orders:2000000+i*120000,profit:260000+i*47000,quantity:800+i*60,transfer:900000+i*77000,internalAds:100000+i*11000,mediaAds:10000+i*2000,promo:20000+i*1000,drrOrders:5+i*.15,drrSales:7+i*.2}));
if(location.search.includes('series=negative'))trend.forEach((row,i)=>{row.sales=i%3===0?-row.sales:i%3===1?0:row.sales;});
if(location.search.includes('series=unknown'))trend.forEach(row=>{row.sales=null;});
const drawTrend=metric=>{if(byId('trendChart'))WBDashboard.renderTrend(byId('trendChart'),trend,metric,'wildberries')};
if(byId('kpiRow')) WBDashboard.renderKPI(byId('kpiRow'),d,prev,'wildberries',{onSelect:drawTrend,activeMetric:'sales'});
drawTrend('sales');
document.addEventListener('DOMContentLoaded',()=>{if(byId('kpiRow'))WBDashboard.renderKPI(byId('kpiRow'),d,prev,'wildberries',{onSelect:drawTrend,activeMetric:'sales'});drawTrend('sales');});
WBShell.setProfile({user_metadata:{full_name:'Тестовый пользователь',telegram_username:'example'}},true);
document.querySelectorAll('[data-chart-style]').forEach(button=>button.onclick=()=>{WBShell.chartStyle=button.dataset.chartStyle;drawTrend('sales')});
if(byId('shopSwitch')) byId('shopSwitch').innerHTML='<option>Тестовый магазин · длинное название</option>';
if(byId('userEmail')) byId('userEmail').textContent='Тестовый пользователь';
if(byId('salesYear'))byId('salesYear').innerHTML='<option>2026</option>';
if(byId('salesMonth'))byId('salesMonth').innerHTML='<option>Сентябрь</option>';
document.querySelector('#overviewScope [data-scope="wildberries"]')?.classList.add('active');
document.querySelector('#reportMarketplace [data-marketplace="wildberries"]')?.classList.add('active');
if(byId('periodSelect')) byId('periodSelect').innerHTML='<option value="2026-9">сентябрь 2026</option><option value="2026-8">август 2026</option><option value="2026-7">июль 2026</option>';
if(byId('periodStart')) {
  window.WBApiCabinet={currentMonth:'2026-10'};
  const rangePeriods=[{year:2026,month:9},{year:2026,month:8},{year:2026,month:7}];
  WBRange.sync(rangePeriods);
  WBDashboard.loadPeriodRange=async(shop,periods,marketplace)=>new Map(periods.map(p=>{const scale=p.month/9;return [p.year+'-'+p.month,{available:true,report:{...d.rep,year:p.year,month:p.month,sales_amount:Math.round(d.rep.sales_amount*scale),transfer_goods:Math.round(d.rep.sales_amount*.8*scale),transfer_total:Math.round(d.rep.transfer_total*scale),bought_qty:Math.round(d.rep.bought_qty*scale),ads_spend:Math.round(d.rep.ads_spend*scale),external_promotion_expenses:0,operational_expenses:0,marketplace},skus:rows.slice(0,2).map(row=>({...row,bought_qty:Math.round(row.bought_qty*scale),revenue:Math.round(row.revenue*scale)})),costMap:new Map(rows.map(row=>[row.article,row.cost_price]))}];}));
  let rangeTicket=0,rangeTrend=trend;
  const drawRange=async()=>{
    const ticket=++rangeTicket;
    if(!WBRange.active){rangeTrend=trend;WBDashboard.renderKPI(byId('kpiRow'),d,prev,'wildberries',{onSelect:metric=>WBDashboard.renderTrend(byId('trendChart'),rangeTrend,metric,'wildberries')});drawTrend('sales');return;}
    byId('rangeNotice').textContent='Считаем итоги…';
    const result=await WBRange.load({shop:{id:'synthetic-preview',tax_rate:5},scope:'wildberries',api:false,...WBRange.selection(),isCurrent:()=>ticket===rangeTicket});
    if(!result)return;rangeTrend=result.trend;
    WBDashboard.renderKPI(byId('kpiRow'),result.derived,result.previous,'wildberries',{comparisonLabel:'к предыдущему периоду',onSelect:metric=>WBDashboard.renderTrend(byId('trendChart'),rangeTrend,metric,'wildberries')});
    WBDashboard.renderTrend(byId('trendChart'),rangeTrend,'sales','wildberries');
    WBDashboard.renderExpenses(byId('expList'),byId('expTotal'),byId('expChart'),result.derived,'wildberries',result.previous);
    WBDashboard.renderSkuTable(byId('skuBody'),byId('skuFoot'),byId('skuHint'),byId('skuChart'),result.derived,result.previous);
    byId('rangeNotice').textContent=WBRange.label(result.selected)+' · '+result.selected.length+' мес. Сравнение: '+WBRange.label(result.comparison)+'. Правка расходов, ИИ-анализ, обновление из WB — в режиме «Месяц».';
  };
  WBRange.wire(drawRange,()=>{byId('secManualExpenses').hidden=WBRange.active;byId('secAiAnalysis').hidden=WBRange.active;});
  byId('periodSelect').addEventListener('change',()=>{WBRange.clamp();drawRange();});
}
if(byId('shareUrl')) byId('shareUrl').textContent='https://wb-platform.netlify.app/s/very-long-store-name';
// Connected API settings must be tested too, not only the empty/disconnected form.
if(byId('wbApiCheckBtn')) {
  const disconnected=location.search.includes('disconnected');
  byId('wbApiConnectBtn').textContent=disconnected?'Сохранить и проверить':'Заменить ключ и проверить';
  byId('wbApiCheckBtn').hidden=disconnected;
  byId('wbApiDisconnectBtn').hidden=disconnected;
  byId('wbApiConnectionStatus').textContent=disconnected?'API ещё не подключён к этому магазину':'Подключён продавец WB: Тестовый магазин. Проверено: 10.10.2026, 19:00:00. Ключ действует до 10.04.2027, 07:23:04';
  byId('apiCabinetMonth').value='2026-09';
  byId('apiCabinetSync').textContent=disconnected?'Загрузить данные':'Обновить расчёт';
  byId('apiCabinetRefresh').hidden=disconnected;
  byId('apiCabinetStatus').textContent=disconnected?'Подключите API магазина':'Выгрузка готова · сентябрь 2026 · данные загружены по 30.09.2026';
  byId('apiCabinetSources').innerHTML='<li><strong>Финансовый отчёт</strong><span>Загружен · 30.09.2026</span></li><li><strong>Внутренняя реклама</strong><span>Загружена · 30.09.2026</span></li><li><strong>Медийная реклама</strong><span>Расходов за этот месяц нет</span></li>';
  byId('apiCabinetFinance').innerHTML='<div><dt>Итого к перечислению после удержаний маркетплейса</dt><dd>999 999 999,99 ₽</dd></div><div><dt>Корректировки вознаграждения и компенсации</dt><dd>−123 456 789,99 ₽</dd></div>';
  byId('apiCabinetAds').innerHTML='<div><dt>Расходы на внутреннюю рекламу</dt><dd>226 553 ₽</dd></div><div><dt>Промобонусы (не уменьшают чистую прибыль)</dt><dd>77 511 ₽</dd></div>';
  byId('apiOperationalExpenses').value='10000';
  byId('apiExternalExpenses').value='5000';
  byId('taxRateInput').value='5';
}
if(byId('costsBody')) byId('costsBody').innerHTML=rows.map(r=>'<tr><td class="mono">'+r.article+'</td><td>'+r.name+'</td><td data-label="Себестоимость за шт., ₽"><input class="cost-input" type="number" aria-label="Себестоимость" value="398"></td><td><button class="ghost small save-cost-btn" disabled>Сохранить</button></td></tr>').join('');
if(byId('membersBody')) byId('membersBody').innerHTML='<tr><td>@very_long_username_for_test</td><td>Ожидает входа</td><td><button class="ghost small">Убрать</button></td></tr>';
if(byId('uploadsBody')) byId('uploadsBody').innerHTML='<tr><td>Длинное название загруженного отчета за сентябрь 2026.xlsx</td><td>Wildberries</td><td>Сводный отчет</td><td>сентябрь 2026</td><td>10.10.2026</td><td><button class="ghost small">Отменить</button></td></tr>';
if(byId('questionsBody')) byId('questionsBody').innerHTML='<tr><td>@example</td><td>Длинный вопрос пользователя о работе финансового отчёта</td><td>10.10.2026</td><td>Новый</td><td><button class="ghost small">Закрыть</button></td></tr>';
const activate=()=>{const route=location.hash.slice(1)||'overview';document.querySelectorAll('.app-view').forEach(e=>{const active=e.dataset.view===route;e.hidden=!active;e.classList.toggle('is-active',active)});document.querySelectorAll('.side-menu [data-view]').forEach(e=>e.classList.toggle('active',e.dataset.view===route));screen.classList.remove('menu-open');if(byId('overviewControls'))byId('overviewControls').hidden=route!=='overview';if(byId('pageTitle'))byId('pageTitle').textContent=({overview:'Обзор',reports:'Отчёты',costs:'Себестоимость',team:'Команда',settings:'Настройки',account:'Учётная запись'})[route];window.scrollTo(0,0);WBShell.motion.enter(route)};
if(byId('appScreen')){activate();window.addEventListener('hashchange',()=>WBShell.motion.navigate(activate));byId('mobileMenuBtn').onclick=()=>screen.classList.toggle('menu-open');byId('menuScrim').onclick=()=>screen.classList.remove('menu-open');byId('askQuestionBtn').onclick=()=>{screen.classList.remove('menu-open');byId('questionModal').hidden=false};byId('questionCancelBtn').onclick=()=>WBShell.motion.hideModal(byId('questionModal'));document.querySelectorAll('.collapse-btn').forEach(b=>b.onclick=()=>b.closest('section').classList.toggle('collapsed'));}
</script><style>.fixture-static *{animation:none!important;transition:none!important}.fixture-static{scroll-behavior:auto!important}</style>`;
http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  const pathname=url.pathname==='/'?'/app.html':decodeURIComponent(url.pathname);
  // A fixed-size browsing context keeps responsive captures reproducible even
  // when a host's background-tab viewport override is unavailable.
  if(pathname==='/responsive.html') {
    const width=Math.max(320,Math.min(1920,Number(url.searchParams.get('width'))||390));
    const height=Math.max(600,Math.min(1200,Number(url.searchParams.get('height'))||844));
    const route=['overview','settings','account','reports','costs','team'].includes(url.hash.slice(1))?url.hash.slice(1):'overview';
    const selected=url.searchParams.get('view');
    const view=['overview','settings','account','reports','costs','team'].includes(selected)?selected:route;
    res.setHeader('Content-Type','text/html');res.setHeader('Cache-Control','no-store');
    const expenses=['long','unknown','empty'].includes(url.searchParams.get('expenses'))?'&amp;expenses='+url.searchParams.get('expenses'):'';
    const motion=url.searchParams.get('motion')==='1'?'':'still=1&amp;';
    const series=['negative','unknown'].includes(url.searchParams.get('series'))?'&amp;series='+url.searchParams.get('series'):'';
    res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0}iframe{display:block;border:0}</style></head><body><iframe title="Responsive seller workspace" width="'+width+'" height="'+height+'" src="/app.html?'+motion+'assets=7'+expenses+series+'#'+view+'"></iframe></body></html>');return;
  }
  const file=path.resolve(root,'.'+pathname);
  if(!file.startsWith(root+path.sep)||(!pathname.startsWith('/assets/')&&!['/app.html','/index.html','/admin.html'].includes(pathname))){res.writeHead(404).end();return;}
  try{let content=fs.readFileSync(file);const ext=path.extname(file);
    if(ext==='.html')content=content.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>',fixture+'</body>');
    res.setHeader('Content-Type',({'html':'text/html','css':'text/css','js':'application/javascript','svg':'image/svg+xml','png':'image/png'})[ext.slice(1)]||'application/octet-stream');
    res.setHeader('Cache-Control','no-store');res.end(content);
  }catch{res.writeHead(404).end();}
}).listen(4178,'127.0.0.1',()=>console.log('Synthetic mobile fixture: http://127.0.0.1:4178/app.html'));
