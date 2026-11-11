import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {aggregateFinanceRows,mergeFinanceModels,adsSnapshot,readCabinet} from '../supabase/functions/wb-api/cabinet.ts';
import {aggregateDailyFinance,mergeDailyFinance,calculateDaily,allocateAmount,operationDay,readDaily} from '../supabase/functions/wb-api/daily.ts';
import {DAILY_SHOP_ID,DAILY_USER_ID,dailyAllowed,authorizeDaily} from '../supabase/functions/wb-api/daily-access.ts';
import {cents} from '../supabase/functions/wb-api/core.ts';
const period={dateFrom:'2026-10-01',dateTo:'2026-10-31'};
const rows=[
  {rrdId:'1',rrDate:'2026-10-01',vendorCode:'SKU',sellerOperName:'Продажа',docTypeName:'Продажа',quantity:3,retailPriceWithDisc:'999.99',retailAmount:'2200.00',forPay:'2100.00'},
  {rrdId:'2',rrDate:'2026-10-02',vendorCode:'sku',sellerOperName:'Возврат',docTypeName:'Возврат',quantity:1,retailPriceWithDisc:'999.99',retailAmount:'733.33',forPay:'700.00'},
  {rrdId:'3',rrDate:'2026-10-02',sellerOperName:'Логистика',deliveryService:'20.00',paidStorage:'2.00',paidAcceptance:'3.00',penalty:'4.00',additionalPayment:'1.00',cashbackAmount:'2.00',cashbackCommissionChange:'1.00',cashbackDiscount:'0.50'},
  {rrdId:'4',rrDate:'2026-10-03',sellerOperName:'Удержание',bonusTypeName:'WB Медиа',deduction:'50.00'},
  {rrdId:'5',rrDate:'2026-10-04',sellerOperName:'Удержание',bonusTypeName:'WB Продвижение',deduction:'30.00'},
  {rrdId:'6',rrDate:'2026-10-05',sellerOperName:'Удержание',bonusTypeName:'Другая услуга',deduction:'7.00'},
];
const advertisingRows=[
  {updTime:'2026-10-01T12:00:00+03:00',updSum:50,paymentType:'Баланс'},
  {updTime:'2026-10-02T12:00:00+03:00',updSum:10,paymentType:'Промобонусы'},
  {updTime:'2026-10-03T12:00:00+03:00',updSum:-5,paymentType:'Баланс'},
];
const ads=adsSnapshot(advertisingRows,period.dateFrom,period.dateTo,true);
assert.equal(ads.daily_totals['2026-10-03'].Баланс.amount,'-5.00');
assert.equal(adsSnapshot(advertisingRows,period.dateFrom,period.dateTo).daily_totals,undefined,'no new storage for shops outside the pilot');
async function fixture(input=rows,prices=[{article:'SKU',cost_price:100}],settings={operational_expenses:'100.01',external_promotion_expenses:'30.02'}) {
  const model=aggregateFinanceRows(input,String(input.length));
  const job={id:'test-job',status:'complete',date_from:period.dateFrom,date_to:period.dateTo,row_count:input.length,cursor_id:String(input.length),finance_model:model,
    summary:{pilot:{finance_complete:true},api_sources:{orders:{status:'downloaded',orders_amount:'5000.00',rows:[]},internal_ads:ads,media:{status:'downloaded',date_from:period.dateFrom,date_to:period.dateTo,amount:'0.00'}}}};
  const cabinet=await readCabinet({},DAILY_SHOP_ID,period,job.id,{shop:{id:DAILY_SHOP_ID,name:'Synthetic',tax_rate:5.5},job,settings:[{month:period.dateFrom,...settings}],costs:prices});
  const daily=aggregateDailyFinance(input,period,String(input.length));
  return {cabinet,daily};
}
assert.equal(operationDay('2026-10-01T22:00:00Z'),'2026-10-02');
assert.equal(operationDay('2026-10-01T00:00:00'),'2026-10-01');
assert.equal(operationDay('2026-02-30'),null);
assert.equal(operationDay(null),null);
assert.equal(dailyAllowed(DAILY_USER_ID,DAILY_SHOP_ID),true);
for(const [user,shop] of [['member',DAILY_SHOP_ID],[DAILY_USER_ID,'11111111-1111-4111-8111-111111111111'],['',DAILY_SHOP_ID]]) {
  assert.equal(dailyAllowed(user,shop),false);assert.throws(()=>authorizeDaily(user,shop),e=>e.status===403);
}
const f=await fixture(),result=calculateDaily(f.cabinet,f.daily,ads.daily_totals);
assert.equal(result.status,'ready');assert.equal(result.days.length,31);
assert.equal(result.monthly_profit,f.cabinet.net_profit);
assert.equal(result.days.reduce((n,d)=>n+cents(d.net_profit),0n),cents(f.cabinet.net_profit),'all daily profits add up to the actual monthly overview');
for(const day of result.days) {
  assert.equal(cents(day.sales)-day.expenses.reduce((n,e)=>n+cents(e.amount),0n),cents(day.net_profit),'every expense is deducted once, including loyalty/corrections/withheld ads');
}
assert.equal(result.days[1].cogs,'-100.00','returns restore cost at the same live price as the overview');
assert.equal(result.days[1].promo,'10.00','promotional credit stays reference-only');
assert.equal(result.days[2].media_ads,'50.00');
assert.equal(result.days[3].advertising_already_withheld,'30.00');
assert.equal(result.days.reduce((n,d)=>n+cents(d.operational_expenses),0n),10001n);
assert.equal(result.days.reduce((n,d)=>n+cents(d.external_promotion_expenses),0n),3002n);
assert.equal(result.days.reduce((n,d)=>n+cents(d.tax),0n),cents(f.cabinet.economy.tax),'tax rounding reconciles exactly in kopecks');

let merged=null;
for(let i=0;i<rows.length;i++)merged=mergeDailyFinance(merged,aggregateDailyFinance([rows[i]],period,String(i+1)));
assert.deepEqual(merged,f.daily,'pagination/retries do not change daily economics');
const legacy={...f.daily,row_count:1};
assert.equal(calculateDaily(f.cabinet,legacy,ads.daily_totals).status,'needs_preparation','partial daily coverage cannot be published as a complete month');
assert.equal(calculateDaily(f.cabinet,f.daily,null).status,'needs_preparation','missing advertising dates are not zero');
assert.throws(()=>calculateDaily(f.cabinet,f.daily,{}),e=>e.status===409,'advertising daily amounts must match monthly totals');
const unknownAdvertising=structuredClone(f.cabinet);unknownAdvertising.net_profit=null;unknownAdvertising.sources.ads.undated=1;
assert.throws(()=>calculateDaily(unknownAdvertising,f.daily,ads.daily_totals),/без даты/,'undated ads must not become known daily/monthly profit');
const missing=await fixture(rows,[]),unknown=calculateDaily(missing.cabinet,missing.daily,ads.daily_totals);
assert.equal(unknown.monthly_profit,null);assert.equal(unknown.days[0].net_profit,null);assert.equal(unknown.days[0].cumulative_profit,null);
assert.equal(unknown.days[4].cumulative_profit,null,'cumulative chart must not bridge unknown days');
const withoutDates=await fixture(rows.map(row=>({...row,rrDate:undefined,saleDt:'2026-10-01'})));
const undated=calculateDaily(withoutDates.cabinet,withoutDates.daily,ads.daily_totals);
assert.ok(undated.unallocated);assert.equal(undated.unallocated.rows,6,'sale date must not silently replace operation date');
assert.equal(undated.monthly_profit,withoutDates.cabinet.net_profit);

for(const value of ['100.01','0.00','-0.17'])for(const length of [1,11,28,31])assert.equal([...allocateAmount(value,Array.from({length},(_,i)=>String(i))).values()].reduce((n,v)=>n+v,0n),cents(value));
const repeated=Array.from({length:50000},(_,i)=>({...rows[0],rrdId:String(i+1),rrDate:`2026-10-${String(i%31+1).padStart(2,'0')}`}));
const compact=aggregateDailyFinance(repeated,period,'50000');
assert.ok(JSON.stringify(compact).length<35000,'daily storage grows with days/SKUs, not operations');
assert.doesNotMatch(JSON.stringify(compact),/rrdId|saleDt|retailPriceWithDisc/,'never persist raw financial operations');
const handler=readFileSync(new URL('../supabase/functions/wb-api/index.ts',import.meta.url),'utf8');
assert.ok(handler.indexOf('authorizeDaily(auth.user.id,shopId)')>handler.indexOf('await authorizeShop('));
const reads=[];
const reader={from(table){
  assert.notEqual(table,'wb_api_preview_rows','daily reading never reopens raw operations');
  let columns='';const filters={};
  const job={id:'test-job',status:'complete',date_from:period.dateFrom,date_to:period.dateTo,row_count:rows.length,cursor_id:String(rows.length),finance_model:aggregateFinanceRows(rows,String(rows.length)),
    summary:{pilot:{finance_complete:true},api_sources:{orders:{status:'downloaded',orders_amount:'5000.00'},internal_ads:ads,media:{status:'downloaded',date_from:period.dateFrom,date_to:period.dateTo,amount:'0.00'}}}};
  const settings=[{month:period.dateFrom,operational_expenses:'100.01',external_promotion_expenses:'30.02'}];
  const value=()=>table==='shops'?{id:DAILY_SHOP_ID,tax_rate:5.5}:table==='sku_costs'?[{article:'SKU',cost_price:100}]:table==='wb_api_month_settings'?settings:columns.includes('daily:')?{cursor_id:job.cursor_id,daily:f.daily,ads_daily:ads.daily_totals}:[job];
  const run=()=>{reads.push({table,filters:{...filters},columns});return {data:value(),error:null};};
  const q={select(c){columns=c;return q;},eq(k,v){filters[k]=v;return q;},order(){return q;},limit(){return q;},range(){return q;},
    single:async()=>run(),then:(a,b)=>Promise.resolve(run()).then(a,b)};return q;
}};
const response=await readDaily(reader,DAILY_SHOP_ID,period);
assert.equal(response.status,'ready');assert.equal(response.monthly_profit,f.cabinet.net_profit);
assert.ok(reads.every(r=>r.table==='shops'?r.filters.id===DAILY_SHOP_ID:r.filters.shop_id===DAILY_SHOP_ID));
assert.equal(reads.find(r=>r.columns.includes('daily:')).filters.id,'test-job','read daily aggregates from the SAME completed snapshot as the monthly overview');
console.log('Daily profit: PASS (private gate, all expenses once, returns, day/month equality, tax, ads dates, unknowns, pagination, Moscow dates, allocation, bounded storage).');
