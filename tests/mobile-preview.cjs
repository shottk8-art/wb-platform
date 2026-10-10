// Local, synthetic responsive fixture. Never contacts Supabase or WB.
// Run: node tests/mobile-preview.cjs; inspect http://127.0.0.1:4178/app.html
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const fixture = `
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.5.1/chart.umd.min.js"></script>
<script src="/assets/dashboard.js"></script>
<script>
const byId=id=>document.getElementById(id);
byId('loadingScreen').hidden=true;
const screen=byId('appScreen')||byId('adminScreen')||byId(location.search.includes('login')?'authScreen':'publicScreen');
screen.hidden=false;
const rows=[{article:'chlorophill/450new',name:'Хлорофилл жидкий пищевой',bought_qty:854,revenue:1182101,cost_price:398,total_cost:339892,profit:842209,abc:'A'},
{article:'magnesium/90',name:'Магний В6 Хелат 400 мг Бисглицинат (глицинат)',bought_qty:28,revenue:24950,cost_price:251,total_cost:7028,profit:17922,abc:'C'},
{article:'very-long-article-code-without-spaces-1234567890',name:'Очень длинное название товара для проверки переноса текста на маленьком экране',bought_qty:100001,revenue:99999999,cost_price:1,total_cost:100001,profit:-12345678,abc:'B'}];
const d={skuRows:rows,expenses:[['Себестоимость товара',696198],['Очень длинное название удержания маркетплейса',238988],['WB Продвижение',226553]],rep:{sales_amount:2231708,bought_qty:1455,transfer_total:1826845,ads_spend:226553,wb_media_spend:0,ads_promo_spend:77511},netProfit:792508,rates:{drrOrders:6.3,drrSales:10.2}};
const prev={...d,skuRows:rows.map(r=>({...r,bought_qty:r.bought_qty-12,revenue:r.revenue-46687,profit:r.profit-59423})),expenses:[['Себестоимость товара',481112],['Очень длинное название удержания маркетплейса',291552],['WB Продвижение',242868]]};
if(byId('skuBody')) WBDashboard.renderSkuTable(byId('skuBody'),byId('skuFoot'),byId('skuHint'),byId('skuChart'),d,prev);
if(byId('expList')) WBDashboard.renderExpenses(byId('expList'),byId('expTotal'),byId('expChart'),d,'wildberries',prev);
if(byId('kpiRow')) WBDashboard.renderKPI(byId('kpiRow'),d,prev,'wildberries');
if(byId('shopSwitch')) byId('shopSwitch').innerHTML='<option>Тестовый магазин · длинное название</option>';
if(byId('periodSelect')) byId('periodSelect').innerHTML='<option>сентябрь 2026</option>';
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
const activate=()=>{const route=location.hash.slice(1)||'overview';document.querySelectorAll('.app-view').forEach(e=>{const active=e.dataset.view===route;e.hidden=!active;e.classList.toggle('is-active',active)});screen.classList.remove('menu-open');if(byId('pageTitle'))byId('pageTitle').textContent=({overview:'Обзор',reports:'Отчёты',costs:'Себестоимость',team:'Команда',settings:'Настройки'})[route];window.scrollTo(0,0)};
if(byId('appScreen')){activate();window.addEventListener('hashchange',activate);byId('mobileMenuBtn').onclick=()=>screen.classList.toggle('menu-open');byId('menuScrim').onclick=()=>screen.classList.remove('menu-open');byId('askQuestionBtn').onclick=()=>{screen.classList.remove('menu-open');byId('questionModal').hidden=false};byId('questionCancelBtn').onclick=()=>byId('questionModal').hidden=true;document.querySelectorAll('.collapse-btn').forEach(b=>b.onclick=()=>b.closest('section').classList.toggle('collapsed'));}
</script>`;
http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  const pathname=url.pathname==='/'?'/app.html':decodeURIComponent(url.pathname);
  const file=path.resolve(root,'.'+pathname);
  if(!file.startsWith(root+path.sep)||(!pathname.startsWith('/assets/')&&!['/app.html','/index.html','/admin.html'].includes(pathname))){res.writeHead(404).end();return;}
  try{let content=fs.readFileSync(file);const ext=path.extname(file);
    if(ext==='.html')content=content.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>',fixture+'</body>');
    res.setHeader('Content-Type',({'html':'text/html','css':'text/css','js':'application/javascript','svg':'image/svg+xml','png':'image/png'})[ext.slice(1)]||'application/octet-stream');
    res.setHeader('Cache-Control','no-store');res.end(content);
  }catch{res.writeHead(404).end();}
}).listen(4178,'127.0.0.1',()=>console.log('Synthetic mobile fixture: http://127.0.0.1:4178/app.html'));
