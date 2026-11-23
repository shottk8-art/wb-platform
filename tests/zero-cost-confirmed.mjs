import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {articleKey,costCatalogue,hasCostPrice} from '../supabase/functions/wb-api/articles.ts';
import {aggregateFinanceRows,readCabinet} from '../supabase/functions/wb-api/cabinet.ts';
import {aggregateDailyFinance,calculateDaily} from '../supabase/functions/wb-api/daily.ts';
import {aggregateUnitFinance,calculateUnit} from '../supabase/functions/wb-api/unit.ts';
import {calculateOzonDaily,calculateOzonUnit} from '../supabase/functions/wb-api/ozon.ts';
import {apiProducts} from '../supabase/functions/analyze-results/calculations.ts';

const window={};
vm.runInNewContext(readFileSync('assets/dashboard.js','utf8'),{window,Intl,Map,Set,WeakMap,Date});
vm.runInNewContext(readFileSync('assets/ozon-model.js','utf8'),{window,Map,BigInt,Number,Date});
const confirmed={article:'PenBlack 1.0',cost_price:'0',zero_cost_confirmed:true,updated_at:'2026-01-01'};
const placeholder={article:' PENBLACK 1.0 ',cost_price:0,updated_at:'2026-11-01'};
for(const row of [{cost_price:null,zero_cost_confirmed:true},{cost_price:'',zero_cost_confirmed:true},{cost_price:-1,zero_cost_confirmed:true},{cost_price:0},{cost_price:0,zero_cost_confirmed:'true'}])assert.equal(hasCostPrice(row),false);
assert.equal(hasCostPrice(confirmed),true);assert.equal(hasCostPrice({cost_price:220}),true);
for(const rows of [[confirmed,placeholder],[placeholder,confirmed]]){
 const resolved=costCatalogue(rows),browser=window.WBDashboard.costCatalogue(rows);
 assert.equal(resolved.get('penblack 1.0').zero_cost_confirmed,true);
 assert.deepEqual([...resolved],[...browser]);
}
assert.equal(costCatalogue([confirmed,{article:placeholder.article,cost_price:20}]).get('penblack 1.0').cost_price,20,'a known positive alias retains established precedence');

const period={dateFrom:'2026-10-01',dateTo:'2026-10-31'},shopId='02969ba6-12e3-42df-b126-68ae9ebb00e1';
const operations=[{rrdId:'1',rrDate:'2026-10-01',vendorCode:'penblack 1.0',sellerOperName:'Продажа',docTypeName:'Продажа',quantity:2,retailPriceWithDisc:'100.00',retailAmount:'200.00',forPay:'160.00'},
 {rrdId:'2',rrDate:'2026-10-02',vendorCode:'penblack 1.0',sellerOperName:'Возврат',docTypeName:'Возврат',quantity:1,retailPriceWithDisc:'100.00',retailAmount:'100.00',forPay:'80.00'}];
const model=aggregateFinanceRows(operations,'2');
async function cabinet(prices){
 const job={id:'zero-test',status:'complete',date_from:period.dateFrom,date_to:period.dateTo,row_count:2,cursor_id:'2',finance_model:model,
  summary:{pilot:{finance_complete:true},api_sources:{orders:{status:'downloaded',orders_amount:'300.00',rows:[]},internal_ads:{status:'downloaded',period_totals:{},daily_totals:{}},media:{status:'estimated',estimated:true,date_from:period.dateFrom,date_to:period.dateTo,amount:'0.00'}}}};
 return readCabinet({},shopId,period,job.id,{shop:{id:shopId,tax_rate:0},job,settings:[],costs:prices});
}
const known=await cabinet([placeholder,confirmed]),unknown=await cabinet([placeholder]);
assert.equal(known.cogs,'0.00');assert.deepEqual(known.missing_costs,[]);assert.equal(known.net_profit,'80.00');
assert.equal(unknown.cogs,null);assert.equal(unknown.net_profit,null);assert.deepEqual(unknown.missing_costs,['penblack 1.0']);
const daily=aggregateDailyFinance(operations,period,'2');
assert.equal(calculateDaily(known,daily,{}).monthly_profit,'80.00');assert.equal(calculateDaily(unknown,daily,{}).monthly_profit,null);
assert.equal(calculateDaily(known,daily,{}).days[1].cogs,'0.00','return of a gift restores exactly zero cost');
const unit=aggregateUnitFinance(operations,'2');
assert.equal(calculateUnit(known,unit).products[0].net_profit,'80.00');assert.equal(calculateUnit(unknown,unit).products[0].missing_costs,true);
assert.equal(window.WBDashboard.fromApiCabinet(known).skuRows[0].total_cost,0);
assert.equal(window.WBDashboard.fromApiCabinet(unknown).skuRows[0].total_cost,null,'ordinary seeded zero remains visibly unknown');
assert.equal(apiProducts(known)[0].gross_profit,100,'AI receives the same known zero as the overview');
assert.equal(apiProducts(unknown)[0].gross_profit,null);
assert.equal((await cabinet([{article:'different',cost_price:0,zero_cost_confirmed:true}])).net_profit,null,'confirmation belongs to the exact article');

const ozon=window.WBOzonModel.create({from:period.dateFrom,to:period.dateTo,declared:true});
window.WBOzonModel.add(ozon,{date:'2026-10-01',group:'Продажи',amount:200,article:'penblack 1.0',quantity:2,type:'Выручка',name:'Gift'});
const saved=window.WBOzonModel.finish(ozon),report={sales_amount:200,bought_qty:2,transfer_total:200,ads_spend:0},prices=costCatalogue([confirmed]);
assert.equal(calculateOzonDaily(saved,report,prices,0).monthly_profit,'200.00');
assert.equal(calculateOzonUnit(saved,report,prices,0).products[0].missing_costs,false);
assert.equal(calculateOzonDaily(saved,report,costCatalogue([placeholder]),0).monthly_profit,null);
assert.equal(articleKey(confirmed.article),'penblack 1.0');
console.log('Confirmed zero costs PASS: monthly WB, daily/returns, SKU economics, Ozon, browser display, alias precedence and unknown placeholder isolation.');
