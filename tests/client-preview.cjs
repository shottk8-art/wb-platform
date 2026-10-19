// UI-only sandbox. Synthetic user and create callback, never Supabase or WB.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
http.createServer((req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1');res.setHeader('Cache-Control','no-store');
  if(u.pathname==='/frame.html'){
    const width=Math.max(320,Math.min(1920,Number(u.searchParams.get('width'))||390)),height=Math.max(600,Math.min(1200,Number(u.searchParams.get('height'))||844));
    const page=u.searchParams.get('page')==='demo'?'/demo.html':'/client-preview.html?mode='+(['welcome','account','error'].includes(u.searchParams.get('page'))?u.searchParams.get('page'):'welcome');
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
  try{const data=fs.readFileSync(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');res.end(data);}catch{res.writeHead(404).end();}
}).listen(4182,'127.0.0.1',()=>console.log('Client-only fixture: http://127.0.0.1:4182/client-preview.html'));
