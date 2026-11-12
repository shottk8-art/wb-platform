// Local UI fixture: synthetic inventory, production markup/styles/controllers.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inventoryView} from '../supabase/functions/wb-api/stocks.ts';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const user='bbb002c4-cd7a-490d-b9c0-72aed5424261',shop='853b81a0-e0e2-4195-bc80-1cdc362af946';
const names=['Сыворотка для роста ресниц и бровей 2 мл','Гель для укладки и фиксации бровей','Керлер для ресниц','Набор сыворотки и туши для ресниц'];
const snapshot={wb_checked_at:new Date().toISOString(),seller_checked_at:new Date().toISOString(),demand:{from:'2026-10-15',to:'2026-11-11',days:28},catalogue:Array.from({length:18},(_,i)=>({nm_id:String(i+1),article:'test-'+(112+i),name:names[i%4],orders:i===5?0:28*(i+1)})),rows:Array.from({length:54},(_,i)=>({nm_id:String(i%18+1),size_id:String(i%18+100),warehouse_id:'wb:'+Math.floor(i/18),warehouse:['Коледино','Казань · Столбище','Санкт-Петербург · Шушары'][Math.floor(i/18)],kind:'wb',region:'Россия',quantity:i%18===2?0:i%18===0?3:(i%18+1)*20,to_client:2,from_client:1}))};
http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');res.setHeader('Cache-Control','no-store');
 if(url.pathname==='/responsive.html'){
  const width=Math.max(320,Math.min(3440,Number(url.searchParams.get('width'))||1440)),height=Math.max(600,Math.min(1400,Number(url.searchParams.get('height'))||1100));
  const theme=url.searchParams.get('theme')==='dark'?'dark':'light',state=['empty','loading','error','long'].includes(url.searchParams.get('state'))?url.searchParams.get('state'):'ready',scale=Math.min(1,1100/width);
  res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#dfe4f4}iframe{display:block;border:0;width:${width}px;height:${height}px;transform:scale(${scale});transform-origin:top left}</style><iframe title="Остатки · синтетические тестовые данные" src="/app.html?theme=${theme}&state=${state}#stocks"></iframe>`);
 }
 const pathname=url.pathname==='/'?'/app.html':decodeURIComponent(url.pathname),file=path.resolve(root,'.'+pathname);
 if(!file.startsWith(root+path.sep)||!pathname.startsWith('/assets/')&&pathname!=='/app.html'){res.writeHead(404);return res.end();}
 try{
  let content=fs.readFileSync(file);const ext=path.extname(file);
  if(pathname==='/app.html'){
   const sample=structuredClone(snapshot),state=url.searchParams.get('state');if(state==='empty'){sample.rows=[];sample.catalogue=[];}if(state==='long'){sample.catalogue[0].name='Сыворотка для укрепления и роста ресниц и бровей с комплексом активных компонентов — набор из трёх средств, 2 мл';sample.catalogue[0].article='very-long-article-123456789012345678901234567890';}
   const data={status:state==='loading'?'loading':state==='error'?'error':'ready',fetched_at:snapshot.wb_checked_at,settings:{alert_days:14,target_days:30},inventory:state==='loading'?null:inventoryView(sample,{alert_days:14,target_days:30}),stale:state==='error',error:state==='error'?'WB временно не отвечает. Показан последний снимок.':null};
   const serial=JSON.stringify(data).replace(/</g,'\\u003c');
   const scripts=`<script src="/assets/corbel.js"></script><script src="/assets/corbel-components.js"></script><script src="/assets/reference.js"></script><script>const e=id=>document.getElementById(id);document.documentElement.dataset.theme=${JSON.stringify(url.searchParams.get('theme')==='dark'?'dark':'light')};e('loadingScreen').hidden=true;e('appScreen').hidden=false;e('emptyShopNotice').hidden=true;document.querySelectorAll('.app-view').forEach(x=>{const on=x.id==='secStocks';x.hidden=!on;x.classList.toggle('is-active',on)});e('overviewControls').hidden=true;e('pageTitle').textContent='Остатки · тестовые данные';let excludedFixture={};window.WBApi={connected:true,shopId:'${shop}',subscribe(){},cabinet:async(action,month,refresh,payload)=>{const d=${serial};if(action==='stocks_settings'){d.settings={alert_days:payload.alert_days,target_days:payload.target_days};}if(action==='stocks_tracking'){if(payload.excluded)excludedFixture[payload.nm_id]=true;else delete excludedFixture[payload.nm_id];}if(d.inventory){d.inventory.products.forEach(p=>p.excluded=!!excludedFixture[p.nm_id]);const tracked=d.inventory.products.filter(p=>!p.excluded);Object.assign(d.inventory.totals,{quantity:tracked.reduce((n,p)=>n+p.quantity,0),products:tracked.length,excluded:d.inventory.products.length-tracked.length,low:tracked.filter(p=>p.status==='low').length,out:tracked.filter(p=>p.status==='out').length,unknown:tracked.filter(p=>p.status==='unknown').length});}return d;}};</script><script src="/assets/stocks.js"></script><script>WBStock.setContext({userId:'${user}',shopId:'${shop}',active:true});document.addEventListener('wb-open-stocks',()=>WBStock.setContext({userId:'${user}',shopId:'${shop}',active:true}));</script>`;
   content=content.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace('</body>',scripts+'</body>');
  }
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[ext]||'application/octet-stream');res.end(content);
 }catch{res.writeHead(404);res.end();}
}).listen(4192,'127.0.0.1',()=>console.log('Inventory UI fixture: http://127.0.0.1:4192/responsive.html?width=1440'));
