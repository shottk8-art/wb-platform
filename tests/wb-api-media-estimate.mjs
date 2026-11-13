import assert from 'node:assert/strict';
import {ApiError} from '../supabase/functions/wb-api/core.ts';
import {processCabinetSource,readCabinet,aggregateFinanceRows} from '../supabase/functions/wb-api/cabinet.ts';
import {mediaSource} from '../supabase/functions/wb-api/media.ts';
import {shopOwnerQuery} from './helpers/private-owner.mjs';
import {PILOT_SHOP_ID} from './fixtures/wb-api-identities.mjs';
const token=`e30.${Buffer.from(JSON.stringify({acc:3,exp:4102444800})).toString('base64url')}.${'x'.repeat(100)}`;
let job,fail=false;
const admin={rpc:async name=>({data:name==='wb_api_read_key'?token:0}),from(table){if(table==='shops')return shopOwnerQuery();let values;
 const q={update(v){values=v;return q},eq(){return q},then(ok,bad){if(!fail)Object.assign(job,values);return Promise.resolve({error:fail?{}:null}).then(ok,bad)}};return q;}};
const fresh=()=>({id:'estimate',shop_id:PILOT_SHOP_ID,status:'loading',date_from:'2026-09-01',date_to:'2026-09-30',row_count:1,cursor_id:'1',
 finance_model:aggregateFinanceRows([{rrdId:1,vendorCode:'SKU',sellerOperName:'Продажа',docTypeName:'Продажа',quantity:1,retailPriceWithDisc:100,forPay:80}],'1'),
 summary:{pilot:{stage:'media_list',finance_complete:true},api_sources:{orders:{status:'downloaded',orders_amount:200,rows:[]},internal_ads:{status:'downloaded',period_totals:{Баланс:{amount:2}}},media:{status:'loading',amount:null}}}});
const read=(cost=10)=>readCabinet(admin,job.shop_id,{dateFrom:job.date_from,dateTo:job.date_to},job.id,
 {shop:{id:job.shop_id,tax_rate:5},settings:[],costs:[{article:'SKU',cost_price:cost}],job});
for(const status of [400,403,429,502]){
 job=fresh();await processCabinetSource(admin,structuredClone(job),async()=>{throw new ApiError(status,'WB Медиа недоступно')});
 assert.equal(job.status,'complete');assert.equal(job.summary.api_sources.media.status,'estimated');
 let result=await read();assert.equal(result.complete,true);assert.equal(result.net_profit,'63.00');
 assert.equal(result.sources.media.estimated,true);assert.match(result.warnings[0],/временно.*0 ₽/);
 assert.equal((await read(0)).net_profit,null,'Media policy does not invent missing cost prices');
 job.status='loading';job.summary.api_sources.media.status='loading';job.summary.api_sources.media.amount=null;
 assert.equal((await read()).net_profit,'63.00','a background retry retains the marked estimate');
}
job=fresh();await assert.rejects(()=>processCabinetSource(admin,structuredClone(job),async()=>{throw new ApiError(500,'Database error')}));
assert.equal(job.status,'loading','internal/database failures are never presented as successful sources');
job=fresh();job.summary.pilot.stage='orders';await assert.rejects(()=>processCabinetSource(admin,structuredClone(job),async()=>{throw new ApiError(502,'Orders error')}));
job=fresh();fail=true;await assert.rejects(()=>processCabinetSource(admin,structuredClone(job),async()=>{throw new ApiError(502,'Media unavailable')}));fail=false;
assert.equal(job.status,'loading','failed estimate persistence does not advance the month');
assert.equal(mediaSource({estimated:true,date_from:'wrong',date_to:'2026-09-30'},'2026-09-01','2026-09-30').amount,null,'an estimate is period-scoped');
job=fresh();job.summary.pilot.stage='media_stats';job.summary.api_sources.media={status:'estimated',estimated:true,note:'old',amount:'0.00',selection_version:2,campaign_ids:[11],stats_offset:0,partial_amount:'0.00',campaign_records:[{id:11,evidence:{no_spend_in_month:false,lifetime_expenses:10}}]};
await processCabinetSource(admin,structuredClone(job),async()=>[{interval:{begin:job.date_from,end:job.date_to},stats:[{expenses:'3.50'}]}]);
assert.equal(job.summary.api_sources.media.estimated,undefined,'verified data replaces the estimate');
assert.equal((await read()).net_profit,'59.50');assert.deepEqual((await read()).warnings,[]);
console.log('Media estimate PASS: explicit zero on upstream failure, honest quality, exact scope, missing costs/DB/other sources protected, later actual replacement.');
