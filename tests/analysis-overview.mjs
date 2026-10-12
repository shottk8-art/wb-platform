import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const elements=new Map();
const el=id=>{if(!elements.has(id))elements.set(id,{hidden:false,value:'2026-9',addEventListener(_,fn){this.click=fn}});return elements.get(id)};
const requests=[];
const state={shop:{id:'toplash'},sourceShopId:'toplash',sourcePreference:'api',overviewSource:'api',overviewScope:'wildberries',shopLoading:false,overviewPending:false,overviewLoadError:'',activeView:'overview',aiAllowed:true,
  document:{getElementById:el},apiCabinetAllowed:()=>true,updateOverviewLoadStatus(){},toast(){},localStorage:{getItem:()=>null},
  window:{WBAnalysis:{analyze:async input=>requests.push(input)}}};
vm.createContext(state);
vm.runInContext(html.slice(html.indexOf('  function updateOverviewSource()'),html.indexOf('  function updateOverviewLoadStatus()')),state);
const start=html.indexOf('    document.getElementById("aiAnalyzeBtn").addEventListener');
vm.runInContext(html.slice(start,html.indexOf('    const manualExpenseInputs',start)),state);
state.updateOverviewSource();
assert.equal(el('secAiAnalysis').hidden,false,'the platform owner can analyze ready API dashboards');
await el('aiAnalyzeBtn').click();
assert.equal(requests[0].source,'api','the selected data source must cross the request boundary');
state.overviewScope='ozon';state.updateOverviewSource();await el('aiAnalyzeBtn').click();
assert.equal(requests[1].source,'files','Ozon always uses uploaded reports');
state.overviewPending=true;state.updateOverviewSource();
assert.equal(el('secAiAnalysis').hidden,true,'do not analyze stale values while a selection is loading');
const before=requests.length;await el('aiAnalyzeBtn').click();assert.equal(requests.length,before);
state.overviewPending=false;state.aiAllowed=false;state.updateOverviewSource();
assert.equal(el('secAiAnalysis').hidden,true);
await el('aiAnalyzeBtn').click();assert.equal(requests.length,before);
console.log('AI overview: PASS (owner API visibility, selected source, Ozon files, pending and account restrictions).');

// The public analysis/reset interface must discard a response from a previous
// shop, marketplace or month, without overwriting the newly selected screen.
const nodes=new Map();
const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{hidden:false,textContent:'',disabled:false,dataset:{},parentElement:{hidden:false},replaceChildren(){},querySelector:node});return nodes.get(selector)};
const card=node('card');
let resolve;
const pending=new Promise(r=>{resolve=r});
const analysisContext={document:{getElementById:()=>card,createElement:()=>({textContent:''})},window:{supabaseClient:{functions:{invoke:()=>pending}}}};
vm.createContext(analysisContext);
vm.runInContext(readFileSync(new URL('../assets/analysis.js',import.meta.url),'utf8'),analysisContext);
const old=analysisContext.window.WBAnalysis.analyze({shop_id:'previous-shop'});
analysisContext.window.WBAnalysis.reset();
resolve({data:{analysis:{summary:'OLD SHOP',health:'neutral',insights:[],actions:[],caveats:[]}}});
await old;
assert.equal(card.dataset.state,'idle','a response from the abandoned shop must not render');
assert.equal(node('#aiAnalysisResult').hidden,true);
console.log('AI response isolation: PASS (abandoned requests cannot overwrite the selected shop).');
