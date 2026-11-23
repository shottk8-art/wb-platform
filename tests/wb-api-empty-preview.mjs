import assert from 'node:assert/strict';
import {aggregateFinanceRows,mergeFinanceModels,readCabinet} from '../supabase/functions/wb-api/cabinet.ts';
import {aggregateDailyFinance} from '../supabase/functions/wb-api/daily.ts';
import {aggregateUnitFinance} from '../supabase/functions/wb-api/unit.ts';

const period={dateFrom:'2026-10-01',dateTo:'2026-10-31'},shop={id:'02969ba6-12e3-42df-b126-68ae9ebb00e1',tax_rate:7};
const rows=[{rrdId:'1',rrDate:'2026-10-03',vendorCode:'SKU',sellerOperName:'Продажа',docTypeName:'Продажа',quantity:2,retailPriceWithDisc:'1000.00',retailAmount:'1700.00',forPay:'1500.00'}];
// Opening a queued month builds this old SQL empty read model before the
// first worker page. No sale was unknown; the old metadata did not exist yet.
const legacyEmpty={version:1,cursor_id:'0',row_count:0,bought_qty:0,
 totals:{retailAmount:'0.00',forPay:'0.00'},products:[]};
const poisoned=mergeFinanceModels(legacyEmpty,aggregateFinanceRows(rows,'1'));
poisoned.daily=aggregateDailyFinance(rows,period,'1');poisoned.unit=aggregateUnitFinance(rows,'1');
// Lock the production shape in independently of the future ingest fix.
const saved=structuredClone(poisoned);saved.totals.salesAmount=null;
async function read(model){
 const job={id:'saved',status:'complete',date_from:period.dateFrom,date_to:period.dateTo,row_count:1,cursor_id:'1',finance_model:model,
 summary:{api_sources:{orders:{status:'downloaded',orders_amount:'2000.00',rows:[]},internal_ads:{status:'downloaded',period_totals:{}},media:{status:'downloaded',date_from:period.dateFrom,date_to:period.dateTo,amount:'0.00'}}}};
 return readCabinet({},shop.id,period,job.id,{shop,job,settings:[],costs:[{article:'SKU',cost_price:220}]});
}
const result=await read(saved);
assert.equal(result.finance.salesAmount,'2000.00','a complete received month must show seller-price sales despite a cold empty preview');
assert.equal(result.economy.tax,'140.00');assert.equal(result.net_profit,'920.00','profit is payout minus known COGS and tax, not a dash');
assert.equal(poisoned.totals.salesAmount,'2000.00','new worker pages must not inherit unknown metadata from a zero-row legacy preview');
assert.equal(saved.totals.salesAmount,null,'read recovery never mutates the saved source');
for(const corrupt of [
 m=>{delete m.unit},m=>{delete m.daily},m=>{m.unit.incomplete=true},m=>{m.unit.cursor_id='other'},
 m=>{m.unit.row_count++},m=>{m.daily.row_count++},m=>{m.daily.date_from='2026-09-01'},
 m=>{m.unit.buckets[0].rows++},m=>{m.daily.days['2026-10-03'].quantity++},
 m=>{m.unit.buckets[0].totals.salesAmount=null},m=>{m.daily.days['2026-10-03'].totals.salesAmount=null},
 m=>{m.unit.buckets[0].totals.forPay='1501.00'},m=>{m.sales_covered_rows=0},
 m=>{delete m.unit.buckets[0].totals.deliveryService},m=>{m.totals.forPay='1501.00'},
]){
 const invalid=structuredClone(saved);corrupt(invalid);
 assert.equal((await read(invalid)).net_profit,null,'incomplete or contradictory evidence cannot invent sales');
}
const legacyPrefix={...legacyEmpty,row_count:1,cursor_id:'1'};
assert.equal(mergeFinanceModels(legacyPrefix,aggregateFinanceRows(rows,'2')).totals.salesAmount,null,'a nonempty legacy prefix is still unknown');
assert.equal(mergeFinanceModels({...legacyEmpty,totals:{forPay:'1.00'}},aggregateFinanceRows(rows,'1')).totals.salesAmount,null,'nonzero prior amounts are not an empty preview');
const emptyJob={id:'empty',status:'loading',date_from:period.dateFrom,date_to:period.dateTo,row_count:0,cursor_id:'0',finance_model:null,summary:{pilot:{stage:'finance'}}};
const empty=await readCabinet({rpc(){throw Error('opening an empty preview must not write a legacy model')}},shop.id,period,emptyJob.id,{shop,job:emptyJob,settings:[],costs:[]});
assert.equal(empty.finance,null);
console.log('Empty preview regression PASS: complete month sales, tax and profit, cold legacy preview and validated saved recovery.');
