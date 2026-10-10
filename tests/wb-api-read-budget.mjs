import assert from 'node:assert/strict';
import {readCabinetTrend,cabinetPeriod,readCabinetStatus} from '../supabase/functions/wb-api/cabinet.ts';
import {PILOT_SHOP_ID} from '../supabase/functions/wb-api/core.ts';
const now=new Date(Date.now()+3*3600000);
const jobs=Array.from({length:12},(_,i)=>{
  const period=cabinetPeriod(new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-i,1)).toISOString().slice(0,7));
  return {id:`synthetic-${i}`,date_from:period.dateFrom,date_to:period.dateTo,status:'complete',cursor_id:'10000',row_count:10000,
    finance_model:{version:1,cursor_id:'10000',row_count:10000,bought_qty:10000,totals:{retailAmount:'10000.00',forPay:'10000.00'},products:[{article:'SKU',name:'Test',bought_qty:10000,revenue:'10000.00',for_pay:'10000.00'}]},
    summary:{pilot:{stage:'done'},api_sources:{orders:{status:'downloaded',orders_amount:'20000.00',rows:[]},internal_ads:{status:'downloaded',period_totals:{}},media:{status:'downloaded',date_from:period.dateFrom,date_to:period.dateTo,amount:'0.00'}}}};
});
let queries=0,tax=0,price='0.50';
const admin={rpc(){throw new Error('Warm chart must not rebuild finance aggregates');},from(table){
  assert.notEqual(table,'wb_api_preview_rows','chart must not reread financial operations');
  let columns='';const q={select(c){columns=c;return q;},eq(){return q;},order(){return q;},single:async()=>run(),then:(ok,bad)=>Promise.resolve(run()).then(ok,bad)};
  function run(){queries++;return {error:null,data:table==='shops'?{id:PILOT_SHOP_ID,tax_rate:tax}:table==='sku_costs'?[{article:'SKU',cost_price:price}]:table==='wb_api_month_settings'?[]:columns.includes('stage:')?jobs.map(j=>({...j,stage:'done'})):jobs};}
  return q;
}};
const history=await readCabinetTrend(admin,PILOT_SHOP_ID);
assert.equal(history.length,12);assert.equal(queries,4,'all 12 chart points share catalogue/settings reads');
assert.equal(history[0].profit,5000);
price='0.70';tax=5;
assert.equal((await readCabinetTrend(admin,PILOT_SHOP_ID))[0].profit,2500,'cached finance must not freeze current cost prices or tax');
const status=await readCabinetStatus(admin,PILOT_SHOP_ID);
assert.equal(status.history_loading,false);assert.equal(JSON.parse(status.revision).length,12);
await assert.rejects(()=>readCabinetStatus(admin,'another-shop'));
console.log('Read budget: passed (4 queries for 12 months, zero raw rows, live tax/costs, cheap isolated status).');
