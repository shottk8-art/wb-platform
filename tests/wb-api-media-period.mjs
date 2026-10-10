import assert from 'node:assert/strict';
import { processCabinetSource } from '../supabase/functions/wb-api/cabinet.ts';
import { PILOT_SHOP_ID } from '../supabase/functions/wb-api/core.ts';
import { mediaCampaignEvidence, mediaCampaignSelection } from '../supabase/functions/wb-api/media.ts';
const from='2026-09-01',to='2026-09-30';
assert.equal(mediaCampaignEvidence({advertId:11,status:8,extended:{expenses:0}},11,from,to).no_spend_in_month,true);
for(const response of [null,{advertId:11,status:8},{advertId:11,status:8,items:[]},{advertId:11,status:8,extended:{price:0,budget:0,expenses:'1.00'}}])assert.equal(mediaCampaignEvidence(response,11,from,to).no_spend_in_month,false,'declined/missing/budget zero is not expense evidence');
assert.throws(()=>mediaCampaignEvidence({advertId:22,extended:{expenses:0}},11,from,to));
assert.throws(()=>mediaCampaignEvidence({advertId:11,extended:{expenses:-1}},11,from,to));
assert.equal(mediaCampaignEvidence({advertId:11,extended:{expenses:100},items:[{id:44,status:7,date_from:'2026-01-01T00:00:00+03:00',date_to:'2026-01-31T23:59:59+03:00'}]},11,from,to).no_spend_in_month,true);
for(const row of [{advertId:1,status:7,endTime:'bad'}, {advertId:1,status:7,endTime:'2026-02-30T00:00:00+03:00'}, {advertId:1,status:9,endTime:'2026-08-01T00:00:00+03:00'}, {advertId:1,status:8}])assert.equal(mediaCampaignSelection([row],from,to)[0].excluded_reason,null);
assert.equal(mediaCampaignSelection([{advertId:1,createTime:'2026-09-30T21:00:00Z'}],from,to)[0].excluded_reason,'created_after_month','Moscow month boundary');
const token=`e30.${Buffer.from(JSON.stringify({acc:3,exp:4102444800})).toString('base64url')}.${'x'.repeat(100)}`;
let job={id:'period-filter',shop_id:PILOT_SHOP_ID,status:'loading',date_from:from,date_to:to,summary:{pilot:{stage:'media_list'},api_sources:{}}};
const admin={rpc:async name=>({data:name==='wb_api_read_key'?token:0}),from(){let values;const q={update(v){values=v;return q;},eq(){return q;},then(resolve,reject){Object.assign(job,values);return Promise.resolve({error:null}).then(resolve,reject);}};return q;}};
await processCabinetSource(admin,structuredClone(job),async()=>[
  {advertId:11,status:7,createTime:'2026-08-01T00:00:00+03:00',endTime:'2026-08-31T23:59:59+03:00'},
  {advertId:22,status:6,createTime:'2026-10-01T00:00:00+03:00'},
]);
assert.equal(job.status,'complete','only campaigns provably outside the month must not block statistics for the month');
assert.equal(job.summary.api_sources.media.amount,'0.00');
assert.equal(job.summary.pilot.stage,'done');
console.log('WB Media period selection: past-completed/future-created campaigns cannot stall an empty month.');

job={...job,status:'loading',summary:{pilot:{stage:'media_stats'},api_sources:{media:{status:'loading',campaign_ids:[11,22],list_offset:2,stats_offset:0,partial_amount:'0.00'}}}};
let requested;
await processCabinetSource(admin,structuredClone(job),async(_key,url)=>{requested=url;return [{advertId:11,status:7,endTime:'2026-08-31T23:59:59+03:00'},{advertId:22,createTime:'2026-10-01T00:00:00+03:00'}];});
assert.ok(requested.includes('/adverts?'),'legacy stalled job refreshes media lifetimes, not finance or stats');
assert.equal(job.status,'complete');assert.equal(job.summary.api_sources.media.selection_version,2);
assert.equal(job.summary.api_sources.media.campaign_records.length,2);

job={...job,status:'loading',summary:{pilot:{stage:'media_list'},api_sources:{}}};
await processCabinetSource(admin,structuredClone(job),async()=>Array.from({length:100},(_,i)=>({advertId:i+1,status:7,endTime:'2026-08-01T00:00:00+03:00'})));
assert.equal(job.status,'loading','a fully excluded page is not proof that following pages have no spend');
assert.equal(job.summary.api_sources.media.list_offset,100);assert.equal(job.summary.pilot.stage,'media_list');
await processCabinetSource(admin,structuredClone(job),async(_key,url)=>{assert.ok(url.includes('offset=100'));return[{advertId:101,status:7,endTime:'2026-09-10T00:00:00+03:00'}];});
assert.equal(job.summary.pilot.stage,'media_stats');assert.deepEqual(job.summary.api_sources.media.campaign_ids,[101]);

job={...job,status:'loading',summary:{pilot:{stage:'media_stats'},api_sources:{media:{selection_version:2,campaign_ids:[11,22,33,44,55],stats_offset:0,partial_amount:'0.00',campaign_records:[11,22,33,44,55].map(id=>({id,status:8}))}}}};
let calls=0;
await processCabinetSource(admin,structuredClone(job),async(_key,url)=>{calls++;assert.ok(url.includes('/adv/v1/advert?id='));return {advertId:Number(url.split('id=')[1]),extended:{expenses:0}};});
assert.equal(calls,5,'bounded batch under personal Media burst limit');assert.equal(job.status,'complete');assert.equal(job.summary.api_sources.media.amount,'0.00');
