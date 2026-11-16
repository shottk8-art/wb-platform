import assert from 'node:assert/strict';
import test from 'node:test';
import {processCabinetSource} from '../supabase/functions/wb-api/cabinet.ts';
import {processStocks,demandPeriod} from '../supabase/functions/wb-api/stocks.ts';
import {ApiError} from '../supabase/functions/wb-api/core.ts';
import {DAILY_USER_ID} from '../supabase/functions/wb-api/daily-access.ts';
import {shopOwnerQuery} from './helpers/private-owner.mjs';
import {retrySeconds} from '../supabase/functions/wb-api/rate-limit.ts';

const shop='853b81a0-e0e2-4195-bc80-1cdc362af946';
const token=`e30.${Buffer.from(JSON.stringify({acc:3,exp:4102444800})).toString('base64url')}.${'x'.repeat(100)}`;
function fixture(state){
  const rpcCalls=[];let wait=0;
  const admin={rpc:async(name,args)=>{rpcCalls.push({name,args});return {data:name==='wb_api_read_key'?token:['wb_api_claim_request','wb_api_claim_analytics'].includes(name)?wait:null,error:null};},from(table){
    if(table==='shops')return shopOwnerQuery(DAILY_USER_ID);
    let patch;const q={update(p){patch=p;return q;},eq(){return q;},then(a,b){Object.assign(state,patch);return Promise.resolve({error:null}).then(a,b);}};return q;
  }};
  return {admin,rpcCalls,setWait:n=>{wait=n;}};
}
const debit={advertId:1,updSum:25,paymentType:'Баланс',updTime:'2026-10-15T12:00:00+03:00'};

test('one debit read supplies monthly, daily and SKU advertising',async()=>{
  const job={id:'budget',shop_id:shop,date_from:'2026-10-01',date_to:'2026-10-31',status:'loading',summary:{pilot:{stage:'ads',finance_complete:true},api_sources:{}}};
  const {admin}=fixture(job),urls=[];
  const fetcher=async(_token,url)=>{urls.push(url);if(url.includes('/upd?'))return [debit];if(url.includes('/adverts?'))return [];
    if(url.includes('/fullstats?'))return [{advertId:1,currency:'RUB',sum:25,days:[{date:'2026-10-15',apps:[{appType:1,nms:[{nmId:12,sum:25}]}]}]}];
    throw Error('Unexpected upstream '+url);
  };
  for(let i=0;i<8&&job.status!=='complete';i++)await processCabinetSource(admin,structuredClone(job),fetcher);
  assert.equal(job.status,'complete');
  assert.equal(urls.filter(u=>u.includes('/upd?')).length,1,'the same period must not be downloaded twice');
  assert.equal(job.summary.api_sources.internal_ads.period_totals.Баланс.amount,'25.00');
  assert.equal(job.summary.api_sources.internal_ads.daily_totals['2026-10-15'].Баланс.amount,'25.00');
  assert.equal(job.summary.api_sources.article_ads.campaigns[0].totals.Баланс.amount,'25.00');
});

function stockState(age=0,period=demandPeriod()){
  return {shop_id:shop,stage:'wb',page_offset:0,pending:{},lease_token:'lease',alert_days:14,target_days:30,
    snapshot:{version:1,rows:[],catalogue:[{nm_id:'12',article:'SKU',name:'Product',orders:28}],
      demand:{...period,checked_at:new Date(Date.now()-age).toISOString()}}};
}
const stockRow={nmId:12,chrtId:1,warehouseId:1,warehouseName:'Warehouse',regionName:'Russia',quantity:5,inWayToClient:0,inWayFromClient:0};
function stockFetcher(urls){return async(_token,url,body)=>{
  urls.push(url);
  if(url.includes('wb-warehouses'))return {data:{items:[stockRow]}};
  if(url.includes('seller-warehouses'))return null;
  return {data:{products:[{product:{nmId:12,vendorCode:'SKU',title:'Product'},statistic:{selected:{period:body.selectedPeriod,orderCount:28}}}]}};
};}
async function cycle(state,admin,fetcher){for(let i=0;i<5&&state.stage!=='idle';i++)await processStocks(admin,structuredClone(state),fetcher);assert.equal(state.stage,'idle');}

test('warm inventory cycle reuses the same complete demand for at most two hours',async()=>{
  const state=stockState(30*60000),oldDemand=structuredClone(state.snapshot.demand),{admin}=fixture(state),urls=[];
  await cycle(state,admin,stockFetcher(urls));
  assert.equal(urls.length,2,'only WB and seller stock require new upstream reads');
  assert.deepEqual(state.snapshot.demand,oldDemand,'reuse must not extend demand freshness');
  assert.equal(state.snapshot.rows[0].quantity,5);
});

test('expired, future, changed-period or invalid demand is fetched again',async()=>{
  for(const state of [stockState(2*3600000),stockState(-60000),stockState(0,{from:'2026-01-01',to:'2026-01-28',days:28}),
    {...stockState(),snapshot:{...stockState().snapshot,catalogue:null}}]){
    const {admin}=fixture(state),urls=[];await cycle(state,admin,stockFetcher(urls));assert.equal(urls.length,3);
    assert.deepEqual({from:state.snapshot.demand.from,to:state.snapshot.demand.to,days:state.snapshot.demand.days},demandPeriod());
  }
});

test('Media estimate preserves the WB-mandated cooldown',async()=>{
  const job={id:'limited',shop_id:shop,date_from:'2026-10-01',date_to:'2026-10-31',status:'loading',summary:{pilot:{stage:'media_list',finance_complete:true},api_sources:{}}};
  const {admin,rpcCalls}=fixture(job);
  await processCabinetSource(admin,structuredClone(job),async()=>{throw new ApiError(429,'Limited',43109);});
  assert.equal(job.summary.api_sources.media.estimated,true);
  assert.ok(rpcCalls.some(c=>c.name==='wb_api_defer_request'&&c.args.p_seconds>=43109),'estimate cannot swallow Retry');
});

test('inventory respects the seller cooldown before decrypting or requesting',async()=>{
  const state=stockState(),{admin,rpcCalls,setWait}=fixture(state);setWait(43109);let calls=0;
  await processStocks(admin,structuredClone(state),async()=>{calls++;throw Error('must not call');});
  assert.equal(calls,0);assert.equal(rpcCalls.filter(c=>c.name==='wb_api_read_key').length,0);
  assert.equal(state.stage,'wb');assert.ok(Date.parse(state.next_run_at)>=Date.now()+43100*1000);
});

test('Retry uses the required delay, never burst Reset',()=>{
  assert.equal(retrySeconds(new Headers({'X-Ratelimit-Retry':'2','X-Ratelimit-Reset':'9999'})),63);
  assert.equal(retrySeconds(new Headers({'X-Ratelimit-Retry':'43109'})),43109);
  assert.equal(retrySeconds(new Headers({'Retry-After':'120.1'})),121);
  const now=Date.parse('2026-11-16T00:00:00Z');
  assert.equal(retrySeconds(new Headers({'Retry-After':'Mon, 16 Nov 2026 00:05:00 GMT'}),63,now),300);
  for(const value of ['Infinity','-1','bad'])assert.equal(retrySeconds(new Headers({'X-Ratelimit-Retry':value})),63);
});

test('an occupied analytics slot delays monthly orders without another WB call',async()=>{
  const job={id:'orders',shop_id:shop,date_from:'2026-10-01',date_to:'2026-10-31',status:'loading',summary:{pilot:{stage:'orders'},api_sources:{}}};
  const {admin}=fixture(job),rpc=admin.rpc;
  admin.rpc=(name,args)=>name==='wb_api_claim_analytics'?Promise.resolve({data:21,error:null}):rpc(name,args);
  let calls=0;const result=await processCabinetSource(admin,structuredClone(job),async()=>{calls++;});
  assert.equal(calls,0);assert.equal(result.retry_after,21);assert.equal(job.summary.pilot.stage,'orders');
});

test('legacy ads-only preparation still obtains missing campaign attribution once',async()=>{
  const job={id:'legacy',shop_id:shop,date_from:'2026-10-01',date_to:'2026-10-31',status:'loading',summary:{pilot:{stage:'article_ads_debits'},api_sources:{internal_ads:{status:'downloaded',period_totals:{}}}}};
  const {admin}=fixture(job);let calls=0;
  await processCabinetSource(admin,structuredClone(job),async()=>{calls++;return [debit];});
  assert.equal(calls,1);assert.equal(job.summary.pilot.stage,'article_ads_stats');
  assert.equal(job.summary.api_sources.internal_ads.period_totals.Баланс.amount,'25.00');
});
