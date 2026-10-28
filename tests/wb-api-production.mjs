import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readCabinet, readCabinetTrend, cabinetPeriod } from '../supabase/functions/wb-api/cabinet.ts';
import { processPage } from '../supabase/functions/wb-api/process.ts';
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
const now=new Date(Date.now()+3*3600000);
const month=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1)).toISOString().slice(0,7);
const period=cabinetPeriod(month),reads=[];
const data={shops:[{id:a,name:'A',tax_rate:0},{id:b,name:'B',tax_rate:0}],sku_costs:[{shop_id:a,article:'SKU',cost_price:10},{shop_id:b,article:'SKU',cost_price:5}],wb_api_month_settings:[],wb_api_preview_jobs:[a,b].map((shop_id,i)=>({
  id:shop_id,shop_id,status:'complete',date_from:period.dateFrom,date_to:period.dateTo,row_count:1,cursor_id:'1',
  finance_model:{version:1,row_count:1,cursor_id:'1',bought_qty:2,totals:{retailAmount:'200.00',forPay:'160.00'},products:[{article:'SKU',bought_qty:2,revenue:'200.00',for_pay:'160.00'}]},
  summary:{pilot:{stage:'done'},api_sources:{orders:{status:'downloaded',orders_amount:'300.00',rows:[]},internal_ads:{status:'downloaded',period_totals:{}},media:{status:'downloaded',date_from:period.dateFrom,date_to:period.dateTo,amount:i?'0.00':'10.00'}}}
}))};
const admin={rpc(){throw new Error('Warm private reads must not touch Vault or raw finance');},from(table){
  assert.ok(data[table],`unexpected table ${table}`);const filters={};let limit;
  const result=()=>{reads.push({table,filters:{...filters}});return {data:data[table].filter(row=>Object.entries(filters).every(([key,value])=>row[key]===value)).slice(0,limit),error:null}};
  const q={select(){return q},eq(key,value){filters[key]=value;return q},gte(){return q},range(){return q},order(){return q},limit(value){limit=value;return q},single:async()=>{const r=result();return {...r,data:r.data[0]||null}},then:(ok,bad)=>Promise.resolve(result()).then(ok,bad)};return q;
}};
assert.equal((await readCabinet(admin,a,period)).net_profit,'130.00');
assert.equal((await readCabinet(admin,b,period)).net_profit,'150.00');
assert.equal((await readCabinetTrend(admin,a))[0].profit,130);
assert.equal((await readCabinetTrend(admin,b))[0].profit,150);
assert.ok(reads.every(r=>r.table==='shops'?r.filters.id===a||r.filters.id===b:r.filters.shop_id===a||r.filters.shop_id===b),'all private reads are scoped to the requested shop');
await assert.rejects(()=>processPage(admin,{shop_id:a},b,()=>{throw new Error('must not call WB')}),e=>e.status===403);
const migration=readFileSync(new URL('../supabase/migrations/20261011120000_wb_api_production.sql',import.meta.url),'utf8');
assert.match(migration,/0\.\.11/);assert.match(migration,/history_queued_at<now\(\)-interval '1 hour'/);
assert.match(migration,/order by c.next_request_at,c.shop_id limit 4/);
assert.match(migration,/lease_used_at is null/);assert.match(migration,/from public,anon,authenticated/);
for(const file of ['index.ts','core.ts','cabinet.ts','access.ts']) assert.doesNotMatch(readFileSync(new URL('../supabase/functions/wb-api/'+file,import.meta.url),'utf8'),/PILOT_USER_ID|PILOT_SHOP_ID|bbb002c4|63175e7a/);
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
assert.doesNotMatch(html,/только для @karlshott|Загрузкой месяцев GREEN FLOW/);
assert.match(html,/overviewScope !== 'ozon'/);
assert.match(html,/loadPeriodData\(shop.id,year,month,'ozon'\)/);
assert.match(html,/sourcePreference/);
assert.match(html,/wb-api\.js\?v=\d{8}-[a-z0-9]+/,'the public API client must retain an explicit cache version');
assert.match(html,/dashboard\.js\?v=20261027-sales1/,'the sales correction must bypass the previous dashboard script cache');
console.log('WB production: separate shop calculations/keys, no pilot allowlist, Ozon files, scoped/fair queues PASS.');
