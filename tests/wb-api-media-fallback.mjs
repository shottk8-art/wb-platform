import assert from 'node:assert/strict';
import {processCabinetSource} from '../supabase/functions/wb-api/cabinet.ts';
import {mediaCampaignDailyAmount,readMediaHistoryResponse} from '../supabase/functions/wb-api/media.ts';
import {shopOwnerQuery} from './helpers/private-owner.mjs';
import {PILOT_SHOP_ID} from './fixtures/wb-api-identities.mjs';

// Replay WB's actual failure shape: interval/dates stay pending, while a
// campaign-only request returns complete placement/day/platform statistics.
const token=`e30.${Buffer.from(JSON.stringify({acc:3,exp:4102444800})).toString('base64url')}.${'x'.repeat(100)}`;
const full=[{stats:[{item_id:44,expenses:10000,price:999999,all_budget:999999,
  daily_stats:[
    {date:'2025-05-17T00:00:00+03:00',app_type_stats:[{app_type:1,stats:[{}]},{app_type:32,stats:[{price:1918.25}]},{app_type:64,stats:[{price:1081.75}]}]},
    {date:'2025-05-18T00:00:00+03:00',app_type_stats:[{app_type:32,stats:[{price:1969.75}]},{app_type:64,stats:[{price:1030.25}]}]},
    {date:'2025-05-19T00:00:00+03:00',app_type_stats:[{app_type:64,stats:[{price:1561.5}]},{app_type:32,stats:[{price:2438.5}]}]},
    {date:'2025-05-20T00:00:00+03:00',app_type_stats:[{app_type:32,stats:[{views:1,orders:1}]}]},
  ]}]}];
let job,failCommit=false,requests=[];
const admin={rpc:async name=>({data:name==='wb_api_read_key'?token:0}),from(table){
  if(table==='shops')return shopOwnerQuery();
  let update;const q={update(value){update=value;return q;},eq(){return q;},then(ok,bad){
    if(!failCommit)Object.assign(job,update);return Promise.resolve({error:failCommit?{}:null}).then(ok,bad);
  }};return q;
}};
const fresh=(from='2025-12-01',to='2025-12-31')=>({id:'media-fallback',shop_id:PILOT_SHOP_ID,status:'loading',date_from:from,date_to:to,
  summary:{pilot:{stage:'media_stats'},api_sources:{media:{status:'loading',selection_version:2,amount:null,campaign_ids:[11],stats_offset:0,pending_count:1,partial_amount:'0.00',
    campaign_records:[{id:11,evidence:{no_spend_in_month:false,lifetime_expenses:'10000.00'}}]}}}});
const fetcher=async(_token,url,body)=>{
  requests.push(body);
  assert.equal(url,'https://advert-media-api.wildberries.ru/adv/v1/stats');
  return body[0].interval?[{advert_id:11,interval:body[0].interval,error:'Статистика в процессе получения'}]:structuredClone(full);
};
for(const [from,to] of [['2025-12-01','2025-12-31'],['2026-01-01','2026-01-31'],['2026-02-01','2026-02-28']]){
  job=fresh(from,to);requests=[];
  await processCabinetSource(admin,structuredClone(job),fetcher);
  assert.equal(job.status,'complete','a complete campaign history must unblock the saved month');
  assert.equal(job.summary.api_sources.media.amount,'0.00','all lifetime charges are outside the month, not presumed zero');
  assert.deepEqual(requests,[{id:11,interval:{begin:from,end:to}}].map(x=>[x]).concat([[{id:11}]]));
  assert.equal(job.summary.api_sources.media.campaign_records[0].daily_evidence.covered_expenses,'10000.00');
  assert.equal(JSON.stringify(job.summary).includes('"daily_stats":'),false,'never persist upstream statistics');
}
// Failed persistence cannot move the money cursor or mark the month ready.
job=fresh();failCommit=true;await assert.rejects(()=>processCabinetSource(admin,structuredClone(job),fetcher));
assert.equal(job.status,'loading');assert.equal(job.summary.api_sources.media.stats_offset,0);
failCommit=false;await processCabinetSource(admin,structuredClone(job),fetcher);
assert.equal(job.summary.api_sources.media.amount,'0.00');
const read=(value,from='2025-12-01',to='2025-12-31',lifetime='10000.00')=>mediaCampaignDailyAmount(value,11,from,to,lifetime);
assert.equal(read(full,'2025-05-18','2025-05-19').amount,'7000.00','use only dated expense components, never placement price or budget');
assert.equal(read(full,'2025-05-17','2025-05-17').amount,'3000.00');
assert.equal(read(full).last_spend,'2025-05-19');
for(const bad of [null,[],[{}],[{stats:[]}],[{...full[0],advert_id:22}],
  [{stats:[...full[0].stats,...full[0].stats]}],
  [{stats:[{...full[0].stats[0],expenses:9999}]}],
  [{stats:[{...full[0].stats[0],daily_stats:[]}]}],
  [{stats:[{...full[0].stats[0],daily_stats:[...full[0].stats[0].daily_stats,full[0].stats[0].daily_stats[0]]}]}],
])assert.equal(read(bad),null,'incomplete, duplicate or mismatched histories cannot prove zero');
assert.equal(read(full,undefined,undefined,null),null,'unknown lifetime total prevents fallback');
assert.equal(read(full,undefined,undefined,'20000'),null,'all placements must match actual campaign expenses');
const precise=[{stats:[{item_id:5,expenses:'12.34',daily_stats:[{date:'2025-11-30T21:00:00Z',app_type_stats:[{app_type:1,stats:[{expenses:'12.34'}]}]}]}]}];
assert.equal(read(precise,'2025-12-01','2025-12-31','12.34').amount,'12.34','date attribution follows Moscow, with exact kopecks');
const conflict=structuredClone(precise);conflict[0].stats[0].daily_stats[0].app_type_stats[0].stats[0].price=99;
assert.equal(read(conflict,'2025-12-01','2025-12-31','12.34'),null,'conflicting monetary aliases are unknown');
assert.deepEqual(await readMediaHistoryResponse(new Response(JSON.stringify(full))),full);
await assert.rejects(()=>readMediaHistoryResponse(new Response(' '.repeat(1048577))),e=>e.status===502,'large full histories must fail into the explicit estimate, not crash the worker');
console.log('WB Media fallback PASS: real pending/full-history shapes, all three months, complete expense proof, atomic cursor and compact storage.');
