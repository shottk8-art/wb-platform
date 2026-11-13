import {shopOwnerQuery} from './helpers/private-owner.mjs';
import assert from 'node:assert/strict';
import { processCabinetSource } from '../supabase/functions/wb-api/cabinet.ts';
import { PILOT_SHOP_ID } from './fixtures/wb-api-identities.mjs';

// Replay the exact production symptom: the same campaign/interval returns
// HTTP 200 "Статистика в процессе получения" at every background tick.
const from='2026-09-01',to='2026-09-30';
const token=`e30.${Buffer.from(JSON.stringify({acc:3,exp:4102444800})).toString('base64url')}.${'x'.repeat(100)}`;
let job={id:'media-stall',shop_id:PILOT_SHOP_ID,status:'loading',date_from:from,date_to:to,
  summary:{pilot:{stage:'media_stats'},api_sources:{media:{status:'loading',amount:null,campaign_ids:[11],stats_offset:0,partial_amount:'0.00'}}}};
const admin={rpc:async name=>({data:name==='wb_api_read_key'?token:0}),from(table){if(table==='shops')return shopOwnerQuery();let values;const q={update(v){values=v;return q;},eq(){return q;},then(resolve,reject){Object.assign(job,values);return Promise.resolve({error:null}).then(resolve,reject);}};return q;}};
let cardCalls=0,statsCalls=0;
const pending=async(_key,url)=>{
  if(url.includes('/advert?id=')){cardCalls++;return {advertId:11,extended:{expenses:'100.00'}};}
  statsCalls++;return [{interval:{begin:from,end:to},advert_id:11,error:'Статистика в процессе получения'}];
};
for(let tick=0;tick<25;tick++){
  await processCabinetSource(admin,structuredClone(job),pending);
  if(job.status==='complete')break;
}
assert.equal(job.status,'complete','unavailable Media must not block other known financial data');
assert.equal(job.summary.api_sources.media.amount,'0.00');
assert.equal(job.summary.api_sources.media.status,'estimated','temporary zero is explicitly distinguished from received zero');
assert.equal(job.summary.api_sources.media.estimated,true);
assert.equal(job.summary.api_sources.media.stats_offset,0,'never skip an unresolved campaign');
assert.equal(cardCalls,1,'persisted expense evidence must not be refetched on every preparation retry');
assert.equal(statsCalls,3,'two interval attempts and one complete-history fallback before a labelled estimate');
console.log('WB Media stalled preparation: bounded wait, explicit temporary zero, preserved cursor passed.');
