import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {aggregateUnitFinance,mergeUnitFinance,calculateUnit,unitMonths,readUnit} from '../supabase/functions/wb-api/unit.ts';
import {aggregateFinanceRows,readCabinet,adsSnapshot} from '../supabase/functions/wb-api/cabinet.ts';
import {DAILY_SHOP_ID} from '../supabase/functions/wb-api/daily-access.ts';
import {cents} from '../supabase/functions/wb-api/core.ts';
const period={dateFrom:'2026-10-01',dateTo:'2026-10-31'};
const rows=[
 {vendorCode:' A ',title:'Товар A',sellerOperName:'Продажа',docTypeName:'Продажа',quantity:2,retailPriceWithDisc:100,forPay:160,deliveryService:10},
 {vendorCode:'a',sellerOperName:'Возврат',docTypeName:'Возврат',quantity:1,retailPriceWithDisc:100,forPay:80,deliveryService:3},
 {vendorCode:'B',title:'Товар B',sellerOperName:'Продажа',docTypeName:'Продажа',quantity:3,retailPriceWithDisc:200,forPay:450,paidStorage:2,paidAcceptance:3,penalty:1,additionalPayment:2,cashbackAmount:3,cashbackCommissionChange:1,cashbackDiscount:0.5},
 {vendorCode:'B',sellerOperName:'Удержание',bonusTypeName:'WB Медиа',deduction:15},
 {vendorCode:'B',sellerOperName:'Удержание',bonusTypeName:'WB Продвижение',deduction:5},
 {sellerOperName:'Удержание',bonusTypeName:'WB Медиа',deduction:40},
 {nmId:0,sellerOperName:'Хранение',paidStorage:7},
];
async function fixture(prices=[{article:'a',cost_price:20},{article:'B',cost_price:40}],input=rows){
 const model=aggregateFinanceRows(input,'99');
 const job={id:'unit-job',status:'complete',date_from:period.dateFrom,date_to:period.dateTo,row_count:input.length,cursor_id:'99',finance_model:model,
 summary:{pilot:{finance_complete:true},api_sources:{orders:{status:'downloaded',orders_amount:'800',rows:[]},internal_ads:adsSnapshot([{updTime:'2026-10-01T10:00:00+03:00',paymentType:'Баланс',updSum:30},{updTime:'2026-10-02T10:00:00+03:00',paymentType:'Промобонусы',updSum:10}],period.dateFrom,period.dateTo),media:{status:'downloaded',date_from:period.dateFrom,date_to:period.dateTo,amount:'0'}}}};
 const cabinet=await readCabinet({},DAILY_SHOP_ID,period,job.id,{shop:{id:DAILY_SHOP_ID,name:'Synthetic',tax_rate:6},job,settings:[{month:period.dateFrom,operational_expenses:'100',external_promotion_expenses:'50'}],costs:prices});
 return {cabinet,job,unit:aggregateUnitFinance(input,'99')};
}
const f=await fixture(),r=calculateUnit(f.cabinet,f.unit);
assert.equal(r.status,'ready');assert.equal(r.products.length,2,'case and whitespace are one article; nmId0 stays shared');
const a=r.products.find(p=>p.article.trim().toLowerCase()==='a'),b=r.products.find(p=>p.article==='B');
assert.equal(a.sales,'100.00');assert.equal(a.quantity,1);assert.equal(a.net_profit,'41.00');
assert.equal(a.expenses.find(e=>e.key==='cogs').amount,'20.00','returns restore cost');
assert.equal(b.expenses.find(e=>e.key==='media').amount,'15.00');assert.equal(b.expenses.find(e=>e.key==='internal').amount,'5.00');
assert.equal(b.net_profit,'262.50');
for(const p of r.products){
 assert.equal(cents(p.sales)-p.expenses.reduce((n,e)=>n+cents(e.amount),0n),cents(p.net_profit));
 assert.equal(cents(p.total_expenses),p.expenses.reduce((n,e)=>n+cents(e.amount),0n));
 assert.equal(p.margin,Number(p.net_profit)/Number(p.sales)*100);
 assert.equal(p.profitability,Number(p.net_profit)/Number(p.total_expenses)*100);
 assert.ok(p.expenses.every(e=>!['operating','external','ads_difference'].includes(e.key)));
}
assert.equal(r.common_expenses.find(e=>e.key==='operating').amount,'100.00');
assert.equal(r.common_expenses.find(e=>e.key==='ads_difference').amount,'25.00','actual30 + media55 - all withheld60 =25, never charged to products');
assert.equal(r.common_expenses.find(e=>e.key==='storage').amount,'7.00');
const missing=calculateUnit((await fixture([])).cabinet,f.unit);assert.equal(missing.products[0].net_profit,null);assert.equal(missing.totals.net_profit,null);
const changed=structuredClone(f.cabinet);changed.settings.operational_expenses='9999';changed.settings.external_promotion_expenses='8888';changed.economy.internal_ads='777';
assert.deepEqual(calculateUnit(changed,f.unit).products,r.products,'shop expenses and unassigned advertising never affect article results');
const negative=structuredClone(f.cabinet);negative.economy.internal_ads='0.00';negative.sources.media.amount='0.00';
assert.equal(calculateUnit(negative,f.unit).common_expenses.find(e=>e.key==='ads_difference').amount,'-60.00','shared source adjustment keeps its sign rather than erasing direct financial advertising');
const returnsOnly=await fixture([{article:'a',cost_price:20}],[rows[1]]);
const returned=calculateUnit(returnsOnly.cabinet,returnsOnly.unit).products[0];
assert.equal(returned.quantity,-1);assert.equal(returned.margin,null);assert.equal(returned.profitability,null,'negative sales/expense denominators do not fabricate ratios');
const zeroSales=await fixture([{article:'a',cost_price:20}],[{vendorCode:'A',sellerOperName:'Логистика',deliveryService:10}]);
assert.equal(calculateUnit(zeroSales.cabinet,zeroSales.unit).products[0].net_profit,'-10.00','a SKU with costs and no sales remains in the result');
assert.equal(calculateUnit(f.cabinet,{...f.unit,row_count:2}).status,'needs_preparation');
const bad=structuredClone(f.unit);bad.buckets[0].totals.deliveryService='0';assert.throws(()=>calculateUnit(f.cabinet,bad),/не совпали/);
let merged=null;for(const row of rows)merged=mergeUnitFinance(merged,aggregateUnitFinance([row],'99'));
assert.deepEqual(merged,f.unit,'pagination preserves exact category amounts, names, cases and quantities');
const compact=aggregateUnitFinance(Array.from({length:50000},()=>rows[0]));assert.ok(JSON.stringify(compact).length<2500);assert.doesNotMatch(JSON.stringify(compact),/rrdId|retailPriceWithDisc|sellerOperName/);
assert.deepEqual(unitMonths('2026-09','2026-11'),['2026-09','2026-10','2026-11']);assert.throws(()=>unitMonths('2026-11','2026-09'),/Начало/);assert.throws(()=>unitMonths('2027-01','2027-01'));
const handler=readFileSync(new URL('../supabase/functions/wb-api/index.ts',import.meta.url),'utf8');
assert.match(handler,/\['daily','daily_start','unit'\]/);assert.ok(handler.indexOf('authorizeDaily(auth.user.id,shopId)')<handler.indexOf("if(body.action==='unit')"));
const reads=[];
const admin={from(table){let columns='',limit;const filters={};
 const jobs=['2026-10','2026-11'].map(month=>({...f.job,id:'unit-'+month,date_from:month+'-01',date_to:month==='2026-10'?'2026-10-31':'2026-11-11',finance_model:{...f.job.finance_model,unit:f.unit}}));
 const tables={shops:[{id:DAILY_SHOP_ID,name:'Synthetic',tax_rate:6}],sku_costs:[{shop_id:DAILY_SHOP_ID,article:'a',cost_price:20},{shop_id:DAILY_SHOP_ID,article:'B',cost_price:40}],wb_api_month_settings:['2026-10','2026-11'].map(month=>({shop_id:DAILY_SHOP_ID,month:month+'-01',operational_expenses:'100',external_promotion_expenses:'50'})),wb_api_preview_jobs:jobs.map(j=>({...j,shop_id:DAILY_SHOP_ID}))};
 const run=single=>{reads.push({table,columns,filters:{...filters}});let data=tables[table].filter(p=>Object.entries(filters).every(([k,v])=>p[k]===v)).slice(0,limit);
  if(columns.includes('unit:'))data=data.map(j=>({cursor_id:j.cursor_id,unit:j.finance_model.unit}));return {data:single?data[0]:data,error:null};};
 const q={select(c){columns=c;return q;},eq(k,v){filters[k]=v;return q;},order(){return q;},limit(n){limit=n;return q;},range(){return q;},single:async()=>run(true),then:(a,b)=>Promise.resolve(run(false)).then(a,b)};return q;}};
const range=await readUnit(admin,DAILY_SHOP_ID,'2026-10','2026-11');
assert.equal(range.status,'ready');assert.equal(range.products.length,2);assert.equal(cents(range.totals.net_profit),2n*cents(r.totals.net_profit));
assert.equal(reads.filter(r=>r.table==='sku_costs').length,1,'one shared paginated cost catalogue for the entire month range');
assert.ok(reads.every(r=>r.table==='shops'?r.filters.id===DAILY_SHOP_ID:r.filters.shop_id===DAILY_SHOP_ID));
assert.ok(reads.filter(r=>r.columns.includes('unit:')).every(r=>r.filters.id?.startsWith('unit-')),'unit uses the same completed snapshot as cabinet, scoped by shop and id');
console.log('Unit economics PASS: direct costs only, common expenses excluded, all expense categories, returns, tax, case-insensitive products, coverage, bounded storage and private authorization.');
