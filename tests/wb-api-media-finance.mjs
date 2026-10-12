import assert from 'node:assert/strict';
import { readCabinet, readCabinetTrend, aggregateFinanceRows, mergeFinanceModels, processCabinetSource } from '../supabase/functions/wb-api/cabinet.ts';
import { mediaFinancialSource, isMediaDeduction } from '../supabase/functions/wb-api/media.ts';

// Reproduce Toplash's real boundary: financial WB Media charges were added
// back, but the separate campaign API supplied a downloaded zero.
const from='2026-09-01',to='2026-09-30';
const shopIds=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
for(const shopId of shopIds) {
  const rows=[
    {vendorCode:'SKU',sellerOperName:'Продажа',docTypeName:'Продажа',quantity:1,retailAmount:1200,forPay:1000},
    {deduction:70,bonusTypeName:'Оказание услуг «WB Медиа», документ №1'},
    {deduction:20,bonusTypeName:'Оказание услуг «WB Продвижение», документ №2'},
  ];
  const job={id:'saved-month',shop_id:shopId,status:'complete',date_from:from,date_to:to,cursor_id:'0',row_count:3,
    finance_model:aggregateFinanceRows(rows),summary:{pilot:{stage:'done',finance_complete:true},
      deductions:rows.filter(p=>p.deduction).map(p=>({label:p.bonusTypeName,amount:String(p.deduction),count:1})),
      api_sources:{orders:{status:'downloaded',orders_amount:'2000',rows:[]},internal_ads:{status:'downloaded',period_totals:{Баланс:{amount:'20.00'}}},
        media:{status:'downloaded',amount:'0.00',date_from:from,date_to:to}}}};
  const admin={from(table){const q={select(){return q;},eq(){return q;},order(){return q;},limit(){return q;},range(){return q;},single:async()=>({data:{id:shopId,tax_rate:0}}),then(resolve,reject){return Promise.resolve({error:null,data:table==='wb_api_preview_jobs'?[job]:table==='sku_costs'?[{article:'SKU',cost_price:100}]:[]}).then(resolve,reject);}};return q;}};
  const result=await readCabinet(admin,shopId,{dateFrom:from,dateTo:to});
  assert.equal(result.sources.media.amount,'70.00','confirmed financial Media charges must not disappear behind campaign zero');
  assert.equal(result.sources.media.source,'wb_financial_deductions');
  assert.equal(result.net_profit,'810.00','media already withheld must be counted exactly once');
  assert.equal(result.economy.advertising_total,'90.00');
  assert.equal(result.economy.drr_orders,4.5);
  // Reconstruct the real lean trend projection: no descriptions/full summary.
  const projected={...job,pilot:job.summary.pilot,api_sources:job.summary.api_sources};
  delete projected.summary;
  const trendAdmin={from(table){const q={select(){return q;},eq(){return q;},gte(){return q;},order(){return q;},range(){return q;},single:async()=>({data:{id:shopId,tax_rate:0}}),then(resolve,reject){return Promise.resolve({error:null,data:table==='wb_api_preview_jobs'?[projected]:table==='sku_costs'?[{article:'SKU',cost_price:100}]:[]}).then(resolve,reject);}};return q;}};
  const trend=await readCabinetTrend(trendAdmin,shopId);
  assert.equal(trend[0].mediaAds,70,'the history must match the corrected KPI');
  assert.equal(trend[0].profit,810);
  // No WB requests, decrypted key or financial restart for a media-only repair.
  const pending=structuredClone(job);pending.status='loading';pending.summary.pilot.stage='media_stats';
  const workerAdmin={rpc(){throw new Error('No key/quota read is needed');},from(table){assert.equal(table,'wb_api_preview_jobs');const q={update(value){Object.assign(pending,value);return q;},eq(){return q;},then(resolve,reject){return Promise.resolve({error:null}).then(resolve,reject);}};return q;}};
  await processCabinetSource(workerAdmin,pending,()=>{throw new Error('Financial evidence must avoid more WB requests');});
  assert.equal(pending.status,'complete');
  assert.equal(pending.summary.api_sources.media.amount,'70.00');
  assert.equal(pending.finance_model.row_count,3);
}
for(const label of ['Оказание услуг «WB Медиа», документ №1','wb media','ВБ.МЕДИА','WB\u00a0Медиа']) assert.equal(isMediaDeduction(label),true);
for(const label of ['WB Продвижение','Медиа','WB медиатор','WB mediafoo','Джем']) assert.equal(isMediaDeduction(label),false);
assert.equal(mediaFinancialSource([{label:'WB Медиа',amount:10}],false,from,to),null,'partial finance cannot confirm a bill');
assert.equal(mediaFinancialSource([],true,from,to),null,'missing media rows must not cancel nonzero campaign API spend');
assert.equal(mediaFinancialSource([{label:'WB Медиа',amount:10},{label:'Возврат WB Медиа',amount:-2}],true,from,to).amount,'8.00');
assert.throws(()=>mediaFinancialSource([{label:'WB Медиа'}],true,from,to));
const positive=aggregateFinanceRows([{deduction:10,bonusTypeName:'WB Медиа'}],'1');
const refund=aggregateFinanceRows([{deduction:-10,bonusTypeName:'Возврат WB Медиа'}],'2');
const merged=mergeFinanceModels(positive,refund);
assert.equal(merged.totals.wbMediaDeductions,'0.00');
assert.equal(merged.media_deduction_count,2);
assert.equal(mediaFinancialSource(undefined,true,from,to,null,merged).amount,'0.00','explicit offsetting financial charges prove billed zero');
assert.equal(mediaFinancialSource([{label:'WB Медиа',amount:-5}],true,from,to).amount,'-5.00','media refunds retain their sign');
console.log('Financial WB Media: all-shop recovery, profit/DRR and no double deduction passed.');
