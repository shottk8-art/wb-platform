const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/promocodes.js'),'utf8');
const owner='bbb002c4-cd7a-490d-b9c0-72aed5424261';
const tick=()=>new Promise(r=>setImmediate(r));
const response=(isOwner=false,status='ready')=>({owner:isOwner,status,missing_months:status==='ready'?[]:['2026-10'],fetched_at:'2026-11-18T07:00:00Z',rows:status==='ready'?[{promo_id:'10000000-0000-4000-8000-000000000001',historical_ids:['20000000-0000-4000-8000-000000000002'],name:'Promo <unsafe>',code:'SAVE20',sold_qty:2,returned_qty:1,sold_amount:'200.50',returned_amount:'100.25',net_amount:'100.25'}]:[]});
function fixture(id='viewer'){
 const els=new Map(),events={},requests=[];let session={user:{id,user_metadata:{}},access_token:'synthetic'},timer;
 const el=id=>{if(!els.has(id))els.set(id,{value:'',hidden:false,dataset:{},events:{},textContent:'',innerHTML:'',setAttribute(){},addEventListener(k,f){this.events[k]=f},replaceChildren(){this.innerHTML='';},append(){},focus(){},reportValidity(){return true}});return els.get(id)};
 const document={hidden:false,getElementById:el,createElement:()=>({setAttribute(){}}),addEventListener:(k,f)=>events[k]=f};
 const window={WB_CONFIG:{SUPABASE_URL:'https://fixture.invalid',SUPABASE_ANON_KEY:'public'},WBAuth:{getSession:async()=>session,waitForSession:async()=>session},supabaseClient:{auth:{onAuthStateChange(){},signOut:async()=>{session=null}}},matchMedia:()=>({matches:true,addEventListener(){}})};
 const fetch=async(_url,opts)=>new Promise(resolve=>{const body=JSON.parse(opts.body);requests.push({body,resolve:(value,status=200)=>resolve({ok:status<400,status,json:async()=>value})})});
 vm.runInNewContext(source,{window,document,fetch,Intl,Date,Number,String,Error,Promise,AbortSignal,location:{origin:'http://fixture.invalid'},navigator:{clipboard:{writeText:async()=>{}}},setTimeout:fn=>{timer=fn;return 1},clearTimeout:()=>{timer=null}});
 return {el,window,document,requests,events,get timer(){return timer}};
}
(async()=>{
 {
  const f=fixture();await tick();assert.equal(f.requests[0].body.action,'promocodes_read');f.requests[0].resolve(response());await tick();
  assert.equal(f.el('promoMain').hidden,false);assert.equal(f.el('promoManagement').hidden,true);assert.equal(f.el('promoRefresh').hidden,true);assert.equal(f.el('promoCabinetLink').hidden,true);
  assert.match(f.el('promoRows').innerHTML,/Promo &lt;unsafe&gt;/);assert.doesNotMatch(f.el('promoRows').innerHTML,/data-promo-edit/);assert.equal(f.el('promoUnits').textContent,'2');
  f.el('promoSearch').value='missing';f.el('promoSearch').events.input();assert.equal(f.el('promoEmpty').hidden,false);assert.equal(f.el('promoUnits').textContent,'2','search does not change period totals');
  f.el('promoSearch').value='save20';f.el('promoSearch').events.input();assert.equal(f.el('promoEmpty').hidden,true,'the code distinguishes promos sharing a generic name');assert.match(f.el('promoRows').innerHTML,/Код: SAVE20/);
  f.el('promoSearch').value='  20000000-0000-4000-8000-000000000002  ';f.el('promoSearch').events.input();
  assert.equal(f.el('promoEmpty').hidden,true,'ID copied from an older financial report must find the same saved campaign');
  assert.match(f.el('promoRows').innerHTML,/ID в карточке WB: 10000000-0000-4000-8000-000000000001/);
  assert.match(f.el('promoRows').innerHTML,/ID в отчётах WB: 20000000-0000-4000-8000-000000000002/);
  assert.doesNotMatch(f.el('promoRows').innerHTML,/ранни|прежни|старый|новый/i,'linked identifiers do not imply an ID changed over time');
  assert.equal(f.el('promoMatching').textContent,'1','old and current IDs cannot produce duplicate campaign rows');
  assert.equal(f.el('promoUnits').textContent,'2','historical search cannot change period totals');
  f.el('promoSearch').value='30000000-0000-4000-8000-000000000003';f.el('promoSearch').events.input();
  assert.equal(f.el('promoEmpty').hidden,false);assert.match(f.el('promoEmpty').textContent,/отслеживаемом списке/,'empty search explains its catalogue boundary');
  assert.equal(f.requests.length,1,'search and sort are local');
 }
 {
  const f=fixture(owner);await tick();f.requests[0].resolve(response(true,'needs_preparation'));await tick();
  assert.equal(f.requests[1].body.action,'promocodes_start');f.requests[1].resolve(response(true,'loading'));await tick();f.requests[2].resolve({viewers:[]});await tick();
  assert.equal(f.el('promoManagement').hidden,false);assert.equal(f.el('promoUnits').textContent,'—');assert.ok(f.timer);
  f.document.hidden=true;f.events.visibilitychange();assert.equal(f.timer,null);
 }
 {
  const f=fixture();await tick();f.requests[0].resolve({error:'Доступ не выдан'},403);await tick();assert.equal(f.el('promoMain').hidden,true);assert.match(f.el('promoAccessStatus').textContent,/Доступ/);
 }
 {
  const f=fixture();await tick();f.requests[0].resolve({error:'Попробуйте позже'},503);await tick();
  assert.equal(f.el('promoMain').hidden,true,'failed authorization read cannot reveal the main content');
  assert.equal(f.el('promoAccessStatus').hidden,false);assert.equal(f.el('promoAccessStatus').textContent,'Попробуйте позже');
  assert.equal(f.el('promoAccessRetry').hidden,false);assert.equal(f.el('promoAccessRetry').disabled,false);
  f.el('promoAccessRetry').events.click();await tick();assert.equal(f.requests[1].body.action,'promocodes_read');
  f.requests[1].resolve(response());await tick();assert.equal(f.el('promoMain').hidden,false);assert.equal(f.el('promoAccessRetry').hidden,true);
 }
 {
  const f=fixture();await tick();await f.el('promoSignOut').events.click();f.requests[0].resolve(response());await tick();
  assert.equal(f.el('promoMain').hidden,true);assert.equal(f.el('promoLogin').hidden,false);assert.equal(f.el('promoRows').innerHTML,'','late responses cannot restore logged-out data');
 }
 {
  const f=fixture();await tick();f.requests[0].resolve(response());await tick();
  assert.match(f.el('promoSales').title,/200/);await f.el('promoSignOut').events.click();
  f.document.hidden=true;f.events.visibilitychange();
  assert.equal(f.el('promoSales').textContent,'—','visibility changes cannot restore the previous session counters');
  assert.equal(f.el('promoSales').title,'','no previous values remain in hover labels');
 }
 {
  const f=fixture();await tick();f.requests[0].resolve(response(false,'needs_preparation'));await tick();assert.equal(f.requests.length,1,'viewers never start upstream downloads');assert.equal(f.el('promoUnits').textContent,'—');
 }
 {
  const f=fixture(owner);await tick();f.requests[0].resolve(response(true,'needs_catalog'));await tick();f.requests[1].resolve({viewers:[]});await tick();
  assert.equal(f.requests.length,2,'an unconfigured catalogue does not schedule finance downloads');assert.equal(f.el('promoRefresh').disabled,true);assert.equal(f.el('promoUnits').textContent,'—');assert.match(f.el('promoEmpty').textContent,/Добавьте ID/);
 }
 console.log('Promo UI PASS: owner/viewer controls, no automatic viewer writes, real empty/loading/denied states, safe names, local filters, period totals and sign-out race.');
})().catch(e=>{console.error(e);process.exitCode=1});
