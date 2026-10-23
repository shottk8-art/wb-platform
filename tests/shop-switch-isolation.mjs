import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

function fixture() {
  const elements=new Map(), lists=[], loads=[], paints=[];
  const el=id=>{
    if(!elements.has(id)) elements.set(id,{value:'',innerHTML:'',textContent:'',hidden:false,disabled:false,dataset:{},events:{},
      addEventListener(event,fn){this.events[event]=fn;},setAttribute(){},replaceChildren(){this.innerHTML='';this.textContent='';}});
    return elements.get(id);
  };
  el('shopSwitch').value='clariskin';
  el('periodSelect').value='2026-10';
  el('kpiRow').textContent='sales of toplash';
  el('secondaryKpiRow').textContent='ads of toplash';
  el('profitabilityValue').textContent='profitability of toplash';
  for(const id of ['membersBody','costsBody','uploadsBody']) el(id).innerHTML='rows of toplash';
  let notify;
  const state={console,shop:{id:'toplash'},session:{user:{id:'owner'}},activeView:'overview',overviewScope:'wildberries',reportMarketplace:'wildberries',
    profitNotice:{reset(){el('profitNotice').hidden=true;}},clearProfitCostFilter(){el('profitCostFilter').hidden=true;},
    dashboardRequest:0,periodsRequest:0,shopChange:0,shopLoading:false,overviewPending:false,overviewLoadError:'',apiDisplayedPeriod:'toplash:wildberries:2026-10',periods:[],currentTrend:[],
    document:{getElementById:el},localStorage:{setItem(){}},
    window:{WBAuth:{listMyShops:()=>{const d=deferred();lists.push(d);return d.promise;}},WBAnalysis:{reset(){}},
      WBApi:{setContext(){},subscribe:fn=>notify=fn},WBApiCabinet:{setContext(){},currentMonth:'2026-10'},
      WBDashboard:{loadPeriods:(shop,marketplace)=>{const d=deferred();loads.push({...d,shop,marketplace});return d.promise;},
        formatPeriod:(y,m)=>`${y}-${m}`,defaultPeriodValue:p=>`${p[0].year}-${p[0].month}`,
        computeDerived:()=>({rep:{}}),renderExpenses(){},renderSkuTable(){},renderProfitability(){el('profitabilityValue').textContent='—';}}},
    setActiveView(){},updateShareBox(){},updateOverviewSource(){},updateScopeButtons(){},apiCabinetAllowed:()=>false,usesApiData:()=>false,
    overviewMarketplaces:()=>state.overviewScope==='all'?['wildberries','ozon']:[state.overviewScope],
    refreshMembers:async()=>{},refreshCostsTable:async()=>{},refreshUploadsLog:async()=>{},refreshTrendChart(){},showManualExpenses(){},toast(){},
    renderCurrentPeriod:async()=>{state.dashboardRequest++;const value=state.shop.id+':'+el('periodSelect').value;paints.push(value);el('kpiRow').textContent=value;state.setShopLoading?.(false);},
  };
  vm.createContext(state);
  const helpersStart=html.indexOf('  function setShopLoading(');
  if(helpersStart>=0) vm.runInContext(html.slice(helpersStart,html.indexOf('  function renderDashboardKpis(',helpersStart)),state);
  vm.runInContext(html.slice(html.indexOf('  async function refreshPeriods('),html.indexOf('  function refreshTrendChart(')),state);
  vm.runInContext(html.slice(html.indexOf('  window.WBApi.subscribe('),html.indexOf('  window.WBApiCabinet.subscribeStatus')),state);
  vm.runInContext(html.slice(html.indexOf('    document.getElementById("shopSwitch").addEventListener'),html.indexOf('    document.getElementById("shareToggle").addEventListener')),state);
  return {state,el,lists,loads,paints,notify:()=>notify(),switchTo:id=>{el('shopSwitch').value=id;return el('shopSwitch').events.change({target:el('shopSwitch')});}};
}

// Actual switch callback must clear the previous shop BEFORE its first await.
{
  const f=fixture(); const switching=f.switchTo('clariskin');
  assert.equal(f.el('kpiRow').textContent,'','previous store KPI is removed synchronously');
  assert.equal(f.el('secondaryKpiRow').textContent,'','previous store advertising is removed synchronously');
  assert.equal(f.el('profitabilityValue').textContent,'—','previous store profitability is removed synchronously');
  assert.equal(f.el('profitNotice').hidden,true,'previous shop reason is removed synchronously');
  assert.equal(f.el('profitCostFilter').hidden,true,'previous shop cost filter is removed synchronously');
  assert.equal(f.el('secOverviewCharts').hidden,true);
  assert.equal(f.el('secAdvertising').hidden,true);
  assert.equal(f.el('periodSelect').disabled,true);
  assert.equal(f.state.dashboardRequest,1,'old renders are cancelled immediately');
  for(const id of ['membersBody','costsBody','uploadsBody']) assert.doesNotMatch(f.el(id).innerHTML,/toplash/);
  f.lists[0].resolve([{id:'clariskin'}]);await tick();
  f.loads[0].resolve([{year:2026,month:9}]);await switching;
  assert.equal(f.el('periodSelect').value,'2026-9');
  assert.equal(f.el('periodSelect').disabled,false);
}

// The two REAL callers must not cancel periods and then paint the stale October.
for(const statusFirst of [false,true]) {
  const f=fixture(), switching=f.switchTo('clariskin');
  f.lists[0].resolve([{id:'clariskin'}]);await tick();
  const notification=f.notify();await tick();
  assert.equal(f.loads.length,2);
  const order=statusFirst?[1,0]:[0,1];
  for(const i of order) { f.loads[i].resolve([{year:2026,month:9}]);await tick(); }
  await Promise.all([switching,notification]);
  assert.equal(f.el('periodSelect').value,'2026-9');
  assert.ok(f.paints.length>0);
  assert.ok(f.paints.every(value=>value==='clariskin:2026-9'),JSON.stringify(f.paints));
}

// Rapid A -> B -> A must invalidate even the first A's delayed response.
{
  const f=fixture(), first=f.switchTo('clariskin');
  f.lists[0].resolve([{id:'clariskin'}]);await tick();
  const second=f.switchTo('smilebe');
  const third=f.switchTo('clariskin');
  f.lists[1].resolve([{id:'smilebe'}]);await tick();
  f.lists[2].resolve([{id:'clariskin'}]);await tick();
  assert.equal(f.loads.length,2,'abandoned middle switch must not load periods');
  f.loads[1].resolve([{year:2026,month:9}]);await third;
  f.loads[0].resolve([{year:2026,month:8}]);await Promise.all([first,second]);
  assert.equal(f.el('periodSelect').value,'2026-9');
  assert.deepEqual(f.paints,['clariskin:2026-9']);
}

// An old API period list cannot inject its current month into a file-only shop.
{
  const f=fixture(), pending=deferred();
  f.state.shop={id:'toplash'};
  f.state.usesApiData=()=>f.state.shop?.id==='toplash';
  f.state.window.WBApiCabinet.overview=()=>pending.promise;
  const old=f.state.refreshPeriods();
  const switching=f.switchTo('smilebe');
  f.lists[0].resolve([{id:'smilebe'}]);await tick();
  f.loads[0].resolve([{year:2026,month:9}]);await switching;
  pending.resolve({trend:[{year:2026,month:10}]});await old;
  assert.equal(f.el('periodSelect').value,'2026-9');
  assert.doesNotMatch(f.el('periodSelect').innerHTML,/текущий/);
}

// A late file response must not dereference a null/new shop or repaint its KPIs.
{
  const f=fixture(), pending=deferred();
  f.state.window.WBDashboard.loadPeriodData=()=>pending.promise;
  vm.runInContext(html.slice(html.indexOf('  async function renderCurrentPeriod('),html.indexOf('  function paintApiDashboard(')),f.state);
  const rendering=f.state.renderCurrentPeriod();
  f.state.shop=null;f.state.dashboardRequest++;f.el('kpiRow').textContent='';
  pending.resolve({report:{},skus:[],costMap:new Map()});await rendering;
  assert.equal(f.el('kpiRow').textContent,'');
}

// The journal, costs and members use the same shop generation, including A/B/A.
for(const [functionName,nextFunction,apiName,container] of [
  ['refreshMembers','refreshPeriods','listMembers','membersBody'],
  ['refreshUploadsLog','pluralArticles','listUploads','uploadsBody'],
  ['refreshCostsTable','wireDropzone','listCosts','costsBody'],
]) {
  const f=fixture(), pending=deferred();
  f.state.isOwner=()=>true;
  f.state.window.WBUpload={listUploads:()=>pending.promise,listCosts:()=>pending.promise};
  f.state.window.WBAuth.listMembers=()=>pending.promise;
  vm.runInContext(html.slice(html.indexOf(`  async function ${functionName}(`),html.indexOf(`  ${nextFunction==='refreshPeriods'?'async ':''}function ${nextFunction}(`)),f.state);
  const loading=f.state[functionName]();
  f.state.shopChange+=2; // same shop ID again, but a different visit
  f.el(container).innerHTML='current visit rows';
  pending.resolve([]);await loading;
  assert.equal(f.el(container).innerHTML,'current visit rows',apiName+' must reject an abandoned visit');
}

console.log('Shop switch isolation: PASS (immediate reset, concurrent API status, both response orders, rapid A/B/A, stale API/file data and auxiliary tables).');
