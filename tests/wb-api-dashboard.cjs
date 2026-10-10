const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const window={matchMedia:()=>({matches:true})};
const document={createElement(){return{set innerHTML(html){this.content={firstChild:{html,querySelector(){return{textContent:'',isConnected:true};},addEventListener(){}}};}};}};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../assets/dashboard.js'),'utf8'),{window,document,Intl,Map,Date});
const api=window.WBDashboard;
const cabinet={complete:true,net_profit:'792508.25',cogs:'696198.00',settings:{operational_expenses:'0',external_promotion_expenses:'0'},
  finance:{retailAmount:'2231707.63',forPay:'2096453.30',bought_qty:1455,deliveryService:'238987.73',paidStorage:'70.09',paidAcceptance:'4030',penalty:'6642.80',deduction:'23440',additionalPayment:'0',cashbackAmount:'20',cashbackCommissionChange:'569.02',cashbackDiscount:'4150.97',advertisingDeductions:'0'},
  sources:{orders:{amount:'3583156.00'},media:{status:'confirmed_by_user',amount:'0'}},
  economy:{payout:'1826844.63',tax:'111585.38',internal_ads:'226553.00',promo:'77511',advertising_total:'226553',drr_orders:6.322,drr_sales:10.151,missing:[]},
  products:[{article:'SKU',name:'Название',revenue:'1000',for_pay:'800',bought_qty:2,cost_price:'100'}]};
const d=api.fromApiCabinet(cabinet);
assert.equal(d.netProfit,792508.25,'server-rounded profit is preserved, not recomputed with file formula');
assert.equal(d.tax,111585.38);
assert.equal(d.rep.transfer_total,1826844.63);
assert.equal(d.rep.bought_qty,1455);
assert.equal(d.rep.ads_spend,226553);
assert.equal(d.rep.ads_promo_spend,77511);
assert.equal(d.rep.wb_media_spend,0);
assert.equal(d.skuRows[0].revenue,1000,'SKU revenue is financial retail sales, never payout');
assert.equal(d.skuRows[0].profit,800,'gross profit remains revenue minus COGS');
assert.equal(d.skuRows[0].abc,'A');
const signedExpenses=d.expenses.reduce((sum,[,value])=>sum+value,0);
assert.ok(Math.abs(cabinet.finance.retailAmount-d.netProfit-signedExpenses)<0.011,'all signed expenses and compensation reconcile to sales minus net profit');
const rows=[];api.renderKPI({innerHTML:'',appendChild:card=>rows.push(card)},d,null,'wildberries');
assert.equal(rows.length,9,'incumbent KPI count, not expanded API metric grid');
assert.ok(rows.some(row=>row.html.includes('kpi--hero')));
const missing=structuredClone(cabinet);missing.net_profit=null;missing.cogs=null;missing.sources.media.amount=null;missing.economy.advertising_total=null;missing.economy.drr_orders=missing.economy.drr_sales=null;missing.products[0].cost_price=null;
const unknown=api.fromApiCabinet(missing);
assert.equal(unknown.netProfit,null);assert.equal(unknown.rep.wb_media_spend,null);assert.equal(unknown.cogs,null);assert.equal(unknown.rates.drrOrders,null);assert.equal(unknown.skuRows[0].profit,null);
const unknownRows=[];api.renderKPI({innerHTML:'',appendChild:card=>unknownRows.push(card)},unknown,null,'wildberries');
assert.ok(unknownRows.find(row=>row.html.includes('Медийная реклама')).html.includes('—'));
assert.equal(api.fromApiCabinet(null).netProfit,null);
console.log('API → familiar dashboard: passed (exact server totals, signed expenses, true SKU revenue, missing data, incumbent cards).');
