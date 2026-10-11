import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const elements=new Map(), calls=[];
const el=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:true,textContent:'',dataset:{},addEventListener(){}});return elements.get(id);};
let timer, revision='same', historyLoading=true, failure=false, deferred;
const cabinet={complete:true,job:{status:'complete',updated_at:'2026-10-11'},shop:{tax_rate:0},finance:{},products:[],sources:{orders:{status:'downloaded'},ads:{status:'downloaded'},media:{status:'downloaded',amount:0}}};
const window={WBApi:{cabinet:async action=>{
  calls.push(action);
  if(deferred)return new Promise(resolve=>{deferred.resolve=resolve;});
  if(failure)throw new Error('Network failed');
  return {cabinet,trend:[],revision,history_loading:historyLoading};
}}};
vm.runInNewContext(readFileSync(new URL('../assets/wb-api-cabinet.js',import.meta.url),'utf8'),{
  window,document:{getElementById:el,hidden:false},Date,Intl,Map,Set,
  setTimeout:fn=>{timer=fn;return 1;},clearTimeout:()=>{timer=null;},
});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
let notifications=0, dataChanges=0;
window.WBApiCabinet.subscribeStatus(()=>notifications++);
window.WBApiCabinet.subscribe(()=>dataChanges++);
window.WBApiCabinet.setContext({shopId:'a',allowed:true});
assert.equal(window.WBApiCabinet.syncStatus.checking,true);
await tick();
assert.equal(window.WBApiCabinet.syncStatus.loading,true,'history loading is visible even when the selected month is complete');
assert.equal(window.WBApiCabinet.syncStatus.checking,false);
const initial=notifications;
historyLoading=false;timer();await tick();
assert.equal(window.WBApiCabinet.syncStatus.loading,false,'banner clears even when selected month revision is unchanged');
assert.ok(notifications>initial);
assert.equal(dataChanges,1,'status-only changes do not re-read or animate the dashboard');
assert.equal(calls.filter(c=>c==='cabinet').length,1);
failure=true;window.WBApiCabinet.reload();await tick();
assert.equal(window.WBApiCabinet.syncStatus.error,true);
assert.equal(window.WBApiCabinet.syncStatus.checking,false);
failure=false;window.WBApiCabinet.reload();await tick();
assert.equal(window.WBApiCabinet.syncStatus.error,false);
deferred={};window.WBApiCabinet.setContext({shopId:'b',allowed:true});
window.WBApiCabinet.setContext({shopId:'c',allowed:false});
deferred.resolve({cabinet,history_loading:true});await tick();
assert.equal(window.WBApiCabinet.syncStatus.shopId,'c');
assert.equal(window.WBApiCabinet.syncStatus.loading,false,'late response cannot show another shop’s loading');

const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
assert.match(html,/id="overviewLoading" role="status" aria-live="polite"/);
const ui={window:{WBApiCabinet:{syncStatus:{shopId:'a',loading:true}}},document:{getElementById:el},shop:{id:'a'},activeView:'overview',api:true,usesApiData(){return this.api;}};
// A simple closure avoids binding-dependent helper behavior in the VM.
ui.usesApiData=()=>ui.api;
vm.createContext(ui);
vm.runInContext(html.slice(html.indexOf('  function updateOverviewLoadStatus()'),html.indexOf('  function toast(')),ui);
ui.updateOverviewLoadStatus();
assert.equal(el('overviewLoading').hidden,false);
assert.match(el('overviewLoadingTitle').textContent,/Загружаем данные/);
assert.match(el('overviewLoadingText').textContent,/Страницу можно закрыть/);
ui.activeView='settings';ui.updateOverviewLoadStatus();assert.equal(el('overviewLoading').hidden,true);
ui.activeView='overview';ui.api=false;ui.updateOverviewLoadStatus();assert.equal(el('overviewLoading').hidden,true,'Ozon and file overview do not show the WB loader');
ui.api=true;ui.shop={id:'b'};ui.updateOverviewLoadStatus();assert.equal(el('overviewLoading').hidden,true);
ui.shop={id:'a'};ui.window.WBApiCabinet.syncStatus={shopId:'a',loading:false};ui.updateOverviewLoadStatus();assert.equal(el('overviewLoading').hidden,true);
ui.window.WBApiCabinet.syncStatus={shopId:'a',error:true};ui.updateOverviewLoadStatus();assert.equal(el('overviewLoading').dataset.error,'true');
assert.match(el('overviewLoadingText').textContent,/настройках/);
assert.match(html,/#overviewLoading a\[href\^="#"\][\s\S]*?setActiveView\(link\.getAttribute\('href'\)\.slice\(1\)\)/,'notice link uses app routing, not a dead hash change');
let scopeClick;
const button={dataset:{scope:'ozon'},addEventListener:(_event,fn)=>scopeClick=fn};
ui.document.querySelectorAll=()=>[button];ui.dashboardRequest=0;ui.overviewScope='wildberries';
ui.updateScopeButtons=()=>{};
ui.usesApiData=()=>ui.api && ui.overviewScope!=='ozon';
ui.updateOverviewSource=()=>ui.updateOverviewLoadStatus();
ui.refreshPeriods=()=>new Promise(()=>{});ui.renderCurrentPeriod=()=>{};
const start=html.lastIndexOf('    document.querySelectorAll("#overviewScope [data-scope]").forEach');
vm.runInContext(html.slice(start,html.indexOf('    document.querySelectorAll("#reportMarketplace',start)),ui);
ui.window.WBApiCabinet.syncStatus={shopId:'a',loading:true};ui.updateOverviewLoadStatus();
assert.equal(el('overviewLoading').hidden,false);
scopeClick();assert.equal(el('overviewLoading').hidden,true,'scope hides notice synchronously, before data/network resolves');
console.log('Overview loading: passed (initial read, background history, unchanged revision, error recovery, scoped reset, files/Ozon hidden, no extra requests).');
