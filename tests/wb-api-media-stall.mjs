import assert from 'node:assert/strict';
import { processCabinetSource } from '../supabase/functions/wb-api/cabinet.ts';
import { PILOT_SHOP_ID } from '../supabase/functions/wb-api/core.ts';

// Replay the exact production symptom: the same campaign/interval returns
// HTTP 200 "Статистика в процессе получения" at every background tick.
const from='2026-09-01',to='2026-09-30';
const token=`e30.${Buffer.from(JSON.stringify({acc:3,exp:4102444800})).toString('base64url')}.${'x'.repeat(100)}`;
let job={id:'media-stall',shop_id:PILOT_SHOP_ID,status:'loading',date_from:from,date_to:to,
  summary:{pilot:{stage:'media_stats'},api_sources:{media:{status:'loading',amount:null,campaign_ids:[11],stats_offset:0,partial_amount:'0.00'}}}};
const admin={rpc:async name=>({data:name==='wb_api_read_key'?token:0}),from(){let values;const q={update(v){values=v;return q;},eq(){return q;},then(resolve,reject){Object.assign(job,values);return Promise.resolve({error:null}).then(resolve,reject);}};return q;}};
const pending=async()=>[{interval:{begin:from,end:to},advert_id:11,error:'Статистика в процессе получения'}];
let stopped;
for(let tick=0;tick<25;tick++){
  try{await processCabinetSource(admin,structuredClone(job),pending);}
  catch(error){stopped=error;break;}
}
assert.ok(stopped,'WB Media must not repeat the same pending response forever without a bounded, actionable result');
assert.equal(stopped.status,400,'upstream preparation timeout is resumable by the user, not another automatic error retry loop');
assert.match(stopped.message,/WB Медиа/);
assert.equal(job.summary.api_sources.media.amount,null,'timeout is not zero spend');
assert.equal(job.summary.api_sources.media.stats_offset,0,'never skip an unresolved campaign');
console.log('WB Media stalled preparation: bounded wait, unknown spend, preserved cursor passed.');
