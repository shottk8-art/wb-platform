import assert from 'node:assert/strict';
import {aggregateUnitFinance,mergeUnitFinance,clipUnitFinance,readUnit,unitMonths,UNIT_DAILY_MONEY_FIELDS} from '../supabase/functions/wb-api/unit.ts';
import {aggregateFinanceRows,adsSnapshot,processCabinetSource} from '../supabase/functions/wb-api/cabinet.ts';
import {campaignDebits,campaignStats,articleAdvertising,clipArticleAdvertising} from '../supabase/functions/wb-api/article-ads.ts';
import {processPage} from '../supabase/functions/wb-api/process.ts';
import {cents,FINANCE_FIELDS} from '../supabase/functions/wb-api/core.ts';
import {PILOT_SHOP_ID as shop} from './fixtures/wb-api-identities.mjs';

// No network/database: exercise the real reducers, read boundary and durable
// workers using scoped in-memory query/RPC implementations.
const now=new Date(Date.now()+3*3600000);
const monthAt=offset=>new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+offset,1)).toISOString().slice(0,7);
const first=monthAt(-2),second=monthAt(-1);
const period=month=>({dateFrom:month+'-01',dateTo:new Date(Date.UTC(+month.slice(0,4),+month.slice(5),0)).toISOString().slice(0,10)});
const day=(month,n)=>month+'-'+String(n).padStart(2,'0');
const selected={dateFrom:day(first,5),dateTo:day(first,6)};
const orders=[{nm_id:'1',vendor_code:'A'},{nm_id:'2',vendor_code:'B'},{nm_id:'3',vendor_code:'C'}];
const prices=[{article:'a',cost_price:20},{article:'b',cost_price:40}];
const debit=(id,amount,date,type='Баланс')=>({advertId:id,updSum:amount,paymentType:type,updTime:date+'T10:00:00+03:00'});
const statDay=(date,nms)=>({date:date+'T00:00:00Z',sum:nms.reduce((n,p)=>n+Number(p.sum),0),apps:[{appType:1,nms}]});
const nm=(nmId,sum)=>({nmId,sum,name:'SKU '+nmId});
const stat=(advertId,days)=>({advertId,currency:'RUB',sum:days.reduce((n,d)=>n+d.sum,0),days});
function adFixture(month) {
  const p=period(month);
  const debits=[debit(1,30,day(month,5)),debit(1,10,day(month,6)),debit(1,10,day(month,6),'Промобонусы'),
    debit(2,900,day(month,20)),debit(3,12,day(month,6))];
  const stats=[stat(1,[statDay(day(month,5),[nm(1,30)]),statDay(day(month,6),[nm(1,20)])]),
    stat(2,[statDay(day(month,20),[nm(2,900)])]),stat(3,[statDay(day(month,6),[nm(3,12)])])];
  const source=campaignDebits(debits,p.dateFrom,p.dateTo);
  for(const c of campaignStats(stats,source.campaigns.map(c=>c.id),p.dateFrom,p.dateTo))Object.assign(source.campaigns.find(p=>p.id===c.id),c);
  return {source:{...source,status:'downloaded'},debits,stats};
}
function financeRows(month) {
  return [
    {rrDate:day(month,5),vendorCode:' A ',sellerOperName:'Продажа',docTypeName:'Продажа',quantity:2,retailPriceWithDisc:100,forPay:160,deliveryService:10},
    // Offset midnight belongs to Moscow's sixth day. saleDt must be ignored.
    {rrDate:day(month,5)+'T22:00:00Z',saleDt:day(month,20),vendorCode:'a',sellerOperName:'Возврат',docTypeName:'Возврат',quantity:1,retailPriceWithDisc:100,forPay:80,deliveryService:3},
    {rrDate:day(month,6),vendorCode:'B',sellerOperName:'Продажа',docTypeName:'Продажа',quantity:1,retailPriceWithDisc:200,forPay:150},
    {rrDate:day(month,6),vendorCode:'B',sellerOperName:'Удержание',bonusTypeName:'WB Медиа',deduction:7},
    {rrDate:day(month,5),vendorCode:'A',sellerOperName:'Удержание',bonusTypeName:'WB Продвижение',deduction:10},
    {rrDate:day(month,6),sellerOperName:'Хранение',paidStorage:7},
    {rrDate:day(month,20),vendorCode:'A',sellerOperName:'Продажа',docTypeName:'Продажа',quantity:1,retailPriceWithDisc:1000,forPay:800},
    {rrDate:day(month,20),vendorCode:'B',sellerOperName:'Удержание',bonusTypeName:'WB Продвижение',deduction:100},
  ];
}
function jobFixture(month,input=financeRows(month)) {
  const p=period(month),ad=adFixture(month),cursor='99';
  return {id:'job-'+month,shop_id:shop,status:'complete',date_from:p.dateFrom,date_to:p.dateTo,cursor_id:cursor,row_count:input.length,
    updated_at:p.dateTo+'T12:00:00Z',finance_model:{...aggregateFinanceRows(input,cursor),unit:aggregateUnitFinance(input,cursor)},
    summary:{pilot:{finance_complete:true},api_sources:{article_ads:ad.source,
      orders:{status:'downloaded',orders_amount:'9000.00',rows:orders},
      internal_ads:adsSnapshot(ad.debits,p.dateFrom,p.dateTo,true),
      media:{status:'downloaded',date_from:p.dateFrom,date_to:p.dateTo,amount:'0.00'}}}};
}
function reader(jobs,options={}) {
  const reads=[];
  const data={shops:[{id:shop,name:'Synthetic',tax_rate:6}],
    sku_costs:(options.prices||prices).map(p=>({...p,shop_id:shop})),
    wb_api_month_settings:jobs.map(j=>({shop_id:shop,month:j.date_from,operational_expenses:'999.00',external_promotion_expenses:'888.00'})),
    wb_api_preview_jobs:jobs};
  const admin={from(table) {
    assert.ok(Object.hasOwn(data,table),'reads use compact models, never raw rows');
    const filters={},bounds={};let columns='',limit=Infinity;
    const run=single=>{
      reads.push({table,columns,filters:{...filters}});
      assert.equal(filters[table==='shops'?'id':'shop_id'],shop,'every query remains tenant scoped');
      let rows=data[table].filter(p=>Object.entries(filters).every(([k,v])=>p[k]===v)).slice(0,limit);
      if(columns.includes('unit:'))rows=rows.map(j=>({cursor_id:j.cursor_id,unit:j.finance_model.unit,
        article_ads:j.summary.api_sources.article_ads,orders:j.summary.api_sources.orders.rows}));
      if(bounds.start!=null)rows=rows.slice(bounds.start,bounds.end+1);
      return {data:structuredClone(single?rows[0]:rows),error:null};
    };
    const q={select(v){columns=v;return q},eq(k,v){filters[k]=v;return q},order(){return q},limit(v){limit=v;return q},
      range(start,end){Object.assign(bounds,{start,end});return q},single:async()=>run(true),then:(a,b)=>Promise.resolve(run(false)).then(a,b)};
    return q;
  },rpc:async()=>{throw Error('read must not prepare sources or access live DB')}};
  return {admin,reads};
}
const job=jobFixture(first),db=reader([job]);
const originalJob=structuredClone(job);
const read=(jobs,range=selected,options)=>readUnit(reader(jobs,options).admin,shop,range.dateFrom.slice(0,7),range.dateTo.slice(0,7),range);
const result=await readUnit(db.admin,shop,first,first,selected);
assert.equal(result.status,'ready');assert.deepEqual(result.period,selected);
assert.equal(result.date_basis,'financial_operation_date');assert.equal(result.basis.date,'rrDate');
assert.equal(result.basis.finance,'daily_sku');assert.equal(result.basis.revenue,'seller_price');
assert.equal(result.totals.sales,'300.00');assert.equal(result.totals.internal_ads,'52.00');assert.equal(result.totals.net_profit,'80.00');
const a=result.products.find(p=>p.article.trim().toLowerCase()==='a');
assert.equal(a.quantity,1);assert.equal(a.sales,'100.00');assert.equal(a.net_profit,'1.00');assert.equal(a.internal_ads,'40.00');
assert.equal(a.ad_stats_amount,'50.00','bonus statistic is separate from actual cash');
assert.equal(result.products.find(p=>p.article==='B').net_profit,'91.00');
assert.equal(result.products.find(p=>p.article==='C').net_profit,'-12.00','dated advertising-only SKU remains visible');
for(const p of result.products) {
  assert.equal(cents(p.sales)-p.expenses.reduce((n,e)=>n+cents(e.amount),0n),cents(p.net_profit));
  assert.ok(p.expenses.every(e=>!['operating','external','ads_difference'].includes(e.key)));
}
assert.equal(result.common_expenses.find(e=>e.key==='storage').amount,'7.00');
assert.equal(result.common_expenses.find(e=>e.key==='operating').amount,null);
assert.equal(result.common_expenses.find(e=>e.key==='operating').excluded,true);
assert.equal(result.excluded_expenses.length,2);assert.ok(result.common_expense_notes.length);
assert.equal(db.reads.filter(p=>p.table==='sku_costs').length,1);
assert.ok(db.reads.filter(p=>p.columns.includes('unit:')).every(p=>p.filters.id===job.id));
assert.deepEqual(job,originalJob,'read never mutates the saved cache');

// Arbitrary endpoints across months clip each source independently.
const cross={dateFrom:day(first,20),dateTo:day(second,6)};
const multi=await read([job,jobFixture(second)],cross);
assert.equal(multi.status,'ready');assert.equal(multi.totals.sales,'1300.00');assert.equal(multi.totals.internal_ads,'952.00');
assert.deepEqual(multi.period,cross);
const empty=await read([job],{dateFrom:day(first,7),dateTo:day(first,7)});
assert.equal(empty.status,'ready');assert.deepEqual(empty.products,[]);assert.equal(empty.totals.net_profit,'0.00');

const legacy=structuredClone(job);delete legacy.finance_model.unit.daily;
delete legacy.summary.api_sources.article_ads.daily;
for(const c of legacy.summary.api_sources.article_ads.campaigns){delete c.daily_totals;delete c.daily_stats;}
const monthly=await readUnit(reader([legacy]).admin,shop,first,first);
const full=await read([legacy],period(first));
assert.equal(full.status,'ready');assert.equal(full.basis.finance,'monthly_sku');
assert.deepEqual(full.products,monthly.products);assert.deepEqual(full.totals,monthly.totals);
assert.equal(full.common_expenses.find(e=>e.key==='operating').amount,'999.00','complete calendar month retains its common sums');
assert.deepEqual(full.excluded_expenses,[]);
// Explicit month-to-date remains on the monthly path even without daily data.
// Only month-only common expense metadata changes; legacy sums stay intact.
const current=monthAt(0),currentJob=jobFixture(current,[{rrDate:day(current,1),vendorCode:'A',sellerOperName:'Продажа',docTypeName:'Продажа',quantity:1,retailPriceWithDisc:100,forPay:80}]);
currentJob.date_to=day(current,Math.min(now.getUTCDate(),20));
currentJob.summary.api_sources.media.date_to=currentJob.date_to;
currentJob.summary.api_sources.internal_ads=adsSnapshot([],currentJob.date_from,currentJob.date_to);
currentJob.summary.api_sources.article_ads={version:1,status:'downloaded',campaigns:[]};
delete currentJob.finance_model.unit.daily;
const legacyDb=reader([currentJob]),explicitDb=reader([currentJob]);
const legacyCurrent=await readUnit(legacyDb.admin,shop,current,current);
const explicitCurrent=await readUnit(explicitDb.admin,shop,current,current,{dateFrom:currentJob.date_from,dateTo:currentJob.date_to});
assert.equal(explicitCurrent.status,'ready');assert.equal(explicitCurrent.basis.finance,'monthly_sku');
assert.deepEqual(explicitCurrent.products,legacyCurrent.products);assert.deepEqual(explicitCurrent.totals,legacyCurrent.totals);
assert.deepEqual(explicitDb.reads,legacyDb.reads,'marking month-only expenses must not cause any extra finance/source reads');
for(const key of ['operating','external']) {
  assert.equal(legacyCurrent.common_expenses.find(e=>e.key===key).amount,key==='operating'?'999.00':'888.00');
  assert.equal(explicitCurrent.common_expenses.find(e=>e.key===key).amount,null);
  assert.equal(explicitCurrent.common_expenses.find(e=>e.key===key).excluded,true);
}
assert.equal(explicitCurrent.excluded_expenses.length,2);assert.ok(explicitCurrent.common_expense_notes.length);
assert.deepEqual(legacyCurrent.excluded_expenses,[]);assert.deepEqual(legacyCurrent.common_expense_notes,[]);
const needs=await read([legacy]);
assert.equal(needs.status,'needs_preparation');assert.deepEqual(needs.products,[]);assert.deepEqual(needs.period,selected);
assert.deepEqual(needs.pending[0].required_sources,['unit_daily_finance','article_ads_daily']);
const loading={...structuredClone(legacy),id:'loading',status:'loading',summary:{pilot:{stage:'finance'}}};
assert.equal((await read([loading,legacy])).status,'loading','old ready month cannot answer partial range while refresh loads');
const short=structuredClone(job);short.date_to=day(first,4);
assert.deepEqual((await read([short])).pending[0].required_sources,['finance_period'],'snapshot end must cover every requested day');
const emptyLegacy=jobFixture(first,[]);emptyLegacy.summary.api_sources.article_ads={version:1,status:'downloaded',campaigns:[]};
assert.equal((await read([emptyLegacy])).status,'needs_preparation','old empty ad cache does not prove daily zero');
emptyLegacy.summary.api_sources.article_ads={...campaignDebits([],period(first).dateFrom,period(first).dateTo),status:'downloaded'};
assert.equal((await read([emptyLegacy])).status,'ready','explicit completed empty coverage proves zero');

// Unknown source coverage/money never becomes a zero or a monthly estimate.
for(const change of [
  u=>{u.daily.cursor_id='98'},u=>{u.daily.row_count--},u=>{u.daily.covered_rows--},
  u=>{u.daily.history_complete=false},u=>{u.daily.buckets[0][4][UNIT_DAILY_MONEY_FIELDS.indexOf('forPay')]='999.00'},
  u=>{delete u.daily.money_fields},
  u=>{u.daily.buckets.push(structuredClone(u.daily.buckets[0]))},u=>{u.daily.buckets[0][0]=day(second,1)},
]) {
  const bad=structuredClone(job);change(bad.finance_model.unit);
  assert.equal((await read([bad])).status,'needs_preparation');
}
const undated=financeRows(first);delete undated[0].rrDate;undated[0].saleDt=day(first,5);
assert.equal((await read([jobFixture(first,undated)])).status,'needs_preparation','saleDt cannot replace rrDate');
const malformedDate=financeRows(first);malformedDate[0].rrDate=selected.dateFrom+'Tinvalid';
assert.equal((await read([jobFixture(first,malformedDate)])).status,'needs_preparation','invalid operation timestamp has no daily coverage');
const noPrice=financeRows(first);delete noPrice[0].retailPriceWithDisc;
const unknown=await read([jobFixture(first,noPrice)]);
assert.equal(unknown.status,'ready');assert.equal(unknown.totals.sales,null);assert.equal(unknown.totals.net_profit,null);
assert.equal((await read([job],selected,{prices:[]})).totals.net_profit,null,'missing current cost remains unknown');
const noDailyMedia=jobFixture(first,financeRows(first).filter(r=>r.bonusTypeName!=='WB Медиа'));
noDailyMedia.summary.api_sources.media.amount='17.00';
const media=await read([noDailyMedia]);
assert.equal(media.status,'ready');assert.equal(media.common_expenses.find(e=>e.key==='ads_difference').amount,null);
assert.equal(media.common_expenses.find(e=>e.key==='ads_difference').reason,'media_daily_unavailable');
assert.ok(media.products.every(p=>p.net_profit!==null),'unknown common Media never gets allocated to products');

// Daily reducer reconciliation and safe legacy/stale continuation.
const rows=financeRows(first);let merged=null;
for(let i=0;i<rows.length;i++)merged=mergeUnitFinance(merged,aggregateUnitFinance([rows[i]],String(i+1)),{cursor_id:String(i),row_count:i});
const whole=aggregateUnitFinance(rows,String(rows.length));
assert.deepEqual(merged,whole,'page partitioning preserves daily SKU money and metadata exactly');
assert.ok(clipUnitFinance(merged,period(first),selected));
const old=aggregateUnitFinance(rows.slice(0,2),'2');delete old.daily;
let resumed=mergeUnitFinance(old,aggregateUnitFinance(rows.slice(2),'99'),{cursor_id:'2',row_count:2});
resumed=mergeUnitFinance(resumed,aggregateUnitFinance([],'99'),{cursor_id:'99',row_count:rows.length});
assert.equal(resumed.row_count,rows.length);assert.equal(clipUnitFinance(resumed,period(first),selected),null);
const stale=mergeUnitFinance({...whole,cursor_id:'1'},aggregateUnitFinance([],'99'),{cursor_id:'99',row_count:rows.length});
assert.equal(stale.incomplete,true);assert.equal(clipUnitFinance(stale,period(first),selected),null);
const brokenDaily=structuredClone(whole);delete brokenDaily.daily.buckets;
const continued=mergeUnitFinance(brokenDaily,aggregateUnitFinance([],'99'),{cursor_id:whole.cursor_id,row_count:rows.length});
assert.equal(continued.daily.history_complete,false,'broken optional daily prefix cannot interrupt finance or become ready');
const compact=aggregateUnitFinance(Array.from({length:50000},(_,i)=>({...rows[0],rrDate:day(first,i%28+1)})),'50000');
assert.ok(JSON.stringify(compact).length<30000);assert.equal(compact.daily.buckets.length,28);
assert.doesNotMatch(JSON.stringify(compact),/rrdId|sellerOperName|retailPriceWithDisc|saleDt/);

// Actual ad dates are filtered before the existing direct cash attribution.
const ad=adFixture(first),ads=articleAdvertising(ad.source,orders,selected);
assert.equal(ads.products.get('a').amount,'40.00');assert.equal(ads.products.has('b'),false);
assert.equal(clipArticleAdvertising(legacy.summary.api_sources.article_ads,selected),null);
assert.equal(articleAdvertising(legacy.summary.api_sources.article_ads,orders,selected).unassigned,true);
for(const change of [
  s=>{delete s.campaigns[0].daily_stats},s=>{delete s.campaigns[0].daily_totals},
  s=>{s.campaigns[0].daily_stats.date_to=day(first,6)},s=>{s.campaigns[0].daily_totals[day(first,5)].Баланс.amount='0.00'},
  s=>{s.campaigns[0].daily_stats.days[0].nms[0].amount='0.00'},s=>{s.undated=true},
  s=>{delete s.campaigns[0].daily_totals[day(first,5)].Баланс.amount},
  s=>{s.campaigns[0].daily_stats.days[0].stats_total='0.00'},
]) {
  const bad=structuredClone(job);change(bad.summary.api_sources.article_ads);
  assert.equal((await read([bad])).status,'needs_preparation');
}
const mixed=campaignDebits([debit(1,50,selected.dateFrom),debit(1,50,selected.dateFrom,'Промобонусы')],period(first).dateFrom,period(first).dateTo);
Object.assign(mixed.campaigns[0],campaignStats([stat(1,[statDay(selected.dateFrom,[nm(1,60),nm(2,40)])])],[1],period(first).dateFrom,period(first).dateTo)[0]);
mixed.status='downloaded';
assert.equal(articleAdvertising(mixed,orders,selected).products.get('a').amount,null,'mixed multi-SKU daily cash cannot be prorated');
const midnight=campaignDebits([{...debit(1,5,day(first,4)),updTime:day(first,4)+'T22:00:00Z'}],period(first).dateFrom,period(first).dateTo);
assert.equal(midnight.campaigns[0].daily_totals[day(first,5)].Баланс.amount,'5.00');
assert.doesNotMatch(JSON.stringify(ad.source),/clicks|orders|views|apps|appType/,'only compact daily money/SKU amounts are persisted');

// Validation occurs before any DB work and enforces both cache-key months.
let queried=false;const forbidden={from(){queried=true;throw Error('unexpected query')}};
for(const range of [
  {dateFrom:day(first,6),dateTo:day(first,5)},
  {dateFrom:first+'-99',dateTo:day(first,6)},
  {dateFrom:day(first,5)+'T00:00:00Z',dateTo:day(first,6)},
  {dateFrom:day(second,5),dateTo:day(second,6)},
  {dateFrom:monthAt(1)+'-01',dateTo:monthAt(1)+'-02'},null,
])await assert.rejects(()=>readUnit(forbidden,shop,first,first,range),e=>e.status===400);
assert.equal(queried,false);
assert.equal(unitMonths(monthAt(-11),monthAt(0)).length,12);
assert.throws(()=>unitMonths(monthAt(-12),monthAt(0)),e=>e.status===400);

// Real collection stores new coverage with the existing request dates/counts,
// commits atomically and cannot promote a legacy prefix after the final page.
const token=`e30.${Buffer.from(JSON.stringify({acc:3,exp:4102444800})).toString('base64url')}.${'x'.repeat(100)}`;
let saved={id:'worker',shop_id:shop,...{date_from:period(first).dateFrom,date_to:period(first).dateTo},cursor_id:'0',row_count:0,
  summary:{pilot:{stage:'finance',finance_period:'weekly'}}},fail=false,calls=0;
const worker={from(table){assert.equal(table,'wb_api_preview_jobs');let update;const q={update(v){update=v;return q},eq(){return q},then(a,b){if(!fail)Object.assign(saved,update);return Promise.resolve({error:fail?{}:null}).then(a,b)}};return q},
  async rpc(name,args){
    if(name==='app_shop_section_enabled')return {data:true};
    if(name==='wb_api_read_key')return {data:token};
    if(name==='wb_api_claim_request'||name==='seed_cost_cards')return {data:0};
    if(name==='wb_api_commit_finance_page'){
      if(fail)return {error:{}};
      assert.equal(args.p_expected_cursor,saved.cursor_id);assert.equal(args.p_expected_rows,saved.row_count);
      Object.assign(saved,{finance_model:args.p_model,summary:args.p_summary,cursor_id:args.p_cursor,row_count:args.p_model.row_count,status:args.p_status});return {data:true};
    }
    throw Error('Unexpected RPC '+name);
  }};
const fetchFinance=async(_token,_url,body)=>{
  calls++;assert.deepEqual(body.fields,FINANCE_FIELDS);assert.equal(body.dateFrom,period(first).dateFrom);
  assert.equal(body.dateTo,period(first).dateTo+'T23:59:59');return [{...rows[0],rrdId:'1'}];
};
const before=structuredClone(saved);fail=true;
await assert.rejects(()=>processPage(worker,structuredClone(saved),shop,fetchFinance));assert.deepEqual(saved,before);
fail=false;await processPage(worker,structuredClone(saved),shop,fetchFinance);
assert.equal(saved.finance_model.unit.daily.covered_rows,1);assert.equal(saved.finance_model.unit.daily.cursor_id,'1');
await processPage(worker,structuredClone(saved),shop,async()=>{calls++;return []});assert.equal(calls,3);
assert.equal(saved.finance_model.unit.daily.history_complete,true);
delete saved.finance_model.unit.daily;
await processPage(worker,structuredClone(saved),shop,async()=>[]);
assert.equal(saved.finance_model.unit.daily.history_complete,false);
saved={...jobFixture(first),id:'ads-worker',status:'loading',summary:{pilot:{stage:'ads',finance_complete:true},api_sources:{}}};
const urls=[];
const fetchAds=async(_token,url)=>{urls.push(url);return url.includes('/upd?')?ad.debits:ad.stats};
await processCabinetSource(worker,structuredClone(saved),fetchAds);
await processCabinetSource(worker,structuredClone(saved),fetchAds);
assert.equal(saved.status,'complete');assert.equal(urls.length,2,'ordinary sync still uses one upd and one fullstats per batch');
assert.match(urls[0],new RegExp('from='+period(first).dateFrom+'&to='+period(first).dateTo));
assert.match(urls[1],new RegExp('beginDate='+period(first).dateFrom+'&endDate='+period(first).dateTo));
assert.ok(saved.summary.api_sources.article_ads.daily);assert.ok(saved.summary.api_sources.article_ads.campaigns[0].daily_stats);
console.log('Unit date ranges PASS: exact days/cross-month clipping, monthly legacy fast path, coverage/cursors/legacy resume, current seller prices, cash ads/bonuses/unknowns, undated common expenses, scoped reads, atomic worker commits and unchanged WB request count.');
