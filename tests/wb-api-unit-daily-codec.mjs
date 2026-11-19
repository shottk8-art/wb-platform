import assert from 'node:assert/strict';
import {aggregateUnitFinance,mergeUnitFinance,decodeUnitDaily,clipUnitFinance,
  UNIT_DAILY_CODEC,UNIT_DAILY_SCHEMA,UNIT_DAILY_MONEY_FIELDS} from '../supabase/functions/wb-api/unit.ts';
import {aggregateFinanceRows} from '../supabase/functions/wb-api/cabinet.ts';

const period={dateFrom:'2026-09-01',dateTo:'2026-09-30'},range={dateFrom:'2026-09-02',dateTo:'2026-09-03'};
const rows=[
  {rrDate:'2026-09-01',vendorCode:' A ',title:'Месячное название',sellerOperName:'Продажа',docTypeName:'Продажа',quantity:2,
    retailPriceWithDisc:100,retailAmount:150,forPay:160,deliveryService:10,paidStorage:1,paidAcceptance:2,penalty:3,
    deduction:5,additionalPayment:1,cashbackAmount:2,cashbackDiscount:0.5,cashbackCommissionChange:0.25},
  {rrDate:'2026-09-02',vendorCode:'a',title:'Дневное название не хранится',sellerOperName:'Возврат',docTypeName:'Возврат',quantity:1,
    retailPriceWithDisc:100,retailAmount:75,forPay:80,deliveryService:1,additionalPayment:-1},
  {rrDate:'2026-09-02',vendorCode:'B',sellerOperName:'Продажа',docTypeName:'Продажа',quantity:4,retailPriceWithDisc:200,forPay:620},
  {rrDate:'2026-09-03',vendorCode:'B',sellerOperName:'Удержание',bonusTypeName:'WB Продвижение',deduction:11},
  {rrDate:'2026-09-03',sellerOperName:'Удержание',bonusTypeName:'WB Медиа',deduction:7},
  {rrDate:'2026-09-03',sellerOperName:'Хранение',paidStorage:9},
  {rrDate:'2026-09-04',vendorCode:'A',sellerOperName:'Продажа',docTypeName:'Продажа',quantity:1,forPay:10},
];
const unit=aggregateUnitFinance(rows,'7'),original=structuredClone(unit),decoded=decodeUnitDaily(unit);
assert.ok(decoded);assert.equal(unit.daily.version,2);assert.equal(unit.daily.codec,UNIT_DAILY_CODEC);
assert.deepEqual(unit.daily.schema,UNIT_DAILY_SCHEMA);assert.deepEqual(unit.daily.money_fields,UNIT_DAILY_MONEY_FIELDS);
assert.deepEqual(UNIT_DAILY_MONEY_FIELDS,Object.keys(aggregateFinanceRows([]).totals),'stored manifest covers every current financial category');
assert.equal(decoded.buckets.length,6);
assert.ok(unit.daily.buckets.every(b=>b.length===5 && typeof b[1]==='string'));
assert.doesNotMatch(JSON.stringify(unit.daily),/"name"|"article"|Месячное|Дневное/);
for(const b of unit.daily.buckets)for(const value of Object.values(b[4]))assert.ok(value===null || value!=='0.00','known zeros are omitted');
const unknown=unit.daily.buckets.find(b=>b[0]==='2026-09-04');
assert.equal(unknown[4][UNIT_DAILY_MONEY_FIELDS.indexOf('salesAmount')],null,'unknown seller price has an explicit persisted null');
assert.equal(decoded.buckets.find(b=>b.day==='2026-09-04').totals.salesAmount,null);
assert.equal(decoded.buckets.find(b=>b.day==='2026-09-04').totals.penalty,'0.00','only the codec manifest authorizes zero defaults');
assert.equal(decoded.buckets.find(b=>b.day==='2026-09-02' && b.key==='a').name,'Месячное название');
assert.equal(decoded.buckets.find(b=>b.day==='2026-09-02' && b.key==='a').quantity,-1);
assert.deepEqual(unit,original,'decode never mutates the compact or monthly source');

function legacy(source) {
  const copy=structuredClone(source),full=decodeUnitDaily(source);assert.ok(full);
  const {codec,schema,money_fields,...daily}=full;
  copy.daily={...daily,version:1};return copy;
}
const old=legacy(unit),clipped=clipUnitFinance(unit,period,range);
assert.ok(clipped);assert.deepEqual(clipUnitFinance(old,period,range),clipped,'all legacy monetary categories decode exactly');
assert.equal(clipped.buckets.find(b=>b.key==='a').totals.salesAmount,'-100.00');
assert.equal(clipped.buckets.find(b=>b.key==='b').totals.salesAmount,'800.00');
assert.equal(clipUnitFinance(unit,period,{dateFrom:'2026-09-04',dateTo:'2026-09-04'}).buckets[0].totals.salesAmount,null);
assert.deepEqual(unit.buckets,old.buckets,'monthly unit v1 data is never recoded');

for(const prefixLegacy of [false,true])for(const pageLegacy of [false,true]) {
  const before=aggregateUnitFinance(rows.slice(0,3),'3'),page=aggregateUnitFinance(rows.slice(3),'7');
  const merged=mergeUnitFinance(prefixLegacy?legacy(before):before,pageLegacy?legacy(page):page,{cursor_id:'3',row_count:3});
  assert.deepEqual(merged,unit,'every legacy/sparse page combination persists the same canonical compact model');
  assert.deepEqual(clipUnitFinance(merged,period,range),clipped);
}
const refreshed=mergeUnitFinance(old,aggregateUnitFinance([],'7'),{cursor_id:'7',row_count:rows.length});
assert.deepEqual(refreshed,unit,'a validated full legacy prefix upgrades without re-reading WB');
const missingPrefix=aggregateUnitFinance(rows.slice(0,3),'3');delete missingPrefix.daily;
const incomplete=mergeUnitFinance(missingPrefix,aggregateUnitFinance(rows.slice(3),'7'),{cursor_id:'3',row_count:3});
assert.equal(incomplete.daily.history_complete,false);assert.equal(clipUnitFinance(incomplete,period,range),null);
assert.equal(mergeUnitFinance(incomplete,aggregateUnitFinance([],'7'),{cursor_id:'7',row_count:rows.length}).daily.history_complete,false);

// Sparse defaults are forbidden for unknown/missing codecs/manifests, and
// legacy full buckets cannot silently inherit sparse zero semantics.
const mutations=[
  u=>{delete u.daily.codec},u=>{u.daily.codec='future'},u=>{delete u.daily.schema},u=>{u.daily.schema.reverse()},
  u=>{delete u.daily.schema[0]},u=>{delete u.daily.money_fields[0]},
  u=>{delete u.daily.money_fields},u=>{u.daily.money_fields.pop()},u=>{u.daily.money_fields.reverse()},
  u=>{u.daily.money_fields[1]=u.daily.money_fields[0]},u=>{u.daily.money_fields.push('unknown')},
  u=>{u.daily.buckets[0][4]['99']='1.00'},u=>{u.daily.buckets[0][4]['01']='1.00'},
  u=>{u.daily.buckets[0][4]['0']=0},u=>{u.daily.buckets[0][4]['0']='bad'},
  u=>{u.daily.buckets[0][4]['0']=null},u=>{u.daily.buckets[0][4]=[]},
  u=>{u.daily.buckets[0].push('unexpected')},u=>{u.daily.buckets[0][1]='missing-sku'},
  u=>{u.daily.buckets[0][2]++},u=>{u.daily.buckets[0][3]++},
  u=>{u.daily.buckets[0][0]='2026-09-31'},u=>{u.daily.buckets.push(structuredClone(u.daily.buckets[0]))},
  u=>{u.daily.cursor_id='6'},u=>{u.daily.row_count--},u=>{u.daily.covered_rows--},u=>{u.daily.history_complete=false},
  u=>{delete u.daily.buckets[0][4][UNIT_DAILY_MONEY_FIELDS.indexOf('forPay')]},
  u=>{u.buckets[0].quantity++},u=>{u.buckets[0].key='mismatched-key'},
  u=>{u.daily=legacy(u).daily;delete u.daily.buckets[0].totals.penalty},
];
for(const mutate of mutations) {
  const broken=structuredClone(unit);mutate(broken);
  assert.equal(clipUnitFinance(broken,period,range),null,'corruption must not become a ready date range');
}
for(const mutate of [u=>{delete u.daily.money_fields},u=>{u.daily.cursor_id='6'},u=>{u.daily.history_complete=false},
  u=>{u.daily=legacy(u).daily;delete u.daily.buckets[0].totals.penalty}]) {
  const broken=structuredClone(unit);mutate(broken);
  const resumed=mergeUnitFinance(broken,aggregateUnitFinance([],'7'),{cursor_id:'7',row_count:rows.length});
  assert.equal(resumed.daily.history_complete,false,'invalid legacy/sparse coverage remains incomplete after an empty final page');
  assert.equal(clipUnitFinance(resumed,period,range),null);
}
const empty=aggregateUnitFinance([],'0');assert.ok(clipUnitFinance(empty,period,range));
delete empty.daily.money_fields;assert.equal(clipUnitFinance(empty,period,range),null,'even an empty sparse cache needs its exact manifest');
const undated=aggregateUnitFinance([{...rows[0],rrDate:undefined}],'1');
assert.equal(undated.daily.covered_rows,0);assert.equal(clipUnitFinance(undated,period,range),null);
console.log('Unit daily codec PASS: sparse known zeros, exact schema/field coverage, explicit unknown sales, monthly metadata, every category/quantity/cursor, legacy upgrades, mixed pagination and incomplete-prefix safety.');
