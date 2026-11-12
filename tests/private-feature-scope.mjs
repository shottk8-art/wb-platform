import assert from 'node:assert/strict';
import {DAILY_USER_ID,privateShopAllowed} from '../supabase/functions/wb-api/daily-access.ts';
import {processPage} from '../supabase/functions/wb-api/process.ts';
import {processCabinetSource} from '../supabase/functions/wb-api/cabinet.ts';
import {processStocks} from '../supabase/functions/wb-api/stocks.ts';
const first='00000000-0000-4000-8000-000000000001',second='00000000-0000-4000-8000-000000000002',foreign='00000000-0000-4000-8000-000000000003';
const owners=new Map([[first,DAILY_USER_ID],[second,DAILY_USER_ID],[foreign,'another-owner']]);
const token=`e30.${Buffer.from(JSON.stringify({acc:3,exp:4102444800})).toString('base64url')}.${'x'.repeat(100)}`;
const models=new Map(),summaries=new Map();let upstream=0,keyReads=0;
const admin={rpc:async(name,args)=>{
 if(name==='wb_api_read_key'){keyReads++;return {data:token};}
 if(name==='wb_api_claim_request')return {data:0};
 if(name==='seed_cost_cards')return {data:null};
 if(name==='wb_api_commit_finance_page'){models.set(args.p_shop_id,args.p_model);return {data:true};}
 throw Error('Unexpected RPC '+name);
},from(table){let id,patch;const q={select(){assert.equal(table,'shops');return q},eq(k,v){if(k==='id')id=v;return q},maybeSingle:async()=>({data:owners.has(id)?{owner_id:owners.get(id)}:null}),update(v){assert.equal(table,'wb_api_preview_jobs');patch=v;return q},then(a,b){summaries.set(id,patch);return Promise.resolve({error:null}).then(a,b)}};return q;}};
for(const shop of [first,second,foreign]){
 const job={id:shop,shop_id:shop,date_from:'2026-11-01',date_to:'2026-11-11',cursor_id:'0',row_count:0,summary:{pilot:{stage:'finance'}}};
 await processPage(admin,job,shop,async()=>[{rrdId:'1',rrDate:'2026-11-01',vendorCode:shop,sellerOperName:'Продажа',docTypeName:'Продажа',quantity:1,retailPriceWithDisc:100,forPay:80}]);
 const model=models.get(shop);
 assert.equal(!!model.daily,shop!==foreign);assert.equal(!!model.unit,shop!==foreign);
 if(model.unit)assert.equal(model.unit.buckets[0].article,shop,'article aggregates remain bound to the actual shop');
}
for(const shop of [first,second]){
 assert.equal(await privateShopAllowed(admin,shop),true);
 await processCabinetSource(admin,{id:shop,shop_id:shop,date_from:'2026-11-01',date_to:'2026-11-11',summary:{pilot:{stage:'article_ads_debits'},api_sources:{}}},async()=>{upstream++;return [];});
 assert.equal(summaries.get(shop).status,'complete');
 assert.equal(summaries.get(shop).summary.api_sources.article_ads.status,'downloaded');
}
const before=[keyReads,upstream];
await assert.rejects(()=>processCabinetSource(admin,{shop_id:foreign,summary:{pilot:{stage:'article_ads_debits'}}},async()=>{upstream++}),e=>e.status===403);
await assert.rejects(()=>processStocks(admin,{shop_id:foreign},async()=>{upstream++}),e=>e.status===403);
assert.deepEqual([keyReads,upstream],before,'another owner cannot trigger private WB calls or key reads');
console.log('Private scope PASS: two independent owner shops, compact daily/unit finance, article advertising, no private collection for other accounts.');
