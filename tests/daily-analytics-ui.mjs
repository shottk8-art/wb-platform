import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {DAILY_SHOP_ID,DAILY_USER_ID} from '../supabase/functions/wb-api/daily-access.ts';
const source=readFileSync(new URL('../assets/daily-analytics.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture() {
  const nodes=new Map(),requests=[],timers=[];
  const el=id=>{
    if(!nodes.has(id))nodes.set(id,{hidden:false,textContent:'',innerHTML:'',value:'',attrs:{},dataset:{},events:{},disabled:false,
      setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},
      replaceChildren(){this.innerHTML='';this.textContent='';},querySelectorAll:()=>[],
      addEventListener(event,handler){this.events[event]=handler;}});
    return nodes.get(id);
  };
  const appWindow={addEventListener(){},WBApi:{cabinet(action,month){const pending=deferred();requests.push({...pending,action,month});return pending.promise;}}};
  const state={window:appWindow,document:{getElementById:el,hidden:false,addEventListener(){}},Intl,Map,Date,
    setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length;},clearTimeout(){}};
  vm.runInNewContext(source,state);
  return {api:appWindow.WBDaily,el,requests,timers,context:(active=true,userId=DAILY_USER_ID,shopId=DAILY_SHOP_ID)=>appWindow.WBDaily.setContext({userId,shopId,active})};
}
const ready=()=>({status:'ready',period:{dateFrom:'2026-11-01',dateTo:'2026-11-01'},monthly_profit:'12.34',updated_at:null,
  days:[{date:'2026-11-01',rows:1,sales:'100.00',net_profit:'12.34',cumulative_profit:'12.34',expenses:[{key:'cogs',label:'Себестоимость',amount:'87.66'}],missing:[]}],unallocated:null});
{
  const f=fixture();
  f.context(true,'other-user');assert.equal(f.requests.length,0);assert.equal(f.el('dailyAnalyticsLink').hidden,true);
  f.context(true,DAILY_USER_ID,'other-shop');assert.equal(f.requests.length,0);
  f.context(false);assert.equal(f.el('dailyAnalyticsLink').hidden,false);assert.equal(f.requests.length,0,'no daily reads while the screen is closed');
  f.context();assert.equal(f.requests.length,1);assert.equal(f.el('dailyResults').hidden,true);assert.equal(f.el('dailyProfit').textContent,'—');
  f.requests[0].resolve(ready());await tick();
  assert.equal(f.el('dailyResults').hidden,false);assert.match(f.el('dailyProfit').textContent,/12,34/);
  assert.equal(f.timers.length,0,'ready data never polls in the background');
  f.context(false);assert.equal(f.el('dailyResults').hidden,true);assert.equal(f.el('dailyDetailProfit').textContent,'—');
}
{
  const f=fixture();f.context();
  f.context(true,DAILY_USER_ID,'other-shop');f.requests[0].resolve(ready());await tick();
  assert.equal(f.el('dailyResults').hidden,true);assert.equal(f.el('dailyProfit').textContent,'—','a late private response cannot paint another shop');
}
{
  const f=fixture();f.context();
  f.el('dailyMonth').value='2026-10';f.el('dailyMonth').events.change();
  f.requests[0].resolve(ready());await tick();assert.equal(f.el('dailyResults').hidden,true);
  f.requests[1].reject(Error('Offline'));await tick();
  assert.equal(f.el('dailyStatus').dataset.error,'true');assert.equal(f.el('dailyRefresh').disabled,false);
  f.el('dailyRefresh').events.click();assert.equal(f.requests[2].action,'daily','retry a read failure without queuing an unnecessary WB refresh');
}
{
  const f=fixture();f.context();f.requests[0].resolve({status:'needs_preparation',days:[]});await tick();
  assert.match(f.el('dailyStatus').textContent,/месячные итоги/);
  f.el('dailyRefresh').events.click();f.el('dailyRefresh').events.click();
  assert.equal(f.requests.length,2,'double clicks enqueue one snapshot');assert.equal(f.requests[1].action,'daily_start');
  f.requests[1].resolve({});await tick();assert.equal(f.requests[2].action,'daily');
  f.requests[2].resolve({status:'loading',days:[],refreshing:true});await tick();
  assert.equal(f.timers.length,1);assert.equal(f.timers[0].delay,30000);assert.equal(f.el('dailyRefresh').disabled,true);
  f.context(false);f.timers[0].fn();assert.equal(f.requests.length,3,'leaving the screen stops polling');
}
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
assert.match(html,/id="dailyAnalyticsLink" hidden/);
assert.match(html,/view === 'daily' && !window.WBDaily\?\.allowed/,'a manually entered fragment cannot open a private screen');
assert.match(readFileSync(new URL('../assets/reference.js',import.meta.url),'utf8'),/!link.hidden &&/,'hidden navigation is also excluded from the finder');
console.log('Daily UI: PASS (exact user/shop, zero inactive requests, stale responses, reset, read retry, background loading, double-click guard, hidden finder).');
