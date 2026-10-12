import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {articleKey,costCatalogue} from '../supabase/functions/wb-api/articles.ts';
import {num,calculate,combine,readPages,apiMetrics,apiProducts} from '../supabase/functions/analyze-results/calculations.ts';
import {readCabinet,aggregateFinanceRows} from '../supabase/functions/wb-api/cabinet.ts';
import {authorizeShop} from '../supabase/functions/wb-api/access.ts';

// Exercise the real handler without credentials or paid OpenAI requests.
const shopId='00000000-0000-4000-8000-000000000001';
const currentSales=Array.from({length:1105},(_,i)=>({shop_id:shopId,year:2026,month:9,marketplace:'wildberries',article:`SKU-${i}`,bought_qty:1,revenue:10}));
currentSales.push({shop_id:shopId,year:2026,month:9,marketplace:'wildberries',article:'TOP-114',bought_qty:2,revenue:4000});
const data={
  shops:[{id:shopId,owner_id:'platform-owner',tax_rate:0}],
  wb_api_month_settings:[],
  wb_api_preview_jobs:[{
    id:'api-september',shop_id:shopId,status:'complete',date_from:'2026-09-01',date_to:'2026-09-30',cursor_id:'0',row_count:3,
    finance_model:aggregateFinanceRows([
      {vendorCode:'TOP-114',sellerOperName:'Продажа',docTypeName:'Продажа',quantity:1,retailAmount:4000,forPay:3000},
      {deduction:70,bonusTypeName:'Оказание услуг «WB Медиа», документ №1'},
      {deduction:20,bonusTypeName:'Оказание услуг «WB Продвижение», документ №2'},
    ]),
    summary:{pilot:{finance_complete:true},api_sources:{orders:{status:'downloaded',orders_amount:'5000',rows:[]},internal_ads:{status:'downloaded',period_totals:{Баланс:{amount:'20'}}},media:{status:'downloaded',amount:'0',date_from:'2026-09-01',date_to:'2026-09-30'}}},
  }],
  monthly_reports:[
    {shop_id:shopId,year:2026,month:9,marketplace:'wildberries',sales_amount:15000,transfer_total:5000,ads_spend:100,wb_media_spend:50},
    {shop_id:shopId,year:2026,month:8,marketplace:'wildberries',sales_amount:100,transfer_total:50},
  ],
  sku_sales:[...currentSales,{shop_id:shopId,year:2026,month:8,marketplace:'wildberries',article:'SKU-1104',bought_qty:3,revenue:100}],
  sku_costs:[...Array.from({length:1105},(_,i)=>({shop_id:shopId,article:`sku-${i}`,cost_price:2})),{shop_id:shopId,article:'Top-114',cost_price:1160},{shop_id:shopId,article:'top-114',cost_price:0}],
  ai_analysis_cache:[{shop_id:shopId,year:2026,month:9,marketplace_scope:'wildberries',analysis:{summary:'cached fixture'}}],
};
let handler,username='karlshott',capturedInput,paidRequests=0,strictCache=false,mockAi=false,spoofUsername=false;
const reads=[];
function query(table) {
  const filters={},lists={};let bounds,limit;
  const result=()=>{
    reads.push({table,filters:{...filters},bounds});
    let rows=data[table].filter(row=>Object.entries(filters).every(([key,value])=>(key==='source_fingerprint'&&!strictCache)||row[key]===value)&&Object.entries(lists).every(([key,values])=>values.includes(row[key])));
    if(bounds)rows=rows.slice(bounds[0],bounds[1]+1);
    if(limit)rows=rows.slice(0,limit);
    return {data:rows,error:null};
  };
  const q={select(){return q},eq(key,value){filters[key]=value;return q},in(key,values){lists[key]=values;return q},order(){return q},limit(n){limit=n;return q},range(a,b){bounds=[a,b];return q},upsert:async(row)=>{assert.equal(table,'ai_analysis_cache');data.ai_analysis_cache=[row];return {error:null}},single:async()=>{const r=result();return {...r,data:r.data[0]||null}},maybeSingle:async()=>{const r=result();return {...r,data:r.data[0]||null}},then(ok,bad){return Promise.resolve(result()).then(ok,bad)}};
  return q;
}
const source=readFileSync(new URL('../supabase/functions/analyze-results/index.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
vm.runInNewContext(stripTypeScriptTypes(source),{
  Deno:{serve(fn){handler=fn},env:{get:()=> 'fixture-only'}},
  createClient:()=>({auth:{getUser:async()=>({data:{user:{id:username==='karlshott'?'platform-owner':'another-user',user_metadata:{telegram_username:spoofUsername?'karlshott':username}}}})},from:query,rpc:async(name)=>{assert.equal(name,'is_admin');return {data:username==='karlshott',error:null}}}),
  articleKey,costCatalogue,num,calculate,combine,readPages,apiMetrics,apiProducts,readCabinet,authorizeShop,
  crypto:{subtle:{digest:async(algorithm,bytes)=>{capturedInput=JSON.parse(new TextDecoder().decode(bytes));return crypto.subtle.digest(algorithm,bytes)}}},
  fetch:async(url,options)=>{assert.ok(mockAi,'External AI must not run without the local response fixture');assert.equal(url,'https://api.openai.com/v1/responses');paidRequests++;const input=JSON.parse(JSON.parse(options.body).input);assert.deepEqual(input,capturedInput);return new Response(JSON.stringify({output:[{content:[{type:'output_text',text:JSON.stringify({summary:'local fixture',health:'neutral',insights:[],actions:[],caveats:[]})}]}]}),{status:200})},
  TextEncoder,Uint8Array,Response,console,
});
function request(id=shopId,authorized=true,extras={}) {
  return new Request('https://fixture.invalid/analyze-results',{method:'POST',headers:authorized?{Authorization:'Bearer fixture-only'}:{},body:JSON.stringify({shop_id:id,year:2026,month:9,marketplace:'wildberries',...extras})});
}
const response=await handler(request());
assert.equal(response.status,200);
assert.equal((await response.json()).cached,true);
assert.equal(capturedInput.current.cogs,4530);
assert.equal(capturedInput.current.net_profit,320);
assert.equal(capturedInput.previous.net_profit,44);
assert.equal(capturedInput.top_products[0].gross_profit,1680);
assert.equal(reads.filter(r=>r.table==='sku_costs').length,2);
assert.equal(reads.filter(r=>r.table==='sku_sales'&&r.filters.month===9).length,2);
assert.ok(reads.every(r=>r.table==='shops'?r.filters.id===shopId:r.filters.shop_id===shopId),'every read must target the selected shop');
assert.equal((await handler(request('00000000-0000-4000-8000-000000000002'))).status,403);
const count=reads.length;
username='another-user';
assert.equal((await handler(request())).status,403);
assert.equal(reads.length,count,'unauthorized accounts must not read analytics or cache');
assert.equal((await handler(request(shopId,false))).status,401);
assert.equal(paidRequests,0);
username='karlshott';
const apiResponse=await handler(request(shopId,true,{source:'api'}));
assert.equal(apiResponse.status,200);
assert.equal((await apiResponse.json()).cached,true);
assert.equal(capturedInput.current.sales,4000,'API analysis must use the displayed API snapshot, not stale file reports');
assert.equal(capturedInput.current.net_profit,1750,'financial media is counted once and COGS matches the catalogue');
assert.equal(capturedInput.current.ads,90);
assert.equal(capturedInput.top_products[0].gross_profit,2840);
assert.equal(capturedInput.previous,null,'no API snapshot means no invented file-based comparison');
data.sku_costs.find(row=>row.article==='Top-114').cost_price=0;
await handler(request(shopId,true,{source:'api'}));
assert.equal(capturedInput.current.net_profit,null,'unfilled API cost prices must remain unknown, not become zero profit');
assert.equal(capturedInput.current.cogs,null);
assert.equal(capturedInput.top_products[0].gross_profit,null);
data.sku_costs.find(row=>row.article==='Top-114').cost_price=1160;
// "All" contains API WB and uploaded Ozon, never the stale WB file rows.
data.monthly_reports.push({shop_id:shopId,year:2026,month:9,marketplace:'ozon',sales_amount:1000,transfer_total:800,ads_spend:50});
data.sku_sales.push({shop_id:shopId,year:2026,month:9,marketplace:'ozon',article:'SKU-0',name:'Ozon fixture',bought_qty:2,revenue:1000});
data.ai_analysis_cache.push({shop_id:shopId,year:2026,month:9,marketplace_scope:'all',analysis:{summary:'mixed cached'}});
await handler(request(shopId,true,{source:'api',marketplace:'all'}));
assert.equal(capturedInput.current.sales,5000);
assert.equal(capturedInput.current.net_profit,2496);
assert.equal(capturedInput.top_products.length,2);
assert.ok(capturedInput.top_products.some(p=>p.marketplace==='ozon'));
// Financial data, not job metadata, determines whether a new request is needed.
strictCache=true;mockAi=true;
let result=await handler(request(shopId,true,{source:'api'}));
assert.equal((await result.json()).cached,false);
assert.equal(paidRequests,1);
data.wb_api_preview_jobs[0].updated_at='2026-10-12T12:34:00Z';
result=await handler(request(shopId,true,{source:'api'}));
assert.equal((await result.json()).cached,true);
assert.equal(paidRequests,1,'unchanged financial values reuse cache, even after snapshot metadata changes');
data.wb_api_month_settings.push({shop_id:shopId,month:'2026-09-01',operational_expenses:'100',external_promotion_expenses:'10'});
result=await handler(request(shopId,true,{source:'api'}));
assert.equal((await result.json()).cached,false);
assert.equal(capturedInput.current.net_profit,1640);
assert.equal(paidRequests,2,'changed manual costs invalidate the cache');
// Comparison uses the previous API month, not its unrelated file report.
const august=structuredClone(data.wb_api_preview_jobs[0]);
august.id='api-august';august.date_from='2026-08-01';august.date_to='2026-08-31';
august.summary.api_sources.media.date_from=august.date_from;august.summary.api_sources.media.date_to=august.date_to;
data.wb_api_preview_jobs.push(august);
await handler(request(shopId,true,{source:'api'}));
assert.equal(capturedInput.previous.sales,4000);
assert.equal(capturedInput.previous.net_profit,1750);
// Source changes cannot accidentally reuse a cached API answer for files.
result=await handler(request());
assert.equal((await result.json()).cached,false);
assert.equal(capturedInput.current.sales,15000);
assert.equal(capturedInput.source,'files');
// Ozon ignores an API source preference and reads only Ozon files.
await handler(request(shopId,true,{source:'api',marketplace:'ozon'}));
assert.equal(capturedInput.current.sales,1000);
assert.equal(capturedInput.current.net_profit,746);
assert.equal(capturedInput.source,'files');
username='another-user';spoofUsername=true;
assert.equal((await handler(request())).status,403,'editable Telegram metadata cannot grant owner-only AI access');
console.log('AI endpoint: PASS (API/files/all/Ozon, exact profit and media, unknown COGS, previous API month, cache invalidation, private shop/account scoping; local AI fixtures only).');
