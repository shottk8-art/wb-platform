const assert=require('node:assert/strict');
const {change,makeModel,metrics,chartReady}=require('../assets/promo-charts.js');
const dependencies={Chart:function(){},WBDashboard:{trendBarColors(){}},WBTrend:{plugin:{}}};
assert.equal(chartReady(dependencies),true);
for(const missing of ['Chart','WBDashboard','WBTrend'])assert.equal(chartReady({...dependencies,[missing]:undefined}),false,missing+' must fail closed');
assert.equal(change(null,10),null);assert.equal(change(10,undefined),null);
assert.equal(change('',10),null);assert.equal(change(10,0).percent,null);
assert.deepEqual(change(0,0),{amount:0,percent:0,direction:'flat'});
assert.deepEqual(change(-10,-20),{amount:10,percent:50,direction:'up'});
assert.equal(change(40,100).percent,-60);
const rows=[{year:2025,month:12,sold_qty:10,sold_amount:'100.10',net_amount:'-20.00',active_codes:2},
  {year:2026,month:1,sold_qty:20,sold_amount:'200.20',net_amount:'-10.00',active_codes:2},
  {year:2026,month:2,sold_qty:null,sold_amount:null,net_amount:null,active_codes:null},
  {year:2026,month:3,sold_qty:2,sold_amount:'20.00',net_amount:'10.00',active_codes:1,partial:true}];
let model=makeModel(rows,'net_amount',metrics.net_amount,'2026-1',{net_amount:'-20.00'});
assert.deepEqual(model.values,[-20,-10,null,10]);assert.equal(model.initial,1);
assert.equal(model.detail(1).delta,50,'negative baselines use absolute denominator');
assert.equal(model.detail(1).month,'январь 2026');
assert.equal(model.detail(2).value,null);assert.match(model.detail(2).note,/Нет полной загрузки/);
assert.equal(model.detail(3).delta,null);assert.match(model.detail(3).note,/не завершён/);
assert.equal(model.detail(-1),null);
model=makeModel(rows,'active_codes',metrics.active_codes,'missing',{active_codes:2});
assert.match(model.summaryText,/^2 /,'unique codes use server summary instead of summing monthly counts');
assert.equal(model.initial,3);
model=makeModel(rows,'sold_qty',metrics.sold_qty,'2026-1',null);
assert.equal(model.detail(1).secondary,200.2);assert.equal(model.detail(1).secondaryUnit,'₽');
assert.equal(model.summaryText,'Часть истории не загружена');
model=makeModel([{year:2026,month:1,sold_qty:0},{year:2026,month:2,sold_qty:3}],'sold_qty',metrics.sold_qty,'2026-2',null);
assert.equal(model.detail(1).delta,null);assert.match(model.detail(1).note,/равно 0/);
assert.equal(model.detail(1).deltaText,'—');
assert.equal(metrics.net_amount.label,'После возвратов');
const vm=require('node:vm'),fs=require('node:fs');
for(const missing of ['Chart','WBDashboard','WBTrend']){
  const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='promoTrendMetric'?'sold_amount':'',hidden:true,parentElement:{hidden:false},setAttribute(){},addEventListener(){},replaceChildren(){}});return nodes.get(id);};
  let constructions=0;
  const window={document:{body:{},getElementById:get,querySelectorAll:()=>[]},Chart:class{constructor(){constructions++;throw Error('unavailable chart must not construct');}},WBDashboard:{trendBarColors:()=>[]},WBTrend:{plugin:{}},addEventListener(){},matchMedia:()=>({matches:true,addEventListener(){}})};
  delete window[missing];
  vm.runInNewContext(fs.readFileSync(require.resolve('../assets/promo-charts.js'),'utf8'),{window,Intl,Date,Number,String,Map,getComputedStyle:()=>({getPropertyValue:()=> '#123456'})});
  assert.doesNotThrow(()=>window.WBPromoCharts.render({period:{dateFrom:'2026-01-01',dateTo:'2026-01-31'},metrics:{},comparison:null,trend:{period:{dateFrom:'2026-01-01',dateTo:'2026-01-31'},rows:[rows[1]],metrics:{sold_amount:'200.20'}}}),missing+' must not interrupt the surrounding table render');
  assert.equal(constructions,0);assert.equal(get('promoTrendFallback').hidden,false);
  assert.equal(get('promoTrend').parentElement.hidden,true);assert.match(get('promoTrendFallback').textContent,/Итоги и таблица доступны/);
}
console.log('Promo chart PASS: null gaps, zero/negative bases, year-boundary comparisons, partial month, units, unique summary, metric choice and all three script-failure fallbacks.');
