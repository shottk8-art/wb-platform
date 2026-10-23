import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../assets/wb-api.css',import.meta.url),'utf8');
assert.match(css,/\.overview-loading \[hidden\][^}]*display:none !important/,'mobile flex layout must not reveal hidden background-sync links');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function fixture(realRenderer=false) {
  const elements=new Map(),periodReads=[],dataReads=[],trendReads=[],buttons=[];
  const el=id=>{
    if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',value:'2026-9',hidden:false,disabled:false,dataset:{},attrs:{},setAttribute(k,v){this.attrs[k]=v},replaceChildren(){this.innerHTML='';this.textContent=''}});
    return elements.get(id);
  };
  el('kpiRow').textContent='OLD WB SALES';el('expList').innerHTML='OLD WB EXPENSES';el('skuBody').innerHTML='OLD WB PRODUCTS';
  for(const scope of ['wildberries','ozon','all'])buttons.push({dataset:{scope},addEventListener(event,fn){this.click=fn}});
  const state={console,shop:{id:'shop-a'},shopLoading:false,activeView:'overview',overviewScope:'wildberries',dashboardRequest:0,overviewPending:false,overviewLoadError:'',currentTrend:[],apiDisplayedPeriod:null,trendMetric:'sales',
    profitNotice:{reset(){el('profitNotice').hidden=true;},update(d){el('profitNotice').hidden=!d.missing?.length;}},clearProfitCostFilter(){el('profitCostFilter').hidden=true;},
    document:{getElementById:el,querySelectorAll:()=>buttons},
    scopeLabel:()=>state.overviewScope==='ozon'?'Ozon':'Wildberries',usesApiData:()=>false,
    updateScopeButtons(){},updateOverviewSource(){state.updateOverviewLoadStatus()},setShopLoading(){},showManualExpenses(){},selectTrendMetric(){},refreshTrendChart(){el('trendEmpty').textContent='EMPTY'},toast(){},
    refreshPeriods(){const d=deferred();periodReads.push(d);return d.promise},
    renderCurrentPeriod:async()=>{el('kpiRow').textContent=state.overviewScope+' READY';state.setOverviewPending?.(false)},
    window:{WBAnalysis:{reset(){}},WBApiCabinet:{reload(){},syncStatus:{shopId:'shop-a'}},WBDashboard:{fromApiCabinet:()=>({rep:{sales_amount:null},isApi:true}),
      renderKPI(node,d){node.textContent=d.rep.sales_amount==null?'—':String(d.rep.sales_amount);},renderExpenses(node){node.innerHTML='—';},renderSkuTable(node){node.innerHTML='—';}}},
  };
  vm.createContext(state);
  vm.runInContext(html.slice(html.indexOf('  function updateOverviewLoadStatus()'),html.indexOf('  function toast(')),state);
  const helpers=html.indexOf('  function setOverviewPending(');
  if(helpers>=0)vm.runInContext(html.slice(helpers,html.indexOf('  function setShopLoading(',helpers)),state);
  if(realRenderer) {
    state.overviewMarketplaces=()=>state.overviewScope==='all'?['wildberries','ozon']:[state.overviewScope];
    Object.assign(state.window.WBDashboard,{
      loadPeriodData:()=>{const d=deferred();dataReads.push(d);return d.promise},
      loadTrendData:()=>{const d=deferred();trendReads.push(d);return d.promise},
      computeDerived:report=>({rep:report||{}}),combineDerived:entries=>entries[0].derived,combineTrend:lists=>lists.flat(),
    });
    vm.runInContext(html.slice(html.indexOf('  function renderDashboardKpis('),html.indexOf('  async function refreshUploadsLog(')),state);
  }
  const start=html.lastIndexOf('    document.querySelectorAll("#overviewScope [data-scope]").forEach');
  vm.runInContext(html.slice(start,html.indexOf('    document.querySelectorAll("#reportMarketplace',start)),state);
  return {state,el,periodReads,dataReads,trendReads,click:scope=>buttons.find(b=>b.dataset.scope===scope).click()};
}
// The REAL file renderer must keep placeholders through current/previous/trend reads.
{
  const f=fixture(true),pending=f.click('ozon');
  f.periodReads[0].resolve(true);await tick();
  f.dataReads[0].resolve({report:{sales_amount:123},skus:[],costMap:new Map()});await tick();
  assert.equal(f.el('kpiRow').textContent,'—');
  f.dataReads[1].resolve({report:null,skus:[],costMap:new Map()});await tick();
  assert.equal(f.el('kpiRow').textContent,'—','current values must not appear while old charts have yet to be replaced');
  assert.equal(f.el('overviewLoading').hidden,false);
  f.trendReads[0].resolve([]);await pending;
  assert.equal(f.el('kpiRow').textContent,'123');
  assert.equal(f.el('overviewLoading').hidden,true);
}
// The real renderer also handles data failures without stuck spinners or old totals.
{
  const f=fixture(true),pending=f.click('ozon');
  f.periodReads[0].resolve(true);await tick();
  f.dataReads[0].reject(Error('offline'));await pending;
  assert.equal(f.el('kpiRow').textContent,'—');
  assert.equal(f.el('overviewLoading').dataset.error,'true');
  assert.equal(f.el('periodSelect').disabled,false);
}
// API snapshots use the same loading lifecycle, without unlocking an active sync.
{
  const f=fixture(true),api=deferred();
  f.state.usesApiData=()=>true;
  f.state.window.WBApiCabinet.overview=()=>api.promise;
  f.state.window.WBDashboard.fromApiCabinet=c=>({rep:{sales_amount:c?456:null}});
  const pending=f.click('wildberries');
  f.periodReads[0].resolve(true);await tick();
  assert.equal(f.el('kpiRow').textContent,'—');
  assert.equal(f.el('overviewLoading').hidden,false);
  api.resolve({cabinet:{complete:true,job:{status:'loading'}},trend:[]});await pending;
  assert.equal(f.el('kpiRow').textContent,'456');
  assert.equal(f.el('overviewLoading').hidden,true);
  assert.equal(f.el('overviewRefresh').disabled,true,'finishing local reads must not enable repeated background refresh');
}
{
  const f=fixture(true),api=deferred();
  f.state.usesApiData=()=>true;
  f.state.window.WBApiCabinet.overview=()=>api.promise;
  const pending=f.click('wildberries');
  f.periodReads[0].resolve(true);await tick();
  api.reject(Error('offline'));await pending;
  assert.equal(f.el('kpiRow').textContent,'—');
  assert.equal(f.el('overviewLoading').dataset.error,'true');
}

// Start the real switch callback; leave the first network read unresolved.
{
  const f=fixture(),pending=f.click('ozon');
  assert.doesNotMatch(f.el('kpiRow').textContent,/OLD WB/,'old marketplace totals must disappear before awaiting the period list');
  assert.equal(f.el('kpiRow').textContent,'—','show dashes, not zero or stale figures');
  assert.doesNotMatch(f.el('expList').innerHTML,/OLD WB/);
  assert.doesNotMatch(f.el('skuBody').innerHTML,/OLD WB/);
  assert.equal(f.el('overviewLoading').hidden,false);
  assert.match(f.el('overviewLoadingTitle').textContent,/Загружаем данные/);
  f.periodReads[0].resolve(true);await pending;
  assert.equal(f.el('kpiRow').textContent,'ozon READY');
  assert.equal(f.el('overviewLoading').hidden,true);
}
// An abandoned request cannot clear the new request's spinner or error state.
{
  const f=fixture(),first=f.click('ozon'),second=f.click('all');
  f.periodReads[0].reject(Error('old request failed'));await first;
  assert.equal(f.el('overviewLoading').hidden,false);
  assert.equal(f.state.overviewLoadError,'');
  f.periodReads[1].resolve(true);await second;
  assert.equal(f.el('kpiRow').textContent,'all READY');
}
{
  const f=fixture(),first=f.click('ozon'),second=f.click('all');
  f.periodReads[0].resolve(true);await first;
  assert.equal(f.el('kpiRow').textContent,'—','old successful period request cannot reveal data or stop the newer loader');
  assert.equal(f.el('overviewLoading').hidden,false);
  f.periodReads[1].resolve(true);await second;
  assert.equal(f.el('kpiRow').textContent,'all READY');
}
{
  const f=fixture(),pending=f.click('ozon');
  f.periodReads[0].reject(Error('offline'));await pending;
  assert.equal(f.el('kpiRow').textContent,'—');
  assert.equal(f.el('overviewLoading').hidden,false);
  assert.match(f.el('overviewLoadingTitle').textContent,/Не удалось/);
  assert.equal(f.el('periodSelect').disabled,false);
}
console.log('Marketplace loading: PASS (synchronous dashes, all block reset, local spinner, success, error, obsolete responses).');
