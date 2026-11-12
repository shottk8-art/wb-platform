import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../assets/stocks.js',import.meta.url),'utf8');
const owner='bbb002c4-cd7a-490d-b9c0-72aed5424261',shop='853b81a0-e0e2-4195-bc80-1cdc362af946';
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(){
 const nodes=new Map(),requests=[],events={},timers=[];let sourceListener;
 const el=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,dataset:{},attrs:{},events:{},style:{},setAttribute(k,v){this.attrs[k]=v},getAttribute(k){return this.attrs[k]},replaceChildren(){this.innerHTML='';this.textContent=''},querySelectorAll(){return []},addEventListener(k,f){this.events[k]=f},contains(){return false},focus(){this.focused=true},getBoundingClientRect(){return {width:1200,bottom:80,right:1100}}});return nodes.get(id)};
 const api={connected:true,shopId:shop,subscribe:f=>sourceListener=f,cabinet(action,month,refresh,payload){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});requests.push({action,payload,resolve,reject});return promise;}};
 const window={WBApi:api,innerWidth:1280,innerHeight:900,matchMedia:()=>({matches:true}),addEventListener(){},getSelection:()=>''};
 const document={getElementById:el,hidden:false,addEventListener(k,f){events[k]=f},dispatchEvent(){}};
 vm.runInNewContext(source,{window,document,CustomEvent:class{},requestAnimationFrame:f=>f(),setTimeout:f=>{timers.push(f);return timers.length},clearTimeout(){},Intl,Date,Map,Number});
 return {el,requests,api,events,timers,source:()=>sourceListener(),set:(userId=owner,shopId=shop,active=true)=>window.WBStock.setContext({userId,shopId,active})};
}
const result=()=>({status:'ready',fetched_at:'2026-11-12T06:00:00Z',stale:false,settings:{alert_days:14,target_days:30},inventory:{totals:{quantity:30,products:2,warehouses:1,low:1,out:0,unknown:1},warehouses:[{id:'wb:10',name:'Склад <b>',kind:'wb'}],products:[{nm_id:'1',name:'Товар <b>',article:'SKU',quantity:10,wb:10,seller:0,to_client:3,from_client:2,daily_orders:1,days_left:10,recommended:20,status:'low',warehouses:[{id:'wb:10',quantity:10,to_client:3,from_client:2,sizes:[{id:'11',quantity:10}]}]},{nm_id:'2',name:'Без спроса',article:'X',quantity:20,wb:20,seller:0,to_client:0,from_client:0,daily_orders:0,days_left:null,recommended:null,status:'unknown',warehouses:[]}]}});
{
 const f=fixture();f.set('other');f.set(owner,'other-shop');assert.equal(f.requests.length,0);assert.equal(f.el('stockBell').hidden,true);
 f.api.shopId='other-shop';f.set();assert.equal(f.requests.length,0,'bound API context must match TOPLASH, including rapid switches');
 f.api.shopId=shop;f.source();assert.equal(f.requests.length,1);assert.equal(f.requests[0].action,'stocks');
 f.requests[0].resolve(result());await tick();assert.equal(f.el('stockResults').hidden,false);assert.equal(f.el('stockBellCount').textContent,'1');assert.match(f.el('stockRows').innerHTML,/Товар &lt;b&gt;/);assert.doesNotMatch(f.el('stockRows').innerHTML,/<b>/);
 assert.match(f.el('stockNotificationList').innerHTML,/пополнить ≈ 20/);assert.match(f.el('stockDetailTitle').textContent,/Товар/);
 f.set(owner,shop,false);f.set(owner,shop,true);assert.equal(f.requests.length,1,'view navigation reuses the loaded inventory and does not call WB');
 f.el('stockSearch').value='не существует';f.el('stockSearch').events.input();assert.equal(f.el('stockDetail').hidden,true);assert.match(f.el('stockRows').innerHTML,/Товары не найдены/);
 f.el('stockAlertDays').value='21';f.el('stockAlertDays').events.input();assert.equal(f.el('stockSaveSettings').disabled,false);
 const saving=f.el('stockSettingsForm').events.submit({preventDefault(){}});assert.equal(f.requests.at(-1).action,'stocks_settings');assert.equal(f.requests.at(-1).payload.alert_days,21);
 f.set(owner,'other-shop');f.requests.at(-1).resolve({...result(),settings:{alert_days:21,target_days:30}});await saving;
 assert.equal(f.el('stockResults').hidden,true);assert.equal(f.el('stockBellCount').hidden,true);assert.equal(f.el('stockSettingsStatus').textContent,'','late save cannot paint another shop');
}
{
 const f=fixture();f.set();f.set('other');f.requests[0].resolve(result());await tick();assert.equal(f.el('stockResults').hidden,true,'late stock reads cannot expose previous user data');
}
{
 const f=fixture();f.set();f.requests[0].resolve(result());await tick();f.el('stockRefresh').events.click();f.requests[1].reject(Error('Связь потеряна'));await tick();assert.equal(f.el('stockResults').hidden,false);assert.equal(f.el('stockWarning').hidden,false);assert.match(f.el('stockStatus').textContent,/Последний снимок/);
 f.el('stockAlertDays').value='10';f.el('stockTargetDays').value='5';await f.el('stockSettingsForm').events.submit({preventDefault(){}});assert.equal(f.requests.length,2,'invalid thresholds do not write');
}
{
 const f=fixture();f.set();f.requests[0].resolve({...result(),status:'loading',inventory:null});await tick();assert.equal(f.el('stockResults').hidden,true);assert.equal(f.el('stockBellCount').hidden,true);assert.match(f.el('stockStatus').textContent,/сервере/);
}
{
 const f=fixture(),r=result();r.inventory.products[0]={...r.inventory.products[0],status:'out',quantity:0,orders:0,daily_orders:0,days_left:null,recommended:null};f.set();f.requests[0].resolve(r);await tick();assert.equal(f.el('stockBellCount').hidden,true,'no replenishment alarm for a dormant card with no stock and no orders');assert.match(f.el('stockRows').innerHTML,/Нет в наличии/,'zero-stock cards remain visible in inventory');
}
{
 const f=fixture(),r=result();r.inventory.products.unshift({...r.inventory.products[0],nm_id:'3',name:'Неактивный товар',status:'out',quantity:0,orders:0,daily_orders:0,days_left:null,recommended:null});f.set();f.requests[0].resolve(r);await tick();assert.ok(f.el('stockRows').innerHTML.indexOf('data-stock-row="1"')<f.el('stockRows').innerHTML.indexOf('data-stock-row="3"'),'actionable replenishment appears before dormant zero-stock cards');
}
console.log('Stock UI PASS: exact owner/shop and bound API context, late read/save isolation, count and restock notifications, safe labels, cache on view changes, empty/unknown/loading, retained dated snapshot on error and validated settings.');
