import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {aggregateFinanceRows, mergeFinanceModels, readCabinet, readCabinetTrend} from '../supabase/functions/wb-api/cabinet.ts';
import {apiMetrics} from '../supabase/functions/analyze-results/calculations.ts';

// Deliberately different amounts: seller's price, WB's realized amount and payout.
const rows = [
  {vendorCode:'SKU',sellerOperName:'Продажа',docTypeName:'Продажа',quantity:3,retailPriceWithDisc:'399.68',retailAmount:'1101.00',forPay:'1130.97'},
  {vendorCode:'SKU',sellerOperName:'Возврат',docTypeName:'Возврат',quantity:1,retailPriceWithDisc:'399.68',retailAmount:'367.00',forPay:'376.99'},
  {vendorCode:'SKU',sellerOperName:'Коррекция продаж',docTypeName:'Продажа',quantity:1,retailPriceWithDisc:'9999.00',retailAmount:0,forPay:'5.00'},
  {vendorCode:'SKU',sellerOperName:'Логистика',docTypeName:'Продажа',quantity:1,retailPriceWithDisc:'9999.00',deliveryService:'10.00'},
];
const model = aggregateFinanceRows(rows,'4');
assert.equal(model.totals.salesAmount,'799.36','buyouts use agreed unit price times bought units, less returns; not retailAmount/forPay');
assert.equal(model.totals.retailAmount,'734.00','keep upstream financial totals intact');
assert.equal(model.products[0].sales_revenue,'799.36');
assert.deepEqual(mergeFinanceModels(aggregateFinanceRows(rows.slice(0,2),'2'),aggregateFinanceRows(rows.slice(2),'4')),model,'page boundaries must not change the metric');
const absent = aggregateFinanceRows([{...rows[0],retailPriceWithDisc:undefined}],'1');
assert.equal(absent.totals.salesAmount,null,'missing price is not zero and must never fall back to WB realization or payout');
assert.equal(mergeFinanceModels(absent,aggregateFinanceRows(rows.slice(1),'4')).totals.salesAmount,null);
const legacy = structuredClone(model); delete legacy.sales_covered_rows; delete legacy.totals.salesAmount;
assert.equal(mergeFinanceModels(legacy,aggregateFinanceRows([],'4')).totals.salesAmount,null,'a partial new page cannot upgrade a legacy snapshot');
assert.equal(aggregateFinanceRows([]).totals.salesAmount,'0.00','completed empty report has a known zero');
assert.equal(aggregateFinanceRows([{...rows[0],quantity:2,retailPriceWithDisc:0}]).totals.salesAmount,'0.00','a free item is not missing data');
assert.equal(aggregateFinanceRows([{...rows[0],quantity:1.5}]).totals.salesAmount,null);

const shop = {id:'11111111-1111-4111-8111-111111111111',name:'Synthetic',tax_rate:5};
const job = {id:'synthetic-job',status:'complete',date_from:'2026-09-01',date_to:'2026-09-30',cursor_id:'4',row_count:4,finance_model:model,
  summary:{api_sources:{orders:{status:'downloaded',orders_amount:'2000.00',orders_count:4},internal_ads:{status:'downloaded',period_totals:{Баланс:{amount:'40.00'}}},media:{status:'downloaded',amount:'0.00',date_from:'2026-09-01',date_to:'2026-09-30'}}}};
const cabinet = await readCabinet({},shop.id,{dateFrom:job.date_from,dateTo:job.date_to},job.id,{shop,job,settings:[],costs:[{article:'SKU',cost_price:100}]});
assert.equal(cabinet.finance.salesAmount,'799.36');
assert.equal(cabinet.products[0].revenue,'799.36');
assert.equal(cabinet.economy.payout,'748.98','payout still uses WB finance, not gross buyouts');
assert.equal(cabinet.economy.tax,'39.97','configured percentage uses the same sales base as the dashboard');
assert.equal(cabinet.net_profit,'469.01');
assert.ok(Math.abs(cabinet.economy.drr_sales-40/799.36*100)<1e-9);
assert.equal(apiMetrics(cabinet).sales,799.36,'AI must use the same metric, not an old cached definition');
const historyAdmin={from(table){
  const value=table==='shops'?shop:table==='sku_costs'?[{article:'SKU',cost_price:100}]:table==='wb_api_preview_jobs'?[job]:[];
  const q={select(){return q;},eq(){return q;},gte(){return q;},order(){return q;},range(){return q;},single:async()=>({data:value}),then:(ok,bad)=>Promise.resolve({data:value,error:null}).then(ok,bad)};
  return q;
}};
assert.equal((await readCabinetTrend(historyAdmin,shop.id))[0].sales,799.36,'monthly chart must use seller-price buyouts too');

const window={matchMedia:()=>({matches:true})};
const document={createElement(){return{set innerHTML(html){this.content={firstChild:{html,querySelector(){return{};},addEventListener(){}}};}};}};
vm.runInNewContext(readFileSync(new URL('../assets/dashboard.js',import.meta.url),'utf8'),{window,document,Intl,Map,Date});
const d=window.WBDashboard.fromApiCabinet(cabinet);
assert.equal(d.rep.sales_amount,799.36);
assert.equal(d.rep.transfer_total,748.98);
assert.equal(d.skuRows[0].revenue,799.36);
assert.ok(Math.abs(d.rep.sales_amount-d.netProfit-d.expenses.reduce((sum,[,n])=>sum+n,0))<0.011);
const old=structuredClone(cabinet); delete old.finance.salesAmount;
assert.equal(window.WBDashboard.fromApiCabinet(old).rep.sales_amount,null,'legacy data must request a refresh, not display the wrong total');
const oldDerived=window.WBDashboard.fromApiCabinet(old), cards=[];
window.WBDashboard.renderKPI({innerHTML:'',appendChild:card=>cards.push(card)},oldDerived,null,'wildberries');
assert.match(cards[0].html,/Обновите месяц — нужны цены выкупов/);
assert.match(cards[0].html,/kpi-number">—/);
const oldCabinet=await readCabinet({},shop.id,{dateFrom:job.date_from,dateTo:job.date_to},job.id,{shop,job:{...job,finance_model:legacy},settings:[],costs:[{article:'SKU',cost_price:100}]});
assert.equal(oldCabinet.finance.salesAmount,null);
assert.equal(oldCabinet.economy.tax,null,'do not apply the configured tax to a different, fallback sales base');
assert.equal(oldCabinet.net_profit,null);
assert.equal(oldCabinet.economy.payout,cabinet.economy.payout);
assert.ok(oldCabinet.economy.missing.includes('Стоимость выкупленных товаров ещё не получена. Обновите месяц.'));
assert.equal(window.WBDashboard.combineTrend([[{year:2026,month:9,sales:799.36}],[{year:2026,month:9,sales:null}]])[0].sales,null,'a combined chart cannot disguise a missing marketplace value as zero');
vm.runInNewContext(readFileSync(new URL('../assets/period-range.js',import.meta.url),'utf8'),{window,Intl,Map,Date});
const range=window.WBRange.aggregate([{derived:d,marketplace:'wildberries'},{derived:oldDerived,marketplace:'wildberries'}]);
assert.equal(range.rep.sales_amount,null,'range totals require every month');
assert.equal(range.salesRefreshRequired,true);
console.log('WB buyout sales: seller price x units, returns, corrections, page merge, missing and legacy prices, cabinet, tax, DRR, SKU, AI and KPI passed.');
