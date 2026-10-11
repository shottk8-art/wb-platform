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
assert.equal(requests.filter(url=>url.includes('/stats')).length,0,'confirmed zero expense must be filtered before requesting statistics');
assert.equal(job.summary.api_sources.media.format_issue,undefined);

for (const evidence of [null,{advertId:421854,status:7},{advertId:421854,status:7,extended:{expenses:100}},{advertId:123,extended:{expenses:0}}]) {
  job=initial();requests=[];detail=evidence;
  await assert.rejects(()=>processCabinetSource(admin,structuredClone(job),fetcher));
  assert.equal(job.summary.api_sources.media.stats_offset,0,'unknown/nonzero evidence must not advance the cursor');
  assert.equal(job.summary.api_sources.media.amount,null);
  assert.notEqual(job.status,'complete');
}
// Positive lifetime spend is only a selection hint, not the monthly expense.
// Missing lifetime expense must still request interval stats rather than skip.
for (const evidence of [{advertId:421854,extended:{expenses:'1000.00'}},{advertId:421854},null]) {
  job=initial();requests=[];
  await processCabinetSource(admin,structuredClone(job),async(_token,url)=>{
    requests.push(url);
    return url.includes('/advert?id=')?evidence:[{interval:{begin:job.date_from,end:job.date_to},stats:[{expenses:'123.45'}]}];
  });
  assert.equal(job.summary.api_sources.media.amount,'123.45');
  assert.equal(requests.length,2);
  assert.ok(requests[0].includes('/advert?id='));
  assert.ok(requests[1].includes('/stats'));
}

// Active, paused, completed and declined campaigns follow the same expense rule.
for (const status of [4,6,7,8,9]) {
  job=initial();requests=[];detail={advertId:421854,status,extended:{expenses:0}};
  job.summary.api_sources.media.campaign_records[0].status=status;
  await processCabinetSource(admin,structuredClone(job),fetcher);
  assert.equal(job.summary.api_sources.media.amount,'0.00');
  assert.equal(requests.length,1);
  assert.ok(requests[0].includes('/advert?id='));
}

// Older queued jobs without campaign records also filter before statistics.
job=initial();requests=[];detail={advertId:421854,extended:{expenses:0}};
delete job.summary.api_sources.media.campaign_records;
await processCabinetSource(admin,structuredClone(job),fetcher);
assert.equal(job.summary.api_sources.media.amount,'0.00');
assert.equal(requests.length,1);
assert.equal(job.summary.api_sources.media.campaign_records[0].evidence.no_spend_in_month,true);

// Skip zero first, then book only the paid campaign's requested interval.
job=initial();requests=[];
job.summary.api_sources.media.campaign_ids=[1,2,3];
job.summary.api_sources.media.campaign_records=[1,2,3].map(id=>({id,status:7}));
await processCabinetSource(admin,structuredClone(job),async(_token,url,body)=>{
  requests.push({url,body});
  if(url.includes('/advert?id=')) {
    const id=Number(new URL(url).searchParams.get('id'));
    return {advertId:id,extended:{expenses:id===1?'0.00':'1000.00'}};
  }
  assert.equal(body[0].id,2);
  assert.deepEqual(body[0].interval,{begin:job.date_from,end:job.date_to});
  return [{interval:body[0].interval,stats:[{expenses:'12.34'}]}];
});
assert.equal(requests.length,3);
assert.equal(requests.filter(r=>r.url.includes('/stats')).length,1);
assert.equal(job.summary.api_sources.media.partial_amount,'12.34');
assert.equal(job.summary.api_sources.media.stats_offset,2);
assert.equal(job.summary.api_sources.media.amount,null,'partial paid totals must not be published as complete');
assert.equal(job.status,'loading');

// Zero-expense batches never request statistics and retain bounded work.
job=initial();requests=[];
job.summary.api_sources.media.campaign_ids=Array.from({length:10},(_,i)=>i+1);
job.summary.api_sources.media.campaign_records=job.summary.api_sources.media.campaign_ids.map(id=>({id,status:7}));
const bounded=async(_token,url)=>{requests.push(url);return url.includes('/stats')?unavailable:{advertId:Number(new URL(url).searchParams.get('id')),extended:{expenses:0}}};
await processCabinetSource(admin,structuredClone(job),bounded);
assert.equal(requests.length,5,'five zero campaigns use only five card requests');
assert.ok(requests.every(url=>url.includes('/advert?id=')));
assert.equal(job.summary.api_sources.media.stats_offset,5);
assert.equal(job.status,'loading');
requests=[];
await processCabinetSource(admin,structuredClone(job),bounded);
assert.equal(requests.length,5);
assert.equal(job.status,'complete');
assert.equal(job.summary.api_sources.media.amount,'0.00');
console.log('WB Media expense-first: PASS (zero stats calls for zero expenses, monthly not lifetime spend, unknown guard, bounded requests).');
