import assert from 'node:assert/strict';
import {processPage} from '../supabase/functions/wb-api/process.ts';
import {decodeUnitDaily,UNIT_DAILY_CODEC,UNIT_DAILY_SCHEMA,UNIT_DAILY_MONEY_FIELDS} from '../supabase/functions/wb-api/unit.ts';
import {PILOT_SHOP_ID as shop} from './fixtures/wb-api-identities.mjs';

// Local worker CPU and uncompressed JSON measurements, not an Edge-runtime
// performance guarantee. Dense SKU x day fixtures avoid the correlated modulo
// pattern in the original pagination test (only 300 distinct SKU-days there).
const token=`e30.${Buffer.from(JSON.stringify({acc:3,exp:4102444800})).toString('base64url')}.${'x'.repeat(100)}`;
for(const skus of [100,1000]) {
  const rows=Array.from({length:50000},(_,i)=>({rrdId:i+1,
    rrDate:`2026-09-${String(Math.floor(i/skus)%30+1).padStart(2,'0')}T12:00:00+03:00`,
    vendorCode:'sku-'+i%skus,title:'Synthetic product '+i%skus,
    sellerOperName:'Продажа',docTypeName:'Продажа',quantity:1,
    retailPriceWithDisc:'100.01',retailAmount:'95.00',forPay:'80.07',deliveryService:'0.10'}));
  let job={id:'budget',shop_id:shop,date_from:'2026-09-01',date_to:'2026-09-30',cursor_id:'0',row_count:0,
    summary:{pilot:{stage:'finance',finance_period:'weekly'}}};
  let requests=0,written=0;const pageCpu=[];
  const admin={from(){throw Error('unexpected table read')},async rpc(name,args){
    if(name==='app_shop_section_enabled')return {data:true};
    if(name==='wb_api_read_key')return {data:token};
    if(name==='wb_api_claim_request'||name==='seed_cost_cards')return {data:0};
    assert.equal(name,'wb_api_commit_finance_page');
    assert.equal(args.p_expected_cursor,job.cursor_id);assert.equal(args.p_expected_rows,job.row_count);
    written+=Buffer.byteLength(JSON.stringify(args.p_model));
    job={...job,finance_model:args.p_model,summary:args.p_summary,cursor_id:args.p_cursor,row_count:args.p_model.row_count};
    return {data:true};
  }};
  while(job.summary.pilot.stage==='finance') {
    const snapshot=structuredClone(job),started=process.cpuUsage();
    await processPage(admin,snapshot,shop,async(_key,_url,body)=>{
      assert.equal(body.limit,10000);requests++;
      return rows.slice(body.rrdId,body.rrdId+body.limit);
    });
    const cpu=process.cpuUsage(started);pageCpu.push((cpu.user+cpu.system)/1000);
    assert.ok(requests<=6);
  }
  assert.equal(requests,6);assert.equal(job.row_count,50000);
  const model=job.finance_model,{daily,...monthly}=model.unit;
  assert.equal(daily.buckets.length,skus*30);assert.equal(daily.covered_rows,50000);assert.equal(daily.history_complete,true);
  const modelBytes=Buffer.byteLength(JSON.stringify(model));
  const oldBytes=Buffer.byteLength(JSON.stringify({...model,unit:monthly}));
  const addedBytes=modelBytes-oldBytes;
  const decoded=decodeUnitDaily(model.unit);assert.ok(decoded);
  const {codec,schema,money_fields,...legacyDaily}=decoded;legacyDaily.version=1;
  const legacyAddedBytes=Buffer.byteLength(JSON.stringify({...model,unit:{...monthly,daily:legacyDaily}}))-oldBytes;
  assert.equal(daily.codec,UNIT_DAILY_CODEC);assert.deepEqual(daily.schema,UNIT_DAILY_SCHEMA);assert.deepEqual(daily.money_fields,UNIT_DAILY_MONEY_FIELDS);
  assert.ok(addedBytes<=4_000_000,'50,000 rows / 1,000 SKUs must add at most 4 MB of daily JSON');
  assert.ok(addedBytes/daily.buckets.length<140,'sparse tuples must stay compact per SKU-day');
  assert.ok(addedBytes<legacyAddedBytes*0.3,'daily JSON must shrink by more than 70% versus the full v1 representation');
  assert.doesNotMatch(JSON.stringify(daily),/rrdId|retailPriceWithDisc|sellerOperName|"article"|"name"|Synthetic product/);
  console.log(JSON.stringify({rows:rows.length,skus,sku_days:daily.buckets.length,requests,
    page_cpu_ms:pageCpu.map(n=>Math.round(n)),model_json_bytes:modelBytes,
    added_daily_json_bytes:addedBytes,added_bytes_per_sku_day:Math.round(addedBytes/daily.buckets.length),
    legacy_daily_json_bytes:legacyAddedBytes,reduction_percent:Math.round((1-addedBytes/legacyAddedBytes)*1000)/10,
    all_page_model_write_bytes:written}));
}
console.log('Unit daily budget PASS: dense 100/1000 SKU months, bounded 10,000-row pages, unchanged six reads, exact coverage and compact SKU-day storage.');
