import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cabinetPeriod,readCabinet} from '../supabase/functions/wb-api/cabinet.ts';
import {PILOT_SHOP_ID} from '../supabase/functions/wb-api/core.ts';
import {processPage} from '../supabase/functions/wb-api/process.ts';

for (const day of ['2026-01-01','2026-03-01','2026-10-10']) {
  const now=new Date(day+'T12:00:00Z'), [year,month]=day.split('-').map(Number);
  const periods=Array.from({length:12},(_,i)=>cabinetPeriod(new Date(Date.UTC(year,month-1-i,1)).toISOString().slice(0,7),now));
  assert.equal(periods.length,12);
  assert.equal(new Set(periods.map(p=>p.dateFrom)).size,12);
  assert.equal(periods[0].dateTo,day);
  for(const p of periods) assert.ok(p.dateTo<=day);
  assert.throws(()=>cabinetPeriod(new Date(Date.UTC(year,month,1)).toISOString().slice(0,7),now));
}
assert.equal(cabinetPeriod('2024-02',new Date('2024-03-01T12:00:00Z')).dateTo,'2024-02-29');
assert.equal(cabinetPeriod('2026-10',new Date('2026-10-09T22:00:00Z')).dateTo,'2026-10-10');
// Execute the actual financial request boundary with a harmless fake token.
const token=`e30.${Buffer.from(JSON.stringify({acc:3,exp:4102444800})).toString('base64url')}.${'x'.repeat(100)}`;
const jobs=[],admin={rpc:async name=>({data:name==='wb_api_read_key'?token:0}),from(){const q={update(v){jobs.push(v);return q;},eq(){return q;},then(resolve){return Promise.resolve({error:null}).then(resolve);}};return q;}};
let request;
await processPage(admin,{id:'current',shop_id:PILOT_SHOP_ID,date_from:'2026-10-01',date_to:'2026-10-10',cursor_id:'0',summary:{pilot:{stage:'finance',finance_period:'daily'}}},PILOT_SHOP_ID,async(_key,_url,body)=>{request=body;return [];});
assert.equal(request.period,'daily');assert.equal(request.dateTo,'2026-10-10T23:59:59');
assert.equal(jobs[0].summary.pilot.stage,'orders');
await processPage(admin,{id:'closed',shop_id:PILOT_SHOP_ID,date_from:'2026-09-01',date_to:'2026-09-30',cursor_id:'0',summary:{pilot:{stage:'finance',finance_period:'weekly'}}},PILOT_SHOP_ID,async(_key,_url,body)=>{request=body;return [];});
assert.equal(request.period,'weekly');

// Read-model integration: keep one completed snapshot during refresh, using
// its own end date; no new partial rows may leak into the old total.
const saved={id:'saved',date_from:'2026-10-01',date_to:'2026-10-09',status:'complete',row_count:0,summary:{pilot:{stage:'done',finance_complete:true},api_sources:{orders:{status:'downloaded',orders_amount:'0',rows:[]},internal_ads:{status:'downloaded',period_totals:{}},media:{status:'downloaded',date_from:'2026-10-01',date_to:'2026-10-09',amount:'0.00'}}}};
const loading={id:'loading',date_from:'2026-10-01',date_to:'2026-10-10',status:'loading',row_count:12,summary:{pilot:{stage:'finance'}}};
const reader={from(table){const filters={};let size;
  const q={select(){return q;},eq(k,v){filters[k]=v;return q;},order(){return q;},limit(v){size=v;return q;},range(){return q;},single:async()=>({data:{id:PILOT_SHOP_ID,name:'Test',tax_rate:0}}),then(resolve){
    let data=table==='wb_api_preview_jobs'?[loading,saved].filter(j=>Object.entries(filters).every(([k,v])=>k==='shop_id'||j[k]===v)):[];
    if(size)data=data.slice(0,size);return Promise.resolve({data,error:null}).then(resolve);
  }};return q;}};
const result=await readCabinet(reader,PILOT_SHOP_ID,{dateFrom:'2026-10-01',dateTo:'2026-10-10'});
assert.equal(result.job.id,'saved');assert.equal(result.refresh_job.id,'loading');
assert.equal(result.complete,true);assert.equal(result.period.dateTo,'2026-10-09');
assert.equal(result.sources.media.status,'downloaded');
assert.equal(result.job.row_count,0,'partial refreshed rows never become saved snapshot rows');
const sql=readFileSync(new URL('../supabase/migrations/20261010150000_wb_api_year_history.sql',import.meta.url),'utf8');
assert.match(sql,/0\.\.11/);assert.match(sql,/Europe\/Moscow/);assert.match(sql,/pg_advisory_xact_lock/);
assert.match(sql,/date_from=p_month and status='loading'/);assert.match(sql,/date_to=finish/);
assert.match(sql,/j.date_from desc/);assert.match(sql,/perform public.wb_api_queue_history/);
assert.match(sql,/revoke all[\s\S]*from public,anon,authenticated/);
console.log('Year history: passed (12 months, Moscow today, leap year, daily vs weekly finance, snapshot isolation, private durable queue).');
