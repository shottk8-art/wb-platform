import assert from 'node:assert/strict';
import {processPage} from '../supabase/functions/wb-api/process.ts';
const shop='shop-a';
const job={id:'fixture',shop_id:shop,status:'loading',cursor_id:'0',row_count:0,summary:{pilot:{stage:'finance'}}};
const catalogue=[{shop_id:shop,article:'Top-114',cost_price:1160},{shop_id:'shop-b',article:'NEW-1',cost_price:900}];
const calls=[];
const token=`e30.${Buffer.from(JSON.stringify({acc:3,exp:4102444800})).toString('base64url')}.${'x'.repeat(100)}`;
const admin={
 async rpc(name,args){
  if(name==='wb_api_claim_request')return {data:0};
  if(name==='wb_api_read_key')return {data:token};
  if(name==='seed_cost_cards') {
   calls.push(args);
   for(const row of args.p_cards)if(!catalogue.some(c=>c.shop_id===args.p_shop_id && c.article.trim().toLowerCase()===row.article.trim().toLowerCase()))catalogue.push({...row,shop_id:args.p_shop_id,cost_price:0});
   return {data:1};
  }
  if(name==='wb_api_commit_finance_page') {Object.assign(job,{cursor_id:args.p_cursor,row_count:args.p_model.row_count,finance_model:args.p_model,summary:args.p_summary});return {data:true};}
  throw Error(`Unexpected RPC ${name}`);
 },
 from(table){return {upsert:async rows=>{assert.equal(table,'sku_costs');for(const row of rows)if(!catalogue.some(c=>c.shop_id===row.shop_id && c.article===row.article))catalogue.push(row);return {error:null};}};}
};
const rows=['top-114',' TOP-114 ','new-1','NEW-1'].map((article,i)=>({rrdId:i+1,vendorCode:article,title:'Товар',sellerOperName:'Продажа',quantity:1,retailAmount:100,forPay:80}));
await processPage(admin,structuredClone(job),shop,async()=>rows);
assert.equal(catalogue.filter(c=>c.shop_id===shop).length,2,'new shops must not acquire zero aliases on API import');
assert.equal(catalogue[0].cost_price,1160,'entered price is never overwritten by a placeholder');
assert.equal(calls.length,1,'one server-side scoped batch per page');
assert.equal(calls[0].p_shop_id,shop);
assert.equal(job.finance_model.row_count,4,'only the catalogue is deduplicated, never financial operations');
assert.equal(job.finance_model.bought_qty,4);
const before=JSON.stringify(catalogue);
await assert.rejects(()=>processPage(admin,structuredClone(job),'shop-b',async()=>rows));
assert.equal(JSON.stringify(catalogue),before,'a mismatched shop cannot seed or change any cost');
console.log('API cost-card prevention: PASS (case aliases, prices preserved, batch budget, financial totals, shop isolation).');
