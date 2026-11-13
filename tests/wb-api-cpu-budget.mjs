import assert from 'node:assert/strict';
import {processPage} from '../supabase/functions/wb-api/process.ts';
import {aggregateFinanceRows} from '../supabase/functions/wb-api/cabinet.ts';
import {aggregateDailyFinance} from '../supabase/functions/wb-api/daily.ts';
import {aggregateUnitFinance} from '../supabase/functions/wb-api/unit.ts';
import {shopOwnerQuery} from './helpers/private-owner.mjs';
import {PILOT_SHOP_ID} from './fixtures/wb-api-identities.mjs';

// The live runtime terminated 50,000-operation requests at ~2.2 CPU seconds.
// Bound the actual upstream page, including the more expensive private daily
// and article aggregates; smaller pages must retain identical financial totals.
const token=`e30.${Buffer.from(JSON.stringify({acc:3,exp:4102444800})).toString('base64url')}.${'x'.repeat(100)}`;
const rows=Array.from({length:50000},(_,i)=>({rrdId:i+1,rrDate:`2026-09-${String(i%30+1).padStart(2,'0')}T12:00:00+03:00`,
  vendorCode:'sku-'+(i%100),sellerOperName:i%7===0?'Возврат':'Продажа',docTypeName:i%7===0?'Возврат':'Продажа',
  quantity:1,retailPriceWithDisc:'100.01',retailAmount:'95.00',forPay:'80.07',deliveryService:'0.10'}));
let job={id:'cpu-budget',shop_id:PILOT_SHOP_ID,date_from:'2026-09-01',date_to:'2026-09-30',status:'loading',cursor_id:'0',row_count:0,
  summary:{pilot:{stage:'finance',finance_period:'weekly'}}};
const admin={from(table){assert.equal(table,'shops');return shopOwnerQuery('bbb002c4-cd7a-490d-b9c0-72aed5424261');},
  async rpc(name,args){
    if(name==='wb_api_read_key')return {data:token};
    if(name==='wb_api_commit_finance_page'){
      assert.equal(args.p_expected_cursor,job.cursor_id);
      Object.assign(job,{cursor_id:args.p_cursor,row_count:args.p_model.row_count,summary:args.p_summary,finance_model:args.p_model,status:args.p_status});
      return {data:true};
    }
    assert.ok(['wb_api_claim_request','seed_cost_cards'].includes(name));return {data:0};
  }};
let requests=0;
while(job.summary.pilot.stage==='finance'){
  await processPage(admin,structuredClone(job),job.shop_id,async(_key,_url,body)=>{
    assert.ok(body.limit<=10000,'a page must fit the runtime CPU budget, not request 50,000 operations');
    requests++;return rows.slice(body.rrdId,body.rrdId+body.limit);
  });
  assert.ok(requests<=7,'bounded pagination must make cursor progress');
}
assert.equal(requests,6);
assert.equal(job.row_count,50000);
const expected=aggregateFinanceRows(rows.map(r=>({...r,rrdId:String(r.rrdId)})),'50000');
const {daily,unit,...finance}=job.finance_model;
assert.deepEqual(finance,expected,'partitioning never changes signed money, quantities or coverage');
assert.deepEqual(daily,aggregateDailyFinance(rows,{dateFrom:job.date_from,dateTo:job.date_to},'50000'));
assert.deepEqual(unit,aggregateUnitFinance(rows,'50000'));
console.log('CPU budget PASS: 50,000 private financial operations in five bounded pages, identical monthly/daily/SKU totals and exact cursor.');
