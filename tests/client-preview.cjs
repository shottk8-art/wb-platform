// UI-only sandbox. Synthetic user and create callback, never Supabase or WB.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
function entryFixture({signedIn=false,fresh=false,authFail=false,settings=false,member=false,renameFail=false,profit=false}={}){
  return `<script>
    const fixtureUser={id:'fixture-new-client',user_metadata:{full_name:'Тест первого входа'}};
    const fixtureSession={user:fixtureUser,access_token:'local-fixture-only',refresh_token:'local-fixture-only'};
    if(${fresh}){sessionStorage.removeItem('fixture-auth');sessionStorage.removeItem('fixture-shops');sessionStorage.removeItem('wb-onboarding-draft:v1');sessionStorage.removeItem('wb-test-subscription:v1:guest-onboarding');}
    if(${signedIn})sessionStorage.setItem('fixture-auth','yes');
    const fixtureShops=JSON.parse(sessionStorage.getItem('fixture-shops')||'[]');
    if(${settings}&&!fixtureShops.length){
      fixtureShops.push(...['A','B'].map(letter=>({id:'fixture-shop-'+letter,owner_id:${member}?'fixture-owner':fixtureUser.id,name:'Тестовый магазин '+letter,slug:'fixture-'+letter,share_enabled:false,tax_rate:6})));
      sessionStorage.setItem('fixture-shops',JSON.stringify(fixtureShops));
    }
    document.body.dataset.fixtureCreates=String(fixtureShops.length);
    document.body.dataset.fixtureNameWrites='0';
    document.body.dataset.fixtureAuthFail=String(${authFail});
    window.WB_CONFIG={SUPABASE_URL:location.origin+${JSON.stringify(profit?'/profit-fixture':'')},SUPABASE_ANON_KEY:'local-fixture-only'};
    const fixtureCosts=${JSON.stringify(['9209','5101','420','6001'].map((article,i)=>({article,name:['Парфюмированный мист','Двухфазный кондиционер','Набор для ухода за лицом','Альгинатная маска'][i],cost_price:0})).concat([{article:'READY',name:'Товар с заполненной себестоимостью',cost_price:100}]))};
    window.supabaseClient={
      auth:{
        getSession:async()=>({data:{session:sessionStorage.getItem('fixture-auth')?fixtureSession:null}}),
        verifyOtp:async()=>({data:{session:fixtureSession},error:null}),
        setSession:async()=>{sessionStorage.setItem('fixture-auth','yes');return{error:null};},
        signOut:async()=>{sessionStorage.removeItem('fixture-auth');return{error:null};}
      },
      rpc:async name=>({data:name==='is_admin'?false:[],error:null}),
      from(table){let single=false,filters={},created=null,updated=null;const q={
        select(){return q;},eq(k,v){filters[k]=v;return q;},order(){return q;},range(){return q;},in(){return q;},limit(){return q;},gte(){return q;},lte(){return q;},is(){return q;},
        insert(value){if(table!=='shops')throw Error('Fixture write blocked');created={id:'fixture-created-shop',share_enabled:false,tax_rate:0,created_at:new Date().toISOString(),...value};fixtureShops.push(created);sessionStorage.setItem('fixture-shops',JSON.stringify(fixtureShops));document.body.dataset.fixtureCreates=String(fixtureShops.length);return q;},
        update(value){if(table!=='shops'||Object.keys(value).join(',')!=='name')throw Error('Fixture write blocked');updated=value;return q;},
        single(){single=true;return q;},maybeSingle(){single=true;return q;},
        then(ok,bad){
          const rows=table==='shops'?fixtureShops.filter(s=>Object.entries(filters).every(([k,v])=>s[k]===v)):table==='sku_costs'&&${profit}?fixtureCosts:table==='shop_members'&&filters.user_id&&${member}?[{shops:fixtureShops[0]}]:[];
          if(updated){
            if(${renameFail}||rows.length!==1||rows[0].owner_id!==fixtureUser.id||filters.owner_id!==fixtureUser.id)return Promise.resolve({data:null,error:{code:'PGRST116'}}).then(ok,bad);
            rows[0].name=updated.name;sessionStorage.setItem('fixture-shops',JSON.stringify(fixtureShops));document.body.dataset.fixtureNameWrites=String(Number(document.body.dataset.fixtureNameWrites)+1);
          }
          return Promise.resolve({data:created||(single?rows[0]||null:rows),error:null}).then(ok,bad);
        }
      };return q;}
    };
  </script>`;
}
http.createServer((req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1');res.setHeader('Cache-Control','no-store');
  if(['/entry-preview.html','/settings-preview.html','/profit-preview.html','/guest-preview.html','/index.html','/app.html'].includes(u.pathname)){
    // Run the actual index/app scripts. Only auth and data transport are fixtures.
    // Nothing in this fixture can read or write a real user, shop or WB API.
    const fixture=entryFixture({signedIn:['/entry-preview.html','/settings-preview.html','/profit-preview.html'].includes(u.pathname),fresh:u.searchParams.has('fresh'),authFail:u.searchParams.has('authfail'),settings:['/settings-preview.html','/profit-preview.html'].includes(u.pathname),member:u.searchParams.has('member'),renameFail:u.searchParams.has('renamefail'),profit:u.pathname==='/profit-preview.html'});
    const file=['/entry-preview.html','/settings-preview.html','/profit-preview.html','/app.html'].includes(u.pathname)?'app.html':'index.html';
    let html=fs.readFileSync(path.join(root,file),'utf8');
    html=html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase[^>]*><\/script>/,fixture)
      .replace(/<script src="\/assets\/(?:config|supabaseClient)\.js"><\/script>/g,'')
      .replace('https://telegram.org/js/telegram-widget.js?22','/fixture-telegram-widget.js');
    res.setHeader('Content-Type','text/html');res.end(html);return;
  }
  if(u.pathname==='/fixture-telegram-widget.js'){
    res.setHeader('Content-Type','text/javascript');res.end(`const button=document.createElement('button');button.type='button';button.textContent='Войти через Telegram (локальный тест)';button.onclick=()=>window.onTelegramAuth({fixture:true,fail:document.body.dataset.fixtureAuthFail==='true'});document.getElementById('telegramLoginBox').appendChild(button);`);return;
  }
  if(u.pathname==='/functions/v1/telegram-auth'){
    let body='';req.on('data',part=>body+=part);req.on('end',()=>{const fail=JSON.parse(body||'{}').fail;res.writeHead(fail?503:200,{'Content-Type':'application/json'});res.end(JSON.stringify(fail?{error:'Тест: вход временно недоступен'}:{token_hash:'local-fixture-only',type:'magiclink'}));});return;
  }
  if(u.pathname==='/functions/v1/wb-api'){
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({connection:null}));return;
  }
  if(u.pathname==='/profit-fixture/functions/v1/wb-api'){
    let body='';req.on('data',part=>body+=part);req.on('end',()=>{
      const input=JSON.parse(body||'{}'),month=input.month||'2026-09',missing=month==='2026-08',base={sales:10000,quantity:20,transfer:7000,orders:12000,internalAds:100,mediaAds:0,promo:0};
      const products=missing?['9209','5101','420','6001'].map(article=>({article,name:'Товар '+article,bought_qty:1,revenue:'1000.00',cost_price:0})): [{article:'READY',name:'Товар с заполненной себестоимостью',bought_qty:20,revenue:'10000.00',cost_price:100}];
      const cabinet={shop:{id:input.shop_id,name:'Тестовый магазин',tax_rate:6},job:{id:'fixture-'+month,status:'complete',updated_at:new Date().toISOString(),row_count:200},period:{dateFrom:month+'-01',dateTo:month+'-28'},complete:true,finance:{retailAmount:10000,bought_qty:20,forPay:8000,deliveryService:1000,paidStorage:0,paidAcceptance:0,penalty:0,deduction:0},cogs:missing?null:2000,net_profit:missing?null:4300,missing_costs:missing?products.map(p=>p.article):[],products,economy:{payout:7000,tax:600,internal_ads:100,promo:0,advertising_total:100,missing:missing?['Не заполнена себестоимость']:[]},settings:{operational_expenses:0,external_promotion_expenses:0},sources:{finance:{status:'downloaded'},orders:{status:'downloaded',amount:12000,count:25},ads:{status:'downloaded',totals:{'Баланс':{amount:100}},undated:0},media:{status:'downloaded',amount:0}}};
      const trend=[{...base,year:2026,month:9,profit:4300},{...base,year:2026,month:8,profit:null}];
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(input.action==='status'?{connection:{seller_name:'Тестовое подключение'}}:{cabinet,trend,revision:'profit-fixture',history_loading:false,jobs:[cabinet.job]}));
    });return;
  }
  if(u.pathname==='/frame.html'){
    const width=Math.max(320,Math.min(1920,Number(u.searchParams.get('width'))||390)),height=Math.max(600,Math.min(1200,Number(u.searchParams.get('height'))||844));
    const page=u.searchParams.get('page')==='profit'?'/profit-preview.html?fresh=1#overview':u.searchParams.get('page')==='settings'?'/settings-preview.html?fresh=1#settings':u.searchParams.get('page')==='demo'?'/demo.html':u.searchParams.get('page')==='guest'?'/guest-preview.html?fresh=1':'/client-preview.html?mode='+(['welcome','account','error'].includes(u.searchParams.get('page'))?u.searchParams.get('page'):'welcome');
    res.setHeader('Content-Type','text/html');res.end(`<html><body style="margin:0"><iframe title="Client preview" style="display:block;border:0" width="${width}" height="${height}" src="${page}"></iframe></body></html>`);return;
  }
  if(u.pathname==='/client-preview.html'){
    res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Тест онбординга</title><link rel="stylesheet" href="/assets/styles.css"><link rel="stylesheet" href="/assets/corbel.css"><link rel="stylesheet" href="/assets/reference.css"><link rel="stylesheet" href="/assets/client-start.css"><script src="/assets/corbel.js"></script></head><body class="corbel"><div id="loadingScreen">Загрузка…</div><main id="clientWelcome" class="client-welcome" hidden></main><main id="clientFixtureAccount" style="max-width:1000px;margin:24px auto;padding:0 16px" hidden><h1>Учётная запись · тест</h1><button type="button" class="ghost" data-theme-toggle>Переключить тему</button><button id="showClientGuide" type="button">Начало работы</button><div id="clientGuide" class="client-guide"></div><div id="testBillingRoot"></div><p id="createdShop" role="status"></p></main><script src="/assets/test-subscription.js"></script><script src="/assets/client-start.js"></script><script>
    const mode=new URLSearchParams(location.search).get('mode'),user={id:'local-fixture-'+(mode||'welcome')};let attempts=0;
    const mount=()=>{document.getElementById('loadingScreen').hidden=true;document.getElementById('clientFixtureAccount').hidden=false;WBClientStart.mount(user,{navigate:view=>document.getElementById('createdShop').textContent='Открыт раздел: '+view});};
    if(mode==='account')mount();else WBClientStart.firstShop(user,{signOut:()=>location.reload(),createShop:async(name,marketplace)=>{attempts++;document.body.dataset.createAttempts=attempts;await new Promise(r=>setTimeout(r,300));if(mode==='error'&&attempts===1)throw new Error('Fixture network failure');return{id:'fixture-shop',name,marketplace};}}).then(({shop})=>{mount();document.getElementById('createdShop').textContent='Создан тестовый магазин: '+shop.name+' · '+shop.marketplace;});
    </script></body></html>`);return;
  }
  const file=path.resolve(root,'.'+decodeURIComponent(u.pathname));
  if(!file.startsWith(root+path.sep)||(!u.pathname.startsWith('/assets/')&&u.pathname!=='/demo.html')){res.writeHead(404).end();return;}
  try{const data=fs.readFileSync(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');res.end(data);}catch{res.writeHead(404).end();}
}).listen(4182,'127.0.0.1',()=>console.log('Client-only fixture: http://127.0.0.1:4182/client-preview.html'));
