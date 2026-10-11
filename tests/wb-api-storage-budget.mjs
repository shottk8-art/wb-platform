import assert from 'node:assert/strict';
import { processPage } from '../supabase/functions/wb-api/process.ts';
import { aggregateFinanceRows } from '../supabase/functions/wb-api/cabinet.ts';

const key = `e30.${Buffer.from(JSON.stringify({acc:3,exp:4102444800})).toString('base64url')}.${'x'.repeat(100)}`;
const job = {id:'test-job',shop_id:'test-shop',cursor_id:'0',row_count:0,status:'loading',summary:null};
let rawWrites = 0, commits = 0, fail = false;
const admin = {
  async rpc(name,args) {
    if(name==='wb_api_read_key') return {data:key};
    if(name==='wb_api_claim_request') return {data:0};
    if(name==='wb_api_finance_read_model') return {data:job.finance_model};
    if(name==='wb_api_commit_finance_page') {
      if(fail) return {error:{message:'simulated rollback'}};
      if(String(job.cursor_id)!==args.p_expected_cursor || job.row_count!==args.p_expected_rows) return {data:false};
      commits++;
      Object.assign(job,{cursor_id:args.p_cursor,row_count:args.p_model.row_count,summary:args.p_summary,finance_model:args.p_model,status:args.p_status});
      return {data:true};
    }
    throw Error(`Unexpected RPC ${name}`);
  },
  from(table) {
    let values;
    const q={select(){return q;},eq(){return q;},lte(){return q;},order(){return q;},range(){return q;},upsert(v){values=v;return q;},update(v){values=v;return q;},
      then(resolve,reject){
        if(table==='wb_api_preview_rows' && values) rawWrites+=values.length;
        if(table==='wb_api_preview_jobs' && values) Object.assign(job,values);
        return Promise.resolve({data:[],error:null}).then(resolve,reject);
      }};
    return q;
  }
};
const rows=Array.from({length:50000},(_,i)=>({rrdId:i+1,vendorCode:`sku-${i%10}`,title:`Товар ${i%10}`,sellerOperName:i%7===0?'Возврат':'Продажа',docTypeName:i%7===0?'Возврат':'Продажа',quantity:1,retailAmount:'100.01',forPay:'80.07',deliveryService:'0.10',deduction:i%100===0?'1.00':'0.00',bonusTypeName:'WB Медиа',additionalPayment:'0.01'}));
const fetcher=async()=>rows;
await processPage(admin,structuredClone(job),job.shop_id,fetcher);
assert.equal(rawWrites,0,'API ingestion must not persist 50,000 raw JSON operations per page');
assert.equal(commits,1,'cursor, totals and SKU aggregates must commit in one transaction');
assert.deepEqual(job.finance_model,aggregateFinanceRows(rows.map(r=>({...r,rrdId:String(r.rrdId)})),'50000'));
assert.equal(job.finance_model.products.length,10);
assert.ok(Buffer.byteLength(JSON.stringify(job.finance_model))<10000,'storage scales with products, not operations');
const before=structuredClone(job), stale=structuredClone(job);
const next=[{rrdId:50000},{rrdId:50001,vendorCode:'sku-1',quantity:1,sellerOperName:'Продажа',retailAmount:'0.01',forPay:'0.01'}];
fail=true;
await assert.rejects(()=>processPage(admin,structuredClone(job),job.shop_id,async()=>next));
assert.deepEqual(job,before,'a failed commit must persist neither cursor nor totals');
fail=false;
await processPage(admin,structuredClone(job),job.shop_id,async()=>next);
const committed=structuredClone(job);
await assert.rejects(()=>processPage(admin,stale,job.shop_id,async()=>next),/прогресс|изменил|сохранить/i);
assert.deepEqual(job,committed,'stale workers cannot duplicate or overwrite aggregates');
await processPage(admin,structuredClone(job),job.shop_id,async()=>[]);
assert.equal(job.status,'complete');
assert.equal(job.row_count,50001);
assert.equal(rawWrites,0);
assert.equal(aggregateFinanceRows([]).totals.retailAmount,'0.00','a completed empty month is explicit zero, not unknown');
console.log('WB storage budget: passed (50,000 operations -> 10 SKU aggregates, atomic rollback, stale worker, exact kopecks).');
