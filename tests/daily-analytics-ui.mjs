import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {DAILY_USER_ID} from '../supabase/functions/wb-api/daily-access.ts';
const DAILY_SHOP_ID='853b81a0-e0e2-4195-bc80-1cdc362af946';
const source=readFileSync(new URL('../assets/daily-analytics.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(withChart=false) {
  const nodes=new Map(),requests=[],timers=[],charts=[];
  const el=id=>{
    if(!nodes.has(id))nodes.set(id,{hidden:false,textContent:'',innerHTML:'',value:'',attrs:{},dataset:{},events:{},disabled:false,
      setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},
      replaceChildren(){this.innerHTML='';this.textContent='';},querySelectorAll:()=>[],
      addEventListener(event,handler){this.events[event]=handler;}});
    return nodes.get(id);
  };
  const appWindow={addEventListener(){},WBApi:{cabinet(action,month,refresh,payload){const pending=deferred();requests.push({...pending,action,month,payload});return pending.promise;}}};
  if(withChart)appWindow.Chart=class{constructor(canvas,config){charts.push(config);}destroy(){}};
  const state={window:appWindow,document:{getElementById:el,body:{},hidden:false,addEventListener(){}},Intl,Map,Date,
    getComputedStyle:()=>({getPropertyValue:key=>key}),matchMedia:()=>({matches:true}),
    setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length;},clearTimeout(){}};
  vm.runInNewContext(source,state);
  return {api:appWindow.WBDaily,el,requests,timers,charts,context:(active=true,userId=DAILY_USER_ID,shopId=DAILY_SHOP_ID)=>appWindow.WBDaily.setContext({userId,shopId,active})};
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
{
  const f=fixture();f.context();const value=ready();
  value.comparison={status:'needs_preparation',month:'2026-10'};
  f.requests[0].resolve(value);await tick();
  assert.equal(f.el('dailyResults').hidden,false,'missing comparison never hides current data');
  assert.equal(f.el('dailyPreviousLegend').hidden,true);
  assert.equal(f.el('dailyPrepareComparison').hidden,false);
  f.el('dailyPrepareComparison').events.click();
  assert.equal(f.requests[1].action,'daily_start');assert.equal(f.requests[1].month,'2026-10','prepare only the prior month');
  f.requests[1].resolve({});await tick();
  const loading=ready();loading.comparison={status:'loading',month:'2026-10',refreshing:true};
  f.requests[2].resolve(loading);await tick();
  assert.equal(f.el('dailyResults').hidden,false);assert.equal(f.el('dailyPrepareComparison').disabled,true);assert.equal(f.timers.length,1);
}
{
  const f=fixture();f.context();const value=ready();
  value.comparison={status:'ready',month:'2026-10',period:{dateFrom:'2026-10-01',dateTo:'2026-10-01'},change:{amount:'2.34',percent:23.4},average:10,positive_days:1};
  value.days[0].previous_period={date:'2026-10-01',profit:'10.00',change:{amount:'2.34',percent:23.4}};
  value.days[0].previous_day={date:'2026-10-31',profit:'0.00',change:{amount:'12.34',percent:null}};
  f.requests[0].resolve(value);await tick();
  assert.match(f.el('dailyProfitChange').innerHTML,/2,34/);assert.match(f.el('dailyProfitChange').innerHTML,/23,4%/);
  assert.match(f.el('dailyComparisonInfo').textContent,/1 октября/);
  assert.equal(f.el('dailyPreviousLegend').hidden,false);assert.equal(f.el('dailyPrepareComparison').hidden,true);
  assert.match(f.el('dailyRows').innerHTML,/12,34/);assert.match(f.el('dailyDetailChange').innerHTML,/к предыдущему дню/);
}
{
  const f=fixture();f.context();const first=ready();
  first.comparison={status:'ready',refreshing:true,month:'2026-10',period:{dateFrom:'2026-10-01',dateTo:'2026-10-01'},change:{amount:'2.34',percent:23.4},average:10,positive_days:1};
  f.requests[0].resolve(first);await tick();assert.match(f.el('dailyAverageChange').innerHTML,/2,34/);
  f.timers[0].fn();const second=ready();second.comparison={status:'unavailable',error:'Нет данных'};
  f.requests[1].resolve(second);await tick();
  assert.equal(f.el('dailyAverageChange').textContent,'');assert.equal(f.el('dailyPositiveChange').textContent,'','obsolete deltas must be cleared during background updates');
}
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
{
  const f=fixture(true);f.context();const value=ready();
  value.comparison={status:'ready',month:'2026-10'};
  value.days=Array.from({length:3},(_,i)=>({...value.days[0],date:`2026-11-0${i+1}`,cumulative_profit:String(12.34*(i+1)),previous_period:{date:`2026-10-0${i+1}`,profit:i===1?null:'10.00'}}));
  f.requests[0].resolve(value);await tick();
  assert.equal(f.charts[0].data.datasets.length,2);
  assert.deepEqual([...f.charts[0].data.datasets[1].data],[10,null,10]);
  f.el('dailyMode').events.click({target:{closest:()=>({dataset:{dailyMode:'cumulative'}})}});
  assert.deepEqual([...f.charts[1].data.datasets[1].data],[10,null,null],'cumulative comparison never bridges a missing day');
  assert.equal(f.charts[1].options.animation,false,'reduced motion is respected for both series');
}
assert.match(html,/id="dailyAnalyticsLink" hidden/);
assert.match(html,/view === 'daily' && !window.WBDaily\?\.allowed/,'a manually entered fragment cannot open a private screen');
assert.match(readFileSync(new URL('../assets/reference.js',import.meta.url),'utf8'),/!link.hidden &&/,'hidden navigation is also excluded from the finder');
console.log('Daily UI: PASS (exact user/shop, zero inactive requests, stale responses, reset, read retry, background loading, double-click guard, hidden finder).');

{
 const f=fixture(),second='63175e7a-5b26-425e-893f-68889b32f02f';
 f.context();f.context(true,DAILY_USER_ID,second);assert.equal(f.requests.length,2);
 f.requests[0].resolve(ready());await tick();assert.equal(f.el('dailyProfit').textContent,'—');
 f.requests[1].resolve(ready());await tick();assert.equal(f.el('dailyResults').hidden,false);
 f.context(true,'member',second);assert.equal(f.el('dailyAnalyticsLink').hidden,true);
}

{
 const f=fixture();f.context();
 f.el('advancedScope').events.click({target:{closest:()=>({dataset:{advancedScope:'ozon'}})}});
 assert.equal(f.requests[1].action,'ozon_months');assert.equal(f.requests[1].payload.marketplace,'ozon');
 f.requests[0].resolve(ready());await tick();assert.equal(f.el('dailyResults').hidden,true,'late WB response is discarded after selecting Ozon');
 f.requests[1].resolve({months:['2026-10','2026-09']});await tick();assert.equal(f.requests[2].month,'2026-10');assert.equal(f.requests[2].payload.marketplace,'ozon');
 f.requests[2].resolve({...ready(),marketplace:'ozon'});await tick();assert.match(f.el('dailyStatus').textContent,/Ozon/);
 f.el('dailyRefresh').events.click();assert.equal(f.requests[3].action,'daily','Ozon refresh reads a report aggregate, never daily_start');
 f.el('advancedScope').events.click({target:{closest:()=>({dataset:{advancedScope:'wildberries'}})}});assert.equal(f.el('dailyResults').hidden,true);assert.equal(f.requests[4].payload.marketplace,undefined);
 f.requests[3].resolve({...ready(),monthly_profit:'999'});await tick();assert.equal(f.el('dailyProfit').textContent,'—');
}
console.log('Ozon daily UI PASS: source switch clears data, stale WB/Ozon reads rejected, report months selected, Ozon refresh never starts WB.');
