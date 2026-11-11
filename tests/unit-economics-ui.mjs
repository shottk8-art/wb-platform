import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../assets/unit-economics.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(warm=false){
 const nodes=new Map(),requests=[],timers=[],listeners=[];let clock=Date.parse('2026-11-11T12:00:00Z');
 class Clock extends Date{static now(){return clock;}}
 const el=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',dataset:{},attrs:{},events:{},hidden:false,disabled:false,classList:{toggle(){}},getAttribute(k){return this.attrs[k];},removeAttribute(k){delete this.attrs[k];},setAttribute(k,v){this.attrs[k]=v;},replaceChildren(){this.innerHTML='';this.textContent='';},querySelectorAll:()=>[],addEventListener(event,cb){this.events[event]=cb;}});return nodes.get(id);};
 const window={WBDaily:{allowed:(u,s)=>u==='owner'&&s==='toplash'},WBApi:{connected:warm,subscribe:cb=>listeners.push(cb),cabinet(action,month,refresh,payload){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});requests.push({action,month,payload,resolve,reject});return promise;}}};
 vm.runInNewContext(source,{window,document:{getElementById:el,hidden:false,addEventListener(){}},Intl,Map,Date:Clock,Number,setTimeout:cb=>{timers.push(cb);return timers.length;},clearTimeout(){}});
 return {el,requests,timers,advance:ms=>clock+=ms,invalidate:()=>listeners.forEach(cb=>cb()),set:(active=true,userId='owner',shopId='toplash')=>window.WBUnit.setContext({active,userId,shopId})};
}
const result=()=>({status:'ready',period:{dateFrom:'2026-11-01',dateTo:'2026-11-11'},totals:{sales:'100',net_profit:'40',margin:40,profitability:66.67},products:[{article:'SKU',name:'Название <b>',quantity:2,sales:'100',total_expenses:'60',net_profit:'40',margin:40,profitability:66.67,expenses:[{label:'Себестоимость',amount:'60'}]}],common_expenses:[{key:'media',label:'WB Медиа',amount:'20'}]});
{
 const f=fixture();f.set(false);f.set(true,'other');f.set(true,'owner','other-shop');assert.equal(f.requests.length,0,'only active owner/TOPLASH requests data');
 f.set();assert.equal(f.requests.length,1);assert.equal(f.requests[0].action,'unit');
 f.requests[0].resolve(result());await tick();assert.equal(f.el('unitResults').hidden,false);assert.match(f.el('unitRows').innerHTML,/Название &lt;b&gt;/);assert.match(f.el('unitProfit').textContent,/40/);assert.match(f.el('unitCommon').innerHTML,/20,00/);
 f.set(false);assert.equal(f.el('unitResults').hidden,true);assert.equal(f.el('unitProfit').textContent,'—');assert.equal(f.timers.length,0,'complete data never polls');
}
{
 const f=fixture();f.set();f.set(true,'owner','other-shop');f.requests[0].resolve(result());await tick();assert.equal(f.el('unitResults').hidden,true,'late response cannot paint another shop');
}
{
 const f=fixture();f.set();f.el('unitFrom').value='2026-10';f.el('unitFrom').events.change();f.requests[0].resolve(result());await tick();assert.equal(f.el('unitResults').hidden,true,'changing either range bound clears stale data immediately');
 assert.equal(f.el('unitLoad').disabled,false,'cancelling a pending read restores the explicit Show action');assert.equal(f.el('unitPane').attrs['aria-busy'],'false');
 f.el('unitTo').value='2026-11';f.el('unitLoad').events.click();assert.equal(f.requests[1].month,'2026-10');assert.equal(f.requests[1].payload.month_to,'2026-11');
 f.requests[1].reject(Error('Offline'));await tick();assert.equal(f.el('unitStatus').dataset.error,'true');assert.equal(f.el('unitLoad').disabled,false);
 f.el('unitFrom').value='2026-11';f.el('unitTo').value='2026-10';f.el('unitLoad').events.click();assert.equal(f.requests.length,2);assert.match(f.el('unitStatus').textContent,/Начало периода/);
}
{
 const f=fixture();f.set();const first=result();first.products[0].missing_costs=true;f.requests[0].resolve(first);await tick();
 assert.equal(f.el('unitDetailMissing').hidden,false);assert.match(f.el('unitUnitNotice').textContent,/Суммы/);
 f.el('unitLoad').events.click();const empty=result();empty.products=[];f.requests[1].resolve(empty);await tick();
 assert.equal(f.el('unitDetailTitle').textContent,'Нет операций по артикулам');assert.equal(f.el('unitUnitNotice').textContent,'');assert.equal(f.el('unitDetailMissing').hidden,true);assert.equal(f.el('unitDetailMissing').textContent,'');
}
{
 const f=fixture();f.set();f.requests[0].resolve({status:'needs_preparation',pending:[{month:'2026-10',status:'needs_preparation'},{month:'2026-11',status:'loading'}]});await tick();assert.equal(f.el('unitPrepare').hidden,false);
 f.el('unitPrepare').events.click();f.el('unitPrepare').events.click();assert.equal(f.requests.length,2);assert.equal(f.requests[1].action,'daily_start');assert.equal(f.requests[1].month,'2026-10','prepare only selected missing months, no duplicate active jobs');
 f.requests[1].resolve({});await tick();assert.equal(f.requests[2].action,'unit');f.requests[2].resolve({status:'loading',pending:[{month:'2026-10',status:'loading'}]});await tick();assert.equal(f.timers.length,1);
 f.set(false);f.timers[0]();assert.equal(f.requests.length,3,'inactive views never poll');
}
console.log('Unit UI PASS: private active context, stale shop/range responses, direct/common separation, escaped product labels, explicit range reads, preparation deduplication, retry and bounded polling.');
{
 const f=fixture(true);f.set(false,'other');f.set(false,'owner','other-shop');assert.equal(f.requests.length,0,'warm-up must respect the same private user/shop boundary');
 f.set(false);assert.deepEqual(f.requests.map(r=>r.month),['2026-11','2026-10']);assert.ok(f.requests.every(r=>r.action==='unit'),'prefetch only reads saved data, never queues WB requests');
 f.set();assert.equal(f.requests.length,2,'opening joins the warm-up promise');
 const previous=result();previous.period={dateFrom:'2026-10-01',dateTo:'2026-10-31'};previous.totals.net_profit='10';
 f.requests[0].resolve(result());f.requests[1].resolve(previous);await tick();assert.equal(f.el('unitResults').hidden,false);
 f.set(false);f.set();await tick();assert.equal(f.requests.length,2,'reopening uses ready data immediately');assert.equal(f.el('unitResults').hidden,false);
 f.el('unitFrom').value=f.el('unitTo').value='2026-10';f.el('unitFrom').events.change();
 f.set(false);f.set();await tick();assert.equal(f.requests.length,2,'previous month was also preloaded');assert.match(f.el('unitProfit').textContent,/10/);
 f.set(false);f.advance(60001);f.set();await tick();assert.equal(f.requests.length,3,'only the current month expires after1minute; closed month remains warm');
 f.requests[2].resolve(result());await tick();f.invalidate();assert.equal(f.requests.length,5,'source/catalogue/tax changes invalidate both warm months');
 const updated=result();updated.totals.net_profit='30';f.requests[3].resolve(result());f.requests[4].resolve(updated);await tick();assert.equal(f.el('unitResults').hidden,false);assert.match(f.el('unitProfit').textContent,/30/,'source changes repaint updated calculations, not old cached figures');
}
{
 const f=fixture(true);f.advance(Date.parse('2027-01-01T12:00:00Z')-Date.parse('2026-11-11T12:00:00Z'));f.set(false);
 assert.deepEqual(f.requests.map(r=>r.month),['2027-01','2026-12'],'the two-month window rolls across the year boundary');
}
{
 const f=fixture(true);f.set(false);f.set(false,'owner','other-shop');f.requests[0].resolve(result());f.requests[1].resolve(result());await tick();
 f.set();assert.equal(f.requests.length,4,'late warm-up responses cannot enter the next shop/user cache');
}
console.log('Unit preloading PASS: current+previous month, same-scope promise dedupe, instant reopen, expiry, source invalidation and no WB writes.');

{
 const f=fixture();f.set();const r=result();r.totals.internal_ads='10';r.totals.drr=10;Object.assign(r.products[0],{internal_ads:'10',drr:10});
 f.requests[0].resolve(r);await tick();assert.match(f.el('unitAds').textContent,/10/);assert.equal(f.el('unitDrr').textContent,'10%');assert.match(f.el('unitRows').innerHTML,/Внутренняя реклама/);assert.match(f.el('unitRows').innerHTML,/data-label="ДРР"/);assert.equal(f.el('unitDetailDrr').textContent,'10%');
 f.el('unitShowAll').events.click();assert.equal(f.el('unitShowAll').attrs['aria-expanded'],'true');f.el('unitShowAll').events.click();assert.equal(f.el('unitShowAll').attrs['aria-expanded'],'false');
 f.el('unitLoad').events.click();const u=result();u.products[0].advertising_unknown=true;u.products[0].internal_ads=null;u.products[0].drr=null;u.products[0].net_profit=null;f.requests[1].resolve(u);await tick();assert.equal(f.el('unitAdNotice').hidden,false);assert.match(f.el('unitAdNotice').textContent,/промобонусов/);assert.equal(f.el('unitDetailDrr').textContent,'—');
 f.el('unitLoad').events.click();u.products=[];f.requests[2].resolve(u);await tick();assert.equal(f.el('unitAdNotice').hidden,true);assert.equal(f.el('unitDetailDrr').textContent,'—');
}
console.log('Article ads UI PASS: cash advertising and DRR, expandable columns, explicit uncertain attribution and cleared empty state.');

{
 const f=fixture();f.el('unitSort').value='sales';f.set();const r=result();
 r.products=[{...r.products[0],article:'A',name:'Alpha',sales:'100',net_profit:'40',internal_ads:'10',expenses:[{label:'Логистика',amount:'10'},{label:'Хранение',amount:'0'},{label:'Неизвестный расход',amount:null}]},{...r.products[0],article:'B',name:'Beta',sales:'50',net_profit:'-5',internal_ads:'0',expenses:[]}];
 f.requests[0].resolve(r);await tick();
 assert.equal(f.el('unitSegmentCountAll').textContent,2);assert.equal(f.el('unitSegmentCountGain').textContent,1);assert.equal(f.el('unitSegmentCountLoss').textContent,1);assert.equal(f.el('unitSegmentCountAds').textContent,1);
 assert.match(f.el('unitExpenses').innerHTML,/data-zero="true"/);assert.match(f.el('unitExpenses').innerHTML,/Неизвестный расход/);assert.equal(f.el('unitZeroCosts').hidden,false);
 f.el('unitZeroCosts').events.click();assert.equal(f.el('unitZeroCosts').attrs['aria-expanded'],'true');assert.match(f.el('unitZeroCosts').textContent,/Скрыть/);
 f.el('unitSegments').events.click({target:{closest:()=>({dataset:{unitSegment:'loss'}})}});
 assert.match(f.el('unitRows').innerHTML,/Beta/);assert.doesNotMatch(f.el('unitRows').innerHTML,/Alpha/);assert.equal(f.el('unitDetailArticle').textContent,'B','the detail follows the visible filtered selection');assert.equal(f.el('unitSegmentTitle').textContent,'Убыточные товары');assert.equal(f.el('unitZeroCosts').hidden,true);
 f.el('unitSegments').events.click({target:{closest:()=>({dataset:{unitSegment:'all'}})}});
 f.el('unitTable').events.click({target:{closest:()=>({dataset:{unitSort:'sales'}})}});
 assert.ok(f.el('unitRows').innerHTML.indexOf('Beta')<f.el('unitRows').innerHTML.indexOf('Alpha'),'header toggles to ascending');
 f.el('unitTable').events.click({target:{closest:()=>({dataset:{unitSort:'sales'}})}});
 assert.ok(f.el('unitRows').innerHTML.indexOf('Alpha')<f.el('unitRows').innerHTML.indexOf('Beta'),'second click toggles back');
 f.el('unitSearch').value='does-not-exist';f.el('unitSearch').events.input();assert.equal(f.el('unitDetail').hidden,true,'empty search never leaves an unrelated product detail visible');
 f.el('unitSearch').value='';f.el('unitSearch').events.input();assert.equal(f.el('unitDetail').hidden,false);
 let focused=0,scrolled=0,back=0;f.el('unitPane').getBoundingClientRect=()=>({width:390});f.el('unitDetail').focus=()=>focused++;f.el('unitDetail').scrollIntoView=()=>scrolled++;
 f.el('unitRows').events.click({target:{closest:()=>({dataset:{unitArticle:'A'}})}});assert.equal(focused,1);assert.equal(scrolled,1,'narrow selection moves to the expense detail');
 f.el('unitRows').querySelectorAll=()=>[{dataset:{unitArticle:'A'},setAttribute(){},focus:()=>back++}];f.el('unitBackToTable').events.click();assert.equal(back,1,'return action restores the selected row focus');
 f.el('unitPane').getBoundingClientRect=()=>({width:1300});f.el('unitRows').events.click({target:{closest:()=>({dataset:{unitArticle:'A'}})}});assert.equal(scrolled,1,'wide side-by-side detail never jumps the page');
 assert.equal(f.requests.length,1,'filter, sort and detail controls do not call WB or the server');
}
console.log('Customers-style workspace PASS: counted segments, matching detail, ascending/descending column sort, explicit zero/unknown expenses, empty search, narrow detail/back focus, no wide jumps and zero interaction requests.');
