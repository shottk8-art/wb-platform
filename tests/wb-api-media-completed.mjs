import assert from 'node:assert/strict';
import { processCabinetSource } from '../supabase/functions/wb-api/cabinet.ts';
import { PILOT_SHOP_ID } from '../supabase/functions/wb-api/core.ts';
const token=`e30.${Buffer.from(JSON.stringify({acc:3,exp:4102444800})).toString('base64url')}.${'x'.repeat(100)}`;
// Actual WB failure for completed GREEN FLOW placement 421854 (February).
const unavailable=[{error:'не удалось получить id баннеров размещения. Возможно, размещение находится в статусе «Отклонено»'}];
const initial=()=>({id:'completed-test',shop_id:PILOT_SHOP_ID,date_from:'2026-02-01',date_to:'2026-02-28',status:'loading',failure_count:0,
  summary:{pilot:{stage:'media_stats',finance_complete:true},api_sources:{orders:{status:'downloaded'},internal_ads:{status:'downloaded'},media:{status:'loading',amount:null,selection_version:2,campaign_ids:[421854],campaign_records:[{id:421854,status:7}],stats_offset:0,partial_amount:'0.00'}}}});
let job,requests,detail;
const admin={rpc:async name=>({data:name==='wb_api_read_key'?token:0}),from(table){assert.equal(table,'wb_api_preview_jobs');let values;const q={update(v){values=v;return q},eq(){return q},then(resolve,reject){Object.assign(job,values);return Promise.resolve({error:null}).then(resolve,reject)}};return q}};
const fetcher=async(_token,url)=>{requests.push(url);return url.includes('/stats')?unavailable:detail};
job=initial();requests=[];detail={advertId:421854,status:7,extended:{expenses:0}};
await processCabinetSource(admin,structuredClone(job),fetcher);
assert.equal(job.status,'complete','completed campaign with unavailable stats and explicit lifetime zero must not block the year');
assert.equal(job.summary.api_sources.media.amount,'0.00');
assert.equal(job.summary.api_sources.media.stats_offset,1);
assert.equal(job.summary.pilot.finance_complete,true);
assert.equal(requests.filter(url=>url.includes('/advert?id=')).length,1);
assert.equal(job.summary.api_sources.media.format_issue,undefined);

for (const evidence of [null,{advertId:421854,status:7},{advertId:421854,status:7,extended:{expenses:100}},{advertId:123,extended:{expenses:0}}]) {
  job=initial();requests=[];detail=evidence;
  await assert.rejects(()=>processCabinetSource(admin,structuredClone(job),fetcher));
  assert.equal(job.summary.api_sources.media.stats_offset,0,'unknown/nonzero evidence must not advance the cursor');
  assert.equal(job.summary.api_sources.media.amount,null);
  assert.notEqual(job.status,'complete');
}
// Valid statistics still follow the original money path, no extra card fetch.
job=initial();requests=[];
await processCabinetSource(admin,structuredClone(job),async(_token,url)=>{requests.push(url);return [{interval:{begin:job.date_from,end:job.date_to},stats:[{expenses:'123.45'}]}]});
assert.equal(job.summary.api_sources.media.amount,'123.45');
assert.equal(requests.length,1);

// Completed-card fallbacks stay within the documented personal-token burst.
job=initial();requests=[];
job.summary.api_sources.media.campaign_ids=Array.from({length:10},(_,i)=>i+1);
job.summary.api_sources.media.campaign_records=job.summary.api_sources.media.campaign_ids.map(id=>({id,status:7}));
const bounded=async(_token,url)=>{requests.push(url);return url.includes('/stats')?unavailable:{advertId:Number(new URL(url).searchParams.get('id')),extended:{expenses:0}}};
await processCabinetSource(admin,structuredClone(job),bounded);
assert.equal(requests.length,10,'five campaigns use no more than ten requests');
assert.equal(job.summary.api_sources.media.stats_offset,5);
assert.equal(job.status,'loading');
requests=[];
await processCabinetSource(admin,structuredClone(job),bounded);
assert.equal(requests.length,10);
assert.equal(job.status,'complete');
assert.equal(job.summary.api_sources.media.amount,'0.00');
console.log('Completed WB Media regression: PASS (actual unavailable-banner response, zero evidence, unknown/nonzero guard, valid spend).');
