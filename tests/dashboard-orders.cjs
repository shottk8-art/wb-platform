const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const number = () => ({textContent:'',isConnected:true,classList:{add(){},remove(){}}});
const document = {createElement(){return {set innerHTML(html){
  const nodes = {'.kpi-number':number(),'.kpi-quantity':number()};
  this.content = {firstChild:{html,nodes,events:{},querySelector:selector=>nodes[selector],
    addEventListener(event,handler){this.events[event]=handler;}}};
}};}};
const frames = [];
const window = {matchMedia:()=>({matches:true})};
const context = vm.createContext({window,document,Intl,Map,Date,performance:{now:()=>0},requestAnimationFrame:fn=>frames.push(fn)});
vm.runInContext(fs.readFileSync(path.join(root,'assets/dashboard.js'),'utf8'),context);
const api = window.WBDashboard;
const derive = (report) => api.computeDerived(report,[],new Map(),0);
const report = {marketplace:'wildberries',orders_amount:2000,orders_qty:20,bought_qty:7,sales_amount:700};
function cards(d,previous=null,marketplace='wildberries',interaction){
  const container = {innerHTML:'',children:[],appendChild(c){this.children.push(c);}};
  api.renderKPI(container,d,previous,marketplace,interaction);
  return container.children;
}
const current=derive(report),previous=derive({...report,orders_amount:1000,orders_qty:10});
for(const scope of ['wildberries','ozon','all']) {
  for(const interaction of [undefined,{activeMetric:'orders',onSelect(){}}]) {
    for(const d of [current,derive({...report,orders_qty:null}),api.fromApiCabinet(null)]) {
      const rendered=cards(d,previous,scope,interaction);
      const html=rendered.map(c=>c.html).join('');
      assert.doesNotMatch(html,/kpi--orders|kpi-quantity|Заказано:|kpi-label">Заказы|data-trend-metric="orders"/,'orders card is absent in every scope and loading/public/private state');
      assert.match(html,/kpi-label">Сумма продаж/);
      assert.match(html,/ДРР \(заказа\)/,'the DRR card stays visible');
      if(interaction) assert.match(html,/data-trend-metric="sales" aria-pressed="true"/,'removed selection falls back to sales');
    }
  }
}

const cabinet = {sources:{orders:{status:'downloaded',amount:'66640095.00',count:22998}},finance:{bought_qty:18451}};
const fromApi=api.fromApiCabinet(cabinet);
assert.equal(fromApi.ordersSummary.amount,66640095);
assert.equal(fromApi.ordersSummary.qty,22998);
assert.equal(fromApi.rep.bought_qty,18451,'orders do not alter financial sales');
assert.equal(api.fromApiCabinet({sources:{orders:{...cabinet.sources.orders,status:'loading'}}}).ordersSummary.amount,null);
const ozon=derive({...report,marketplace:'ozon'});
assert.equal(ozon.ordersSummary.amount,null,'accrual sales cannot stand in for all placed orders');
const combined=api.combineDerived([{derived:fromApi,shop:{marketplace:'wildberries'}},{derived:ozon,shop:{marketplace:'ozon'}}]);
assert.equal(combined.ordersSummary.amount,null,'mixed totals must not silently omit Ozon orders');
assert.equal(combined.ordersSummary.qty,null);
assert.equal(api.combineDerived([{derived:current,shop:{marketplace:'wildberries'}}]).ordersSummary.qty,20);
assert.equal(api.combineTrend([[{year:2026,month:9,orders:1000}],[{year:2026,month:9,orders:null}]] )[0].orders,null);
const disjoint=api.combineTrend([[{year:2026,month:9,orders:1000}],[{year:2026,month:8,orders:null}]],false);
assert.ok(disjoint.every(row=>row.orders==null && row.drrOrders==null),'combined coverage is incomplete even in disjoint months');
assert.equal(api.combineTrend([[{year:2026,month:9,orders:1000}],[]],false)[0].orders,null,'empty Ozon month is not proof of zero orders');
let selected;
const button=cards(current,previous,'wildberries',{activeMetric:'sales',onSelect:metric=>selected=metric})[0];
button.events.click();
assert.equal(selected,'sales');
assert.match(button.html,/aria-pressed="true"/);
assert.doesNotMatch(button.html,/<div/,'no block div inside button');
assert.doesNotMatch(cards(current)[0].html,/<button/,'public storefront remains read-only');
window.matchMedia=()=>({matches:false});
const animated=cards(current,previous)[0];
while(frames.length)frames.shift()(720);
assert.equal(animated.nodes['.kpi-number'].textContent,'700','remaining KPI animation is preserved');

// Actual WB header names from the user-provided summary; basket count differs.
let aoa = [['Год','Месяц','День','Сумма заказов по розничным ценам с учётом согласованной скидки, руб.','Заказано, шт.','Количество заказов','Выкупили','Итого к перечислению'],
  [2026,9,null,2000,20,12,7,700],[2026,9,1,100,1,1,0,0]];
window.XLSX={read:()=>({Sheets:{sheet:{}},SheetNames:['sheet']}),utils:{sheet_to_json:()=>aoa}};
vm.runInContext(fs.readFileSync(path.join(root,'assets/parse.js'),'utf8'),context);
(async()=>{
  const file={arrayBuffer:async()=>new ArrayBuffer(0)};
  const rows=await window.WBParse.parseSummaryReport(file);
  assert.equal(rows.length,1,'only month totals, no daily-row double counting');
  assert.equal(rows[0].orders_amount,2000);
  assert.equal(rows[0].orders_qty,20,'units, not unique baskets or redeemed quantity');
  aoa[1][4]='—';
  assert.equal((await window.WBParse.parseSummaryReport(file))[0].orders_qty,null,'unknown marker is not zero');
  aoa[1][4]=0;
  assert.equal((await window.WBParse.parseSummaryReport(file))[0].orders_qty,0,'true zero stays zero');
  aoa[1][3]='—';
  await assert.rejects(window.WBParse.parseSummaryReport(file),/нет суммы заказов/,'missing amount must never be written as zero');
  aoa[1][3]=2000;
  aoa=aoa.map(row=>row.filter((_,index)=>index!==4));
  assert.equal((await window.WBParse.parseSummaryReport(file))[0].orders_qty,null,'older formats do not establish a zero quantity');
  const saved=aoa;
  aoa=aoa.map(row=>row.filter((_,index)=>index!==3));
  await assert.rejects(window.WBParse.parseSummaryReport(file),/отсутствует колонка «Сумма заказов»/);
  aoa=saved;
  aoa = [['Год','Месяц','День','Сумма заказов','Заказано, шт.','Выкупили','Итого к перечислению'],[2026,9,null,2000,20,7,700]];
  const writes=[];
  window.supabaseClient={from(table){
    const write={table,filters:{}};
    const query={upsert(payload){write.payload=payload;writes.push(write);return query;},insert(payload){write.payload=payload;writes.push(write);return query;},
      update(payload){write.payload=payload;writes.push(write);return query;},delete(){writes.push(write);return query;},
      eq(key,value){write.filters[key]=value;return query;},then(ok,bad){return Promise.resolve({error:null}).then(ok,bad);}};
    return query;
  }};
  vm.runInContext(fs.readFileSync(path.join(root,'assets/upload.js'),'utf8'),context);
  await window.WBUpload.uploadSummaryReport('shop-a',{...file,name:'summary.xlsx'});
  assert.equal(writes[0].payload[0].orders_qty,20);
  assert.equal(writes[0].payload[0].shop_id,'shop-a');
  assert.equal(writes[0].payload[0].marketplace,'wildberries');
  await window.WBUpload.deleteUpload('shop-a',{id:'upload-id',kind:'summary',marketplace:'wildberries',periods:[{year:2026,month:9}]});
  const undo=writes.find(w=>w.table==='monthly_reports'&&!Array.isArray(w.payload));
  assert.equal(undo.payload.orders_qty,null);
  assert.equal(undo.filters.shop_id,'shop-a');
  assert.equal(undo.filters.marketplace,'wildberries');
  assert.equal(undo.filters.month,9);
  assert.equal(undo.payload.ads_spend,undefined,'undo cannot clear independently imported ads');
  window.supabaseClient={rpc:async()=>({data:[{report,cogs:0}]})};
  assert.equal((await api.loadTrendData('shop',0,'ozon'))[0].orders,null);
  console.log('PASS: orders card removed in every scope and surface; API/file mapping, DRR, coverage and remaining KPI interactions preserved');
})().catch(error=>{console.error(error);process.exitCode=1;});
