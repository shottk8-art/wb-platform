import assert from 'node:assert/strict';
import {readPromocodes,PROMO_SHOP} from '../supabase/functions/wb-api/promocodes.ts';

const current='10000000-0000-5000-8000-000000000001';
const legacy='20000000-0000-4000-8000-000000000002';
const unrelated='30000000-0000-4000-8000-000000000003';
const period={dateFrom:'2026-09-01',dateTo:'2026-09-30'};
const bucket=(promo_id,sold_qty)=>({promo_id,day:'2026-09-10',sold_qty,returned_qty:0,sold_amount:(sold_qty*100).toFixed(2),returned_amount:'0.00'});
const data={
  wb_api_preview_jobs:[],
  wb_promo_names:[{shop_id:PROMO_SHOP,promo_id:current,name:'Saved campaign',code:'SAMPLE20'}],
  wb_promo_id_aliases:[{shop_id:PROMO_SHOP,promo_id:current,alias_id:legacy}],
  wb_promo_jobs:[{shop_id:PROMO_SHOP,date_from:period.dateFrom,date_to:period.dateTo,status:'complete',row_count:3,cursor_id:'3',updated_at:'2026-11-18',model:{version:1,row_count:3,covered_rows:3,unallocated_rows:0,cursor_id:'3',buckets:[bucket(current,2),{...bucket(legacy,3),returned_qty:1,returned_amount:'100.00'},bucket(unrelated,7)]}}],
};
const admin={from(table){
  const filters=[];const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},gte(k,v){filters.push(r=>r[k]>=v);return q;},lte(k,v){filters.push(r=>r[k]<=v);return q;},order(){return q;},then(resolve,reject){return Promise.resolve({data:(data[table]||[]).filter(r=>filters.every(f=>f(r))),error:null}).then(resolve,reject);}};return q;
}};
let result=await readPromocodes(admin,period);
assert.equal(result.status,'ready');
assert.equal(result.rows.length,1,'both verified IDs remain one campaign');
assert.equal(result.rows[0].sold_qty,5,'historical ID and current ID must both count');
assert.equal(result.rows[0].sold_amount,'500.00');
assert.equal(result.rows[0].returned_qty,1);assert.equal(result.rows[0].net_amount,'400.00','historical returns use the same mapping');
assert.equal(result.rows[0].promo_id,current);
assert.ok(!JSON.stringify(result).includes(legacy),'only canonical IDs are exposed');
assert.ok(!JSON.stringify(result).includes(unrelated),'unverified IDs remain excluded');

const snapshot=data.wb_promo_jobs[0].model.buckets;
data.wb_promo_jobs[0].model.buckets=[snapshot[1]];
result=await readPromocodes(admin,period);
assert.equal(result.rows[0].sold_qty,3,'a period containing only the older ID cannot become a zero');
data.wb_promo_jobs[0].model.buckets=snapshot;

data.wb_promo_id_aliases[0].shop_id='another-shop';
result=await readPromocodes(admin,period);
assert.equal(result.rows[0].sold_qty,2,'another shop cannot supply a historical mapping');
data.wb_promo_id_aliases[0].shop_id=PROMO_SHOP;
data.wb_promo_id_aliases[0].promo_id=unrelated;
result=await readPromocodes(admin,period);
assert.equal(result.rows[0].sold_qty,2,'orphan mappings never broaden the saved catalogue');
data.wb_promo_id_aliases[0].promo_id=current;
data.wb_promo_names.push({shop_id:PROMO_SHOP,promo_id:unrelated,name:'Saved campaign',code:'OTHER20'});
data.wb_promo_id_aliases.push({shop_id:PROMO_SHOP,alias_id:legacy,promo_id:unrelated});
await assert.rejects(()=>readPromocodes(admin,period),e=>e.status===500,'ambiguous mappings stop instead of misattributing sales');
console.log('Promo history PASS: verified old/current IDs merge once, with catalogue and shop isolation preserved.');
