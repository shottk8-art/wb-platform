import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const start=html.indexOf('    document.getElementById("importCostsFile").addEventListener');
const callback=html.slice(start,html.indexOf('\n  }\n\n  init()',start));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(r=>setImmediate(r));

function fixture() {
  const parse=deferred(),save=deferred(),calls=[],toasts=[];
  const button={innerHTML:'Import <svg></svg>',textContent:'Import',disabled:false,attrs:{},
    setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];}};
  const input={value:'file.xlsx',addEventListener(event,fn){this[event]=fn;}};
  const state={shop:{id:'shop-a',name:'Агава'},reportMarketplace:'wildberries',
    document:{getElementById:id=>id==='importCostsFile'?input:button},
    window:{WBParse:{parseCostsFile:()=>parse.promise},WBUpload:{importCosts(...args){calls.push(args);return save.promise;}}},
    refreshCostsTable:async()=>calls.push('costs'),renderCurrentPeriod:async()=>calls.push('dashboard'),
    refreshUploadsLog:async()=>calls.push('journal'),toast:(...args)=>toasts.push(args)};
  vm.runInNewContext(callback,state);
  return {state,parse,save,calls,toasts,button,input,start:()=>input.change({target:{files:[{name:'costs.xlsx'}],value:'file.xlsx'}})};
}
{
  const f=fixture(),pending=f.start();
  assert.equal(f.button.disabled,true);
  assert.equal(f.button.attrs['aria-busy'],'true');
  assert.match(f.button.textContent,/Загружаем/);
  f.parse.resolve([{article:'sku',cost_price:380}]);await tick();
  assert.equal(f.button.disabled,true,'keep progress visible until server saves');
  f.save.resolve(1);await pending;
  assert.deepEqual(f.calls.slice(1),['costs','dashboard','journal']);
  assert.equal(f.button.disabled,false);
  assert.equal(f.button.attrs['aria-busy'],undefined);
  assert.equal(f.button.innerHTML,'Import <svg></svg>');
}
{
  const f=fixture(),pending=f.start();
  f.state.shop={id:'shop-b',name:'Другой магазин'};f.state.reportMarketplace='ozon';
  f.parse.resolve([{article:'sku',cost_price:380}]);await tick();
  assert.equal(f.calls[0][0],'shop-a','a shop switch during parsing cannot redirect the import');
  assert.equal(f.calls[0][1],'wildberries','the journal retains the initial marketplace');
  f.save.resolve(1);await pending;
  assert.equal(f.calls.length,1,'do not repaint a different shop after a delayed save');
  assert.match(f.toasts[0][0],/Агава/);
}
{
  const f=fixture(),pending=f.start();
  f.parse.resolve([{article:'sku',cost_price:380}]);await tick();
  f.save.reject({code:'57014',message:'statement timeout'});await pending;
  assert.equal(f.button.disabled,false);
  assert.equal(f.toasts[0][1],true);
  assert.match(f.toasts[0][0],/цены не были изменены/);
  assert.equal(f.calls.length,1,'no success refresh after failed atomic save');
}
{
  const f=fixture();
  f.state.refreshCostsTable=async()=>{throw {code:'57014',message:'read timed out'};};
  const pending=f.start();f.parse.resolve([{article:'sku',cost_price:380}]);await tick();
  f.save.resolve(1);await pending;
  assert.match(f.toasts[0][0],/Себестоимость сохранена/,'a later read failure must not claim the committed save was rolled back');
  assert.equal(f.button.disabled,false);
}

// Count/log actual logical articles returned by the real upload entry point.
const writes=[],logs=[],appWindow={};
vm.runInNewContext(readFileSync(new URL('../assets/dashboard.js',import.meta.url),'utf8'),{window:appWindow,Intl,Map,Set,WeakMap,Date});
appWindow.supabaseClient={
  rpc:async(name,args)=>{writes.push(args);return {data:477,error:null};},
  from(){const q={select(){return q;},eq(){return q;},order(){return q;},range(){return q;},
    then(ok,bad){return Promise.resolve({data:[],error:null}).then(ok,bad);},
    async insert(row){logs.push(row);return {error:null};}};return q;},
};
vm.runInNewContext(readFileSync(new URL('../assets/upload.js',import.meta.url),'utf8'),{window:appWindow,Map,Date,console});
const rows=Array.from({length:690},(_,n)=>({article:`sku-${n%477+1}`,cost_price:n+1}));
assert.equal(await appWindow.WBUpload.importCosts('shop-a','wildberries',rows,'costs.xlsx'),477);
assert.equal(writes.length,1,'the file remains one atomic RPC, not independently committed chunks');
assert.equal(logs[0].row_count,477);
assert.equal(logs[0].articles.length,477);
assert.equal(logs[0].shop_id,'shop-a');
console.log('Cost import: PASS (busy state, original shop, timeout recovery, unique saved count/journal).');
