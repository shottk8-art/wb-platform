import assert from 'node:assert/strict';
import { adsSnapshot, cabinetPeriod, orderPage, processCabinetSource, readCabinet, monthSettings, readCabinetTrend } from '../supabase/functions/wb-api/cabinet.ts';
import { PILOT_SHOP_ID, PILOT_USER_ID } from '../supabase/functions/wb-api/core.ts';
const from = '2026-09-01', to = '2026-09-30';
assert.deepEqual(cabinetPeriod('2026-09'), {dateFrom:from,dateTo:to});
for (const value of ['2026-13','2026-00','bad','2026-10','2024-01']) assert.throws(()=>cabinetPeriod(value));
const product = (id, sum = 100) => ({product:{nmId:id,vendorCode:'SKU',title:'Товар'},statistic:{selected:{period:{start:from,end:to},orderCount:2,orderSum:sum,wbClub:{orderCount:1,orderSum:50}}}});
const response = {data:{currency:'RUB',products:[product(1)]}};
assert.equal(orderPage(response,from,to)[0].orders_amount,'100.00','club is a subset, never added twice');
assert.throws(()=>orderPage({data:{currency:'USD',products:[]}},from,to));
assert.throws(()=>orderPage({data:{currency:'RUB',products:[product(1),product(1)]}},from,to));
assert.throws(()=>orderPage(response,'2026-08-01',to));
const ads = adsSnapshot([
  {updTime:'2026-09-30T23:59:59+03:00',updSum:'10.10',paymentType:'Баланс'},
  {updTime:'2026-10-01T00:00:01+03:00',updSum:1000,paymentType:'Баланс'},
  {updTime:'2026-09-01T01:00:00+03:00',updSum:3,paymentType:'Кэшбэк'},
  {updTime:null,updSum:20,paymentType:'Счет'},
  {updTime:'2026-09-02T00:00:00+03:00',updSum:'0.10',paymentType:'Баланс'},
  {updTime:'2026-09-02T00:00:00+03:00',updSum:'0.10',paymentType:'Баланс'},
],from,to);
assert.equal(ads.period_totals['Баланс'].amount,'10.30','legitimate identical operations are retained');
assert.deepEqual(ads.classification_pending,['Кэшбэк']);
assert.equal(ads.undated_operations,1);
assert.equal(ads.period_totals['Промобонусы'],undefined);
assert.throws(()=>adsSnapshot([{updTime:from,updSum:'x',paymentType:'Баланс'}],from,to));
const token = `e30.${Buffer.from(JSON.stringify({acc:3,exp:4102444800})).toString('base64url')}.${'x'.repeat(100)}`;
const job = {id:'test-job',shop_id:PILOT_SHOP_ID,status:'loading',date_from:from,date_to:to,summary:{pilot:{stage:'orders'},api_sources:{}}};
let wait=0,calls=0,fail=false;
const admin = {rpc:async name=>({data:name==='wb_api_read_key'?token:wait}),from(table){
  let values;
  const q={update(v){values=v;return q;},eq(){return q;},then(resolve,reject){ if(fail)return Promise.resolve({error:{}}).then(resolve,reject);Object.assign(job,values);return Promise.resolve({error:null}).then(resolve,reject); }};
  assert.equal(table,'wb_api_preview_jobs');return q;
}};
const fetcher=async (_key,url)=>{calls++;return url.includes('sales-funnel')?response:[{updTime:'2026-09-10T12:00:00+03:00',updSum:10,paymentType:'Баланс'}];};
wait=300;await processCabinetSource(admin,structuredClone(job),fetcher);assert.equal(calls,0);
wait=0;fail=true;await assert.rejects(()=>processCabinetSource(admin,structuredClone(job),fetcher));assert.equal(job.summary.pilot.stage,'orders');
fail=false;await processCabinetSource(admin,structuredClone(job),fetcher);assert.equal(job.summary.pilot.stage,'ads');
assert.equal(job.summary.api_sources.orders.orders_count,2);
await processCabinetSource(admin,structuredClone(job),fetcher);assert.equal(job.status,'complete');
assert.equal(job.summary.api_sources.media.status,'needs_confirmation','absence is not zero');
await assert.rejects(()=>processCabinetSource(admin,{...job,shop_id:'other'},fetcher));
// Exercise the read model: corrections carry money but never another bought unit.
const data={shops:{id:PILOT_SHOP_ID,name:'GREEN FLOW',tax_rate:0},wb_api_preview_jobs:[{...job,summary:{...job.summary,totals:{retailAmount:'100.00'}}}],
wb_api_preview_rows:[{payload:{vendorCode:'SKU',title:'Товар',sellerOperName:'Продажа',docTypeName:'Продажа',quantity:1,forPay:80}},
{payload:{vendorCode:'SKU',sellerOperName:'Коррекция продаж',docTypeName:'Продажа',quantity:1,forPay:5}},
{payload:{vendorCode:'SKU',sellerOperName:'Возврат',docTypeName:'Возврат',quantity:1,forPay:80}}],sku_costs:[{article:'SKU',cost_price:7}]};
const reader={from(table){const q={select(){return q;},eq(){return q;},order(){return q;},limit(){return q;},range(){return q;},single:async()=>({data:data[table]}),then(resolve,reject){return Promise.resolve({data:data[table],error:null}).then(resolve,reject);}};return q;}};
const result=await readCabinet(reader,PILOT_SHOP_ID,{dateFrom:from,dateTo:to});
assert.equal(result.products[0].bought_qty,0);
assert.equal(result.products[0].for_pay,'5.00');
assert.equal(result.net_profit,null);
assert.equal(result.cogs,'0.00');
assert.equal(result.sources.ads.totals['Баланс'].amount,'10.00');
assert.ok(!JSON.stringify(result).includes(token));
await assert.rejects(()=>readCabinet(reader,'another-shop',{dateFrom:from,dateTo:to}));
assert.deepEqual(monthSettings({operational_expenses:'10.10',external_promotion_expenses:0,media_spend:''}),{operational_expenses:'10.10',external_promotion_expenses:'0.00',media_spend:null});
for (const v of [-1,'bad','1.001',true,1000000001]) assert.throws(()=>monthSettings({operational_expenses:v,external_promotion_expenses:0}));
data.wb_api_month_settings=[{operational_expenses:'25.10',external_promotion_expenses:'10.00',media_spend:'0.00'}];
data.wb_api_preview_rows.pop();
const saved = await readCabinet(reader,PILOT_SHOP_ID,{dateFrom:from,dateTo:to});
assert.equal(saved.cogs,'7.00','correction is not another unit of cost');
assert.equal(saved.sources.media.amount,'0.00');
assert.equal(saved.sources.media.status,'confirmed_by_user');
assert.equal(saved.settings.operational_expenses,'25.10');
data.wb_api_month_settings[0].media_spend=null;
assert.equal((await readCabinet(reader,PILOT_SHOP_ID,{dateFrom:from,dateTo:to})).sources.media.status,'needs_confirmation','clearing a confirmation must not restore an old job zero');
const oldSummary=structuredClone(data.wb_api_preview_jobs[0].summary);
data.wb_api_preview_jobs.push({...data.wb_api_preview_jobs[0],summary:{...oldSummary,totals:{retailAmount:'999.00'}}});
const history=await readCabinetTrend(reader,PILOT_SHOP_ID);
assert.equal(history.length,1,'monthly refreshes must not duplicate a chart point');
assert.equal(history[0].sales,100);
assert.equal(history[0].orders,100);
assert.equal(history[0].internalAds,10);
await assert.rejects(()=>readCabinetTrend(reader,'another-shop'));
console.log('API cabinet: passed (periods, Moscow dates, exact money, pagination, retries, isolation, unknown media, correction quantity).');
