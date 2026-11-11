// Local visual fixture only: real markup/styles/controllers, synthetic responses.
// Open /responsive.html?width=1440&height=1000 or width=390 for a fixed CSS viewport.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const names=['Сыворотка для роста ресниц и бровей 2 мл','Сыворотка для роста ресниц и бровей','Гель для укладки и фиксации бровей','Набор сыворотка и тушь для ресниц','Подводка со штампом','Керлер для ресниц'];
const fixture={status:'ready',period:{dateFrom:'2026-11-01',dateTo:'2026-11-11'},totals:{sales:'15470774.48',net_profit:'2502757.72',internal_ads:'1423234.00',drr:9.2},products:Array.from({length:18},(_,i)=>({article:'test-'+(112+i),name:names[i%names.length],quantity:3049-i*100,sales:String(6386838/(i+1)),net_profit:i===5?'-39167.49':String(826963/(i+1)),internal_ads:String(972493/(i+1)),drr:15.2-i*.3,margin:12.9,profitability:14.9,expenses:[{key:'commission',label:'Комиссия и расчёты WB',amount:'2975626.92'},{key:'logistics',label:'Логистика',amount:'213196.57'},{key:'storage',label:'Хранение',amount:'0'},{key:'acceptance',label:'Приёмка',amount:'7340'},{key:'penalty',label:'Штрафы',amount:'5829.08'},{key:'other',label:'Прочие удержания',amount:'0'},{key:'loyalty',label:'Отзывы и лояльность',amount:'119413.42'},{key:'internal',label:'Внутренняя реклама',amount:'972493'},{key:'media',label:'WB Медиа в финансовом отчёте',amount:'0'},{key:'cogs',label:'Себестоимость',amount:'914700'},{key:'tax',label:'Налог с продаж',amount:'351276.12'}]})),common_expenses:[{key:'storage',label:'Хранение',amount:'6147.62'},{key:'other',label:'Прочие удержания',amount:'68779'},{key:'media',label:'WB Медиа в финансовом отчёте',amount:'532567'}]};
http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 res.setHeader('Cache-Control','no-store');
 if(url.pathname==='/responsive.html'){
  const width=Math.max(320,Math.min(2400,Number(url.searchParams.get('width'))||1440)),height=Math.max(600,Math.min(1400,Number(url.searchParams.get('height'))||1000));
  const theme=url.searchParams.get('theme')==='dark'?'dark':'light',state=['empty','unknown','loading'].includes(url.searchParams.get('state'))?url.searchParams.get('state'):'ready';
  const scale=Math.min(1,860/width);
  res.setHeader('Content-Type','text/html; charset=utf-8');
  return res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#dfe4f4}iframe{display:block;border:0;width:${width}px;height:${height}px;transform:scale(${scale});transform-origin:top left}</style><iframe title="Проверка юнит-экономики на тестовых данных" src="/app.html?theme=${theme}&state=${state}#daily"></iframe>`);
 }
 const pathname=url.pathname==='/'?'/app.html':decodeURIComponent(url.pathname),file=path.resolve(root,'.'+pathname);
 if(!file.startsWith(root+path.sep)||(!pathname.startsWith('/assets/')&&pathname!=='/app.html')){res.writeHead(404);return res.end();}
 try{
  let content=fs.readFileSync(file);const ext=path.extname(file);
  if(pathname==='/app.html'){
   const data=structuredClone(fixture),state=url.searchParams.get('state');
   if(state==='empty'){data.products=[];data.totals={sales:0,net_profit:0,internal_ads:0,drr:null};}
   if(state==='unknown'){Object.assign(data.products[0],{advertising_unknown:true,missing_costs:true,net_profit:null,total_expenses:null,margin:null,profitability:null,drr:null,internal_ads:null});data.totals.net_profit=null;data.totals.internal_ads=null;data.totals.drr=null;}
   if(state==='loading')Object.assign(data,{status:'loading',pending:[{month:'2026-11',status:'loading'}]});
   const scripts=`<script src="/assets/corbel.js"></script><script src="/assets/corbel-components.js"></script><script src="/assets/reference.js"></script>
<script>const e=id=>document.getElementById(id);document.documentElement.dataset.theme=${JSON.stringify(url.searchParams.get('theme')==='dark'?'dark':'light')};e('loadingScreen').hidden=true;e('appScreen').hidden=false;document.querySelectorAll('.app-view').forEach(x=>{const on=x.id==='secDailyAnalytics';x.hidden=!on;x.classList.toggle('is-active',on)});e('overviewControls').hidden=true;e('dailyPane').hidden=true;e('unitPane').hidden=false;e('unitTab').setAttribute('aria-selected','true');e('dailyTab').setAttribute('aria-selected','false');e('pageTitle').textContent='Юнит-экономика · тестовые данные';window.WBDaily={allowed:()=>true};window.WBApi={connected:false,cabinet:async()=>(${JSON.stringify(data)})};</script><script src="/assets/unit-economics.js"></script><script>WBUnit.setContext({userId:'local-fixture',shopId:'local-fixture',active:true});</script>`;
   content=content.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>',scripts+'</body>');
  }
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[ext]||'application/octet-stream');res.end(content);
 }catch{res.writeHead(404);res.end();}
}).listen(4189,'127.0.0.1',()=>console.log('Unit visual fixture: http://127.0.0.1:4189/responsive.html?width=1440&height=1000'));
