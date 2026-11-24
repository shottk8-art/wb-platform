const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {create}=require('../assets/demo-model.js');
const fixed=new Date('2026-11-24T12:00:00Z'),sample=create(fixed),window={addEventListener(){}};
const context=vm.createContext({window,Intl,Map,Set,Date});
for(const file of ['assets/dashboard.js','assets/period-range.js'])vm.runInContext(fs.readFileSync(file,'utf8'),context);
const dashboard=window.WBDashboard,cents=n=>Math.round(Number(n)*100),sum=(rows,k)=>rows.reduce((n,r)=>n+Number(r[k]||0),0);
function derived(m,marketplace){const r=sample.month(m,marketplace);return dashboard.computeDerived(r.report,r.skus,sample.state.costs,sample.state.taxRate);}
assert.equal(sample.current,'2026-11');assert.equal(sample.available().length,12);
assert.equal(sample.key(sample.available()[0]),'2025-12');assert.equal(sample.key(sample.available().at(-1)),'2026-11');
assert.equal(dashboard.defaultPeriodValue(sample.available().slice().reverse(),fixed),'2026-10');
assert.equal(create(new Date('2026-01-01T00:00:00Z')).current,'2026-01');
assert.equal(create(new Date('2026-02-28T22:00:00Z')).current,'2026-03','Moscow date boundary');
for(const marketplace of ['wildberries','ozon'])for(const p of sample.available()){
  const m=sample.key(p),row=sample.month(m,marketplace),d=derived(m,marketplace),daily=sample.daily(m,marketplace),unit=sample.unit(m+'-01',sample.end(m),marketplace);
  assert.equal(cents(d.rep.sales_amount),sum(row.skus,'revenue')*100);
  assert.equal(d.rep.bought_qty,sum(row.skus,'bought_qty'));
  assert.equal(cents(d.rep.transfer_total),cents(d.rep.transfer_goods)-row.totals.logistics-row.totals.storage-row.totals.acceptance);
  assert.equal(cents(daily.monthly_profit),cents(d.netProfit)+cents(d.manualExpenses),'daily excludes manual monthly expenses');
  assert.equal(cents(sum(daily.days,'net_profit')),cents(daily.monthly_profit));
  assert.equal(cents(daily.days.at(-1).cumulative_profit),cents(daily.monthly_profit));
  assert.equal(cents(unit.totals.sales),cents(d.rep.sales_amount));
  assert.equal(cents(unit.totals.net_profit)-row.totals.media,cents(daily.monthly_profit),'unit includes direct costs only');
  for(const product of unit.products){assert.equal(cents(product.sales)-cents(sum(product.expenses,'amount')),cents(product.net_profit));assert.equal(product.drr,Number(product.internal_ads)/Number(product.sales)*100);}
  if(!row.partial){assert.equal(cents(unit.totals.net_profit)-cents(sum(unit.common_expenses,'amount')),cents(d.netProfit));}
  assert.equal(daily.period.dateTo,sample.end(m));assert.equal(row.days.length,Number(sample.end(m).slice(-2)));
  assert.equal(daily.days.every(day=>day.expenses.every(e=>Number.isFinite(Number(e.amount)))),true);
}
const aggregate=window.WBRange.aggregate(['wildberries','ozon'].map(marketplace=>({marketplace,derived:derived('2026-10',marketplace)})));
assert.equal(cents(aggregate.netProfit),cents(derived('2026-10','wildberries').netProfit)+cents(derived('2026-10','ozon').netProfit));assert.equal(aggregate.rates.drrOrders,null);
const from='2026-09-27',to='2026-10-05',unit=sample.unit(from,to);
const actual=['2026-09','2026-10'].flatMap(m=>sample.month(m).days.filter(d=>d.date>=from&&d.date<=to));
assert.equal(cents(unit.totals.sales),sum(actual,'sales'));assert.equal(cents(unit.totals.net_profit),actual.flatMap(d=>d.entries).reduce((n,e)=>n+e.profit,0));
assert.equal(unit.totals.margin,Number(unit.totals.net_profit)/Number(unit.totals.sales)*100);assert(unit.common_expenses.slice(1).every(e=>e.amount===null&&e.excluded));
const old=derived('2026-10','ozon'),qty=old.skuRows.find(p=>p.article==='serum').bought_qty;
sample.setCost('serum',320.01);assert.equal(cents(old.netProfit)-cents(derived('2026-10','ozon').netProfit),qty*1001);
assert.equal(sample.unit('2026-10-01','2026-10-31','ozon').products.find(p=>p.article==='serum').cost_price,320.01);
sample.setCost('serum',0);assert.equal(sample.unit('2026-10-01','2026-10-31').products.find(p=>p.article==='serum').missing_costs,false);
assert.throws(()=>sample.setCost('serum',-1));assert.throws(()=>sample.setCost('unknown',100));assert.throws(()=>sample.setTax(6.1));
sample.setTax(7);assert.equal(cents(derived('2026-10','wildberries').tax),Math.round(sample.month('2026-10').totals.sales*.07));
sample.setManual('2026-10','wildberries',100,200);assert.equal(derived('2026-10','wildberries').manualExpenses,300);
sample.state.removedReports.add('2026-10');assert(!sample.available('ozon').some(p=>p.month===10&&p.year===2026));assert.equal(sample.daily('2026-10','ozon').status,'needs_import');assert.equal(sample.unit('2026-10-01','2026-10-15','ozon').status,'needs_import');assert.equal(sample.daily('2026-10','wildberries').status,'ready');
sample.state.removedReports.delete('2026-10');assert.equal(sample.unit('2026-10-01','2026-10-15','ozon').status,'ready');
const stock=sample.stocks();assert.equal(stock.inventory.demand.days,31);assert.equal(stock.inventory.totals.products,5);assert.equal(stock.inventory.totals.quantity,sum(stock.inventory.products.filter(p=>!p.excluded),'quantity'));
for(const p of stock.inventory.products){assert.equal(p.quantity,sum(p.warehouses,'quantity'));assert.equal(p.daily_orders,p.orders/31);assert.equal(p.recommended,Math.max(0,Math.ceil(p.daily_orders*30-p.quantity)));}
assert(stock.inventory.products.some(p=>p.status==='out'));assert(stock.inventory.products.some(p=>p.status==='low'));assert(stock.inventory.products.some(p=>p.status==='ok'));
const promo=sample.promos('2026-10-01','2026-10-31');assert.equal(promo.totals.sales,sum(promo.rows,'sales'));assert.equal(promo.totals.quantity,sum(promo.rows,'quantity'));assert(promo.rows.every(p=>p.net===p.sales-p.returns&&p.net>=0));assert.equal(promo.totals.active,4);
const empty=sample.promos('2027-01-01','2027-01-05');assert.equal(empty.totals.sales,0);
const html=fs.readFileSync('demo.html','utf8');assert(!/supabase|config\.js|auth\.js|wb-api\.js|analysis\.js/.test(html));
for(const section of ['overview','daily','stocks','promos','reports','costs','settings'])assert(html.includes(`data-view="${section}"`));
assert(!/test-subscription|client-start|onboarding|тариф|оплат/i.test(html));
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length,'unique document IDs');
assert(html.includes('id="demoPromoRangeValue"'));assert(!ids.includes('demoPromoRangeFrom'),'calendar inputs must not collide with source fields');
for(const file of ['assets/demo-model.js','assets/demo-provider.js','assets/demo.js','assets/demo-promos.js'])assert(!/\bfetch\s*\(|supabase|\.rpc\s*\(|localStorage|sessionStorage|sendMessage/.test(fs.readFileSync(file,'utf8')),file+' must remain local and synthetic');
(async()=>{
  const demoWindow={WBDemoModel:{create:()=>create(fixed)}},adapterContext=vm.createContext({window:demoWindow,structuredClone,setTimeout:fn=>fn()});
  vm.runInContext(fs.readFileSync('assets/demo-provider.js','utf8'),adapterContext);
  const api=demoWindow.WBApi;assert.equal(demoWindow.WBAccess.allowed('real-user','daily'),false);assert.equal(demoWindow.WBAccess.allowed('demo-visitor','daily'),true);
  const result=await api.cabinet('daily','2026-10');result.days[0].net_profit='forged';assert.notEqual((await api.cabinet('daily','2026-10')).days[0].net_profit,'forged');
  await api.cabinet('stocks_tracking',undefined,false,{nm_id:'90000001',excluded:true});assert((await api.cabinet('stocks')).inventory.products[0].excluded);
  await api.cabinet('stocks_settings',undefined,false,{alert_days:20,target_days:365});assert.equal((await api.cabinet('stocks')).settings.target_days,365);
  await assert.rejects(()=>api.cabinet('stocks_settings',undefined,false,{alert_days:30,target_days:10}));await assert.rejects(()=>api.cabinet('unknown'));
  const months=await api.cabinet('ozon_months');assert.equal(months.months[0],'2026-11');
  console.log('Demo workspace PASS: 24 marketplace-month ledgers, exact-day ranges, shared costs/tax, report restore, stocks, promos and isolated local adapter');
})().catch(error=>{console.error(error);process.exitCode=1;});
