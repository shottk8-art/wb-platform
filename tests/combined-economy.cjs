const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const window={};vm.runInNewContext(fs.readFileSync('assets/dashboard.js','utf8'),{window,Intl,Map,Set,WeakMap,Date});
const api=window.WBDashboard;
const wb=api.fromApiCabinet({finance:{salesAmount:100,forPay:80,bought_qty:1,deliveryService:0,paidStorage:0,paidAcceptance:0,penalty:0,deduction:10,additionalPayment:0,cashbackAmount:0,cashbackCommissionChange:0,cashbackDiscount:0,advertisingDeductions:10},
 economy:{payout:70,tax:5,net_profit:47,internal_ads:8,advertising_total:8,advertising_already_withheld:10,promo:0},net_profit:47,cogs:20,products:[],settings:{operational_expenses:0,external_promotion_expenses:0},
 sources:{orders:{status:'downloaded',amount:200,count:2},ads:{status:'downloaded'},media:{status:'downloaded',amount:0}}});
const ozon=api.computeDerived({marketplace:'ozon',sales_amount:50,transfer_goods:40,transfer_total:40,ads_spend:5,bought_qty:1},[{article:'OZ',bought_qty:1,revenue:50}],new Map([['OZ',10]]),5);
const entries=(a=wb,b=ozon)=>[{derived:a,shop:{marketplace:'wildberries'}},{derived:b,shop:{marketplace:'ozon'}}];
const total=api.combineDerived(entries());
assert.equal(total.netProfit,69.5);
assert.equal(total.isApi,true,'signed API ledger totals retain their calculation mode');
assert.equal(total.rates.drrOrders,null,'missing Ozon orders cannot become a WB-only denominator');
assert.equal(total.rates.drrSales,13/150*100);
const expenses=api.expenseItems(total,'all').reduce((sum,[,value])=>sum+(value||0),0);
assert.equal(expenses,150-total.netProfit,'combined expenses must retain API advertising offsets and signed corrections');
const missing=api.combineDerived(entries({...wb,cogs:null,netProfit:null,missingCosts:['SKU'],expenses:wb.expenses.map(([label,value])=>[label,label==='Себестоимость товара'?null:value])}));
assert.equal(missing.netProfit,null,'an unknown month/source cannot become a partial-looking total');
assert.equal(missing.cogs,null);assert.deepEqual(Array.from(missing.missingCosts),['SKU']);
assert.ok(api.expenseItems(missing,'all').some(([,value])=>value===null),'unknown expense remains unknown in the combined structure');
const marked=api.combineDerived(entries({...wb,mediaEstimated:true}));assert.equal(marked.mediaEstimated,true);
console.log('Combined economy PASS: API + files, no double advertising charge, signed expenses, unknown totals and estimate propagation.');
