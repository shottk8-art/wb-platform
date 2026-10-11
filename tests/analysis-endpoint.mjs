import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {articleKey,costCatalogue} from '../supabase/functions/wb-api/articles.ts';
import {num,calculate,combine,readPages} from '../supabase/functions/analyze-results/calculations.ts';

// Exercise the real handler without credentials or paid OpenAI requests.
const shopId='00000000-0000-4000-8000-000000000001';
const currentSales=Array.from({length:1105},(_,i)=>({shop_id:shopId,year:2026,month:9,marketplace:'wildberries',article:`SKU-${i}`,bought_qty:1,revenue:10}));
currentSales.push({shop_id:shopId,year:2026,month:9,marketplace:'wildberries',article:'TOP-114',bought_qty:2,revenue:4000});
const data={
  shops:[{id:shopId,tax_rate:0}],
  monthly_reports:[
    {shop_id:shopId,year:2026,month:9,marketplace:'wildberries',sales_amount:15000,transfer_total:5000,ads_spend:100,wb_media_spend:50},
    {shop_id:shopId,year:2026,month:8,marketplace:'wildberries',sales_amount:100,transfer_total:50},
  ],
  sku_sales:[...currentSales,{shop_id:shopId,year:2026,month:8,marketplace:'wildberries',article:'SKU-1104',bought_qty:3,revenue:100}],
  sku_costs:[...Array.from({length:1105},(_,i)=>({shop_id:shopId,article:`sku-${i}`,cost_price:2})),{shop_id:shopId,article:'Top-114',cost_price:1160},{shop_id:shopId,article:'top-114',cost_price:0}],
  ai_analysis_cache:[{shop_id:shopId,year:2026,month:9,marketplace_scope:'wildberries',analysis:{summary:'cached fixture'}}],
};
let handler,username='karlshott',capturedInput,paidRequests=0;
const reads=[];
function query(table) {
  const filters={},lists={};let bounds;
  const result=()=>{
    reads.push({table,filters:{...filters},bounds});
    let rows=data[table].filter(row=>Object.entries(filters).every(([key,value])=>key==='source_fingerprint'||row[key]===value)&&Object.entries(lists).every(([key,values])=>values.includes(row[key])));
    if(bounds)rows=rows.slice(bounds[0],bounds[1]+1);
    return {data:rows,error:null};
  };
  const q={select(){return q},eq(key,value){filters[key]=value;return q},in(key,values){lists[key]=values;return q},order(){return q},range(a,b){bounds=[a,b];return q},maybeSingle:async()=>{const r=result();return {...r,data:r.data[0]||null}},then(ok,bad){return Promise.resolve(result()).then(ok,bad)}};
  return q;
}
const source=readFileSync(new URL('../supabase/functions/analyze-results/index.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
vm.runInNewContext(stripTypeScriptTypes(source),{
  Deno:{serve(fn){handler=fn},env:{get:()=> 'fixture-only'}},
  createClient:()=>({auth:{getUser:async()=>({data:{user:{user_metadata:{telegram_username:username}}}})},from:query}),
  articleKey,costCatalogue,num,calculate,combine,readPages,
  crypto:{subtle:{digest:async(algorithm,bytes)=>{capturedInput=JSON.parse(new TextDecoder().decode(bytes));return crypto.subtle.digest(algorithm,bytes)}}},
  fetch:async()=>{paidRequests++;throw Error('Paid requests must not run in this test')},
  TextEncoder,Uint8Array,Response,console,
});
function request(id=shopId,authorized=true) {
  return new Request('https://fixture.invalid/analyze-results',{method:'POST',headers:authorized?{Authorization:'Bearer fixture-only'}:{},body:JSON.stringify({shop_id:id,year:2026,month:9,marketplace:'wildberries'})});
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
console.log('AI endpoint: PASS (full catalogue, mixed-case COGS, media, previous month, cache, private shop/account scoping; no paid calls).');
