import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const code=html.slice(html.indexOf('  async function renderRangePeriod('),html.indexOf('  function paintApiDashboard('));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(){
  const nodes=new Map(),paints=[];
  const el=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:false});return nodes.get(id);};
  const pending=deferred(),derived={rep:{sales_amount:123},skuRows:[]};
  const state={document:{getElementById:el},dashboardRequest:1,shop:{id:'A'},overviewScope:'wildberries',currentTrend:[],aiAllowed:true,
    usesApiData:()=>true,renderDashboardKpis:d=>paints.push(d),refreshTrendChart(){},showManualExpenses(){},updateOverviewSource(){},
    window:{WBRange:{active:true,selection:()=>({start:'2026-7',end:'2026-9'}),load:()=>pending.promise,label:()=> 'Период'},
      WBDashboard:{renderExpenses(){},renderSkuTable(){}}}};
  vm.createContext(state);vm.runInContext(code,state);
  return {state,pending,paints,derived};
}
for(const change of [s=>s.shop={id:'B'},s=>s.dashboardRequest++,s=>s.overviewScope='ozon',s=>s.window.WBRange.active=false,s=>s.usesApiData=()=>false]){
  const f=fixture(),job=f.state.renderRangePeriod(1,{id:'A'},'wildberries');
  assert.equal(f.paints.length,0,'range must paint only after all sources are ready');
  change(f.state);f.pending.resolve({derived:f.derived,trend:[],selected:[],comparison:[],previous:null});await job;
  assert.equal(f.paints.length,0,'abandoned range cannot overwrite another shop, source, scope or mode');
}
const f=fixture(),job=f.state.renderRangePeriod(1,{id:'A'},'wildberries');
f.pending.resolve({derived:f.derived,trend:[{year:2026,month:7}],selected:[{},{}],comparison:[],previous:null});await job;
assert.equal(f.paints[0],f.derived);assert.equal(f.state.currentTrend.length,1);
assert.match(f.state.document.getElementById('rangeNotice').textContent,/обновление из WB/);
assert.match(html,/window\.WBRange\.wire\(\(\)=>renderCurrentPeriod\(true\)/);
assert.match(html,/comparisonLabel: window\.WBRange\?\.active \? 'к предыдущему периоду'/);
assert.match(html,/if\(window\.WBRange\?\.active\) return await renderRangePeriod/);
console.log('Range integration: PASS (atomic paint, shop/source/scope/mode revisions, real renderer branch and controls).');
