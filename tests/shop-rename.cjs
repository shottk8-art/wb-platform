const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {create}=require('../assets/shop-name.js');
const authSource=fs.readFileSync('assets/auth.js','utf8');
const A={id:'shop-a',owner_id:'owner',name:'Магазин A',slug:'original-link',tax_rate:6},B={...A,id:'shop-b',name:'Магазин B'};
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};};
function authFixture({signedIn=true,denied=false}={}){
  const calls=[];
  const client={auth:{getSession:async()=>({data:{session:signedIn?{user:{id:'owner'}}:null}})},from(table){calls.push(['from',table]);const q={update(value){calls.push(['update',value]);return q;},eq(k,v){calls.push(['eq',k,v]);return q;},select(value){calls.push(['select',value]);return q;},single:async()=>denied?{data:null,error:{code:'PGRST116'}}:{data:{id:A.id,owner_id:A.owner_id,name:'Новое имя'},error:null}};return q;}};
  const context={window:{supabaseClient:client}};vm.createContext(context);vm.runInContext(authSource,context);
  return{api:context.window.WBAuth,calls};
}
function ui({rename=async(id,name)=>({id,name,owner_id:'owner'}),onSaved=()=>{}}={}){
  const el=()=>({value:'',disabled:false,readOnly:false,textContent:'',dataset:{},attrs:{},events:{},addEventListener(type,fn){this.events[type]=fn;},setAttribute(k,v){this.attrs[k]=v;},setCustomValidity(){},focus(){}});
  const form=el(),input=el(),button=el(),status=el(),hint=el();
  const controller=create({form,input,button,status,hint,rename,onSaved});
  return{controller,form,input,button,status,hint,type(value){input.value=value;input.events.input();},save:()=>form.events.submit({preventDefault(){}})};
}
(async()=>{
  const auth=authFixture();await auth.api.renameShop(A.id,'  Новое имя  ');
  assert.deepEqual(JSON.parse(JSON.stringify(auth.calls.find(c=>c[0]==='update')[1])),{name:'Новое имя'});
  assert(auth.calls.some(c=>c[0]==='eq'&&c[1]==='id'&&c[2]===A.id));
  assert(auth.calls.some(c=>c[0]==='eq'&&c[1]==='owner_id'&&c[2]==='owner'));
  const empty=authFixture();for(const value of ['', '  ', 'x'.repeat(81),null,{}])await assert.rejects(()=>empty.api.renameShop(A.id,value));assert.equal(empty.calls.length,0);
  const guest=authFixture({signedIn:false});await assert.rejects(()=>guest.api.renameShop(A.id,'Название'));assert.equal(guest.calls.length,0);
  await assert.rejects(()=>authFixture({denied:true}).api.renameShop(A.id,'Название'));

  const writes=[],saved=[],f=ui({rename:async(id,name)=>{writes.push([id,name]);return{id,name,owner_id:'owner'};},onSaved:(shop,userId)=>saved.push([shop,userId])});
  f.controller.setContext({shop:A,userId:'owner'});assert(f.button.disabled);assert.equal(f.input.value,A.name);
  f.type('   ');assert(f.button.disabled);f.type('x'.repeat(81));assert(f.button.disabled);
  f.type('  Новое имя  ');assert(!f.button.disabled);await f.save();
  assert.deepEqual(writes,[[A.id,'Новое имя']]);assert.equal(f.input.value,'Новое имя');assert(f.button.disabled);assert.equal(saved[0][1],'owner');assert.match(f.status.textContent,/сохранено/);
  await f.save();assert.equal(writes.length,1,'unchanged name makes no request');
  f.type('Другое');f.controller.setContext({shop:{...A,name:'Новое имя'},userId:'owner'});assert.equal(f.input.value,'Другое','unrelated same-shop refresh preserves a draft');
  f.controller.setContext({shop:A,userId:'member'});assert(f.input.readOnly);assert(f.button.hidden);await f.save();assert.equal(writes.length,1,'member cannot submit');
  f.controller.setContext(null);assert.equal(f.input.value,'');assert(f.input.disabled);assert(f.button.disabled);

  const pending=deferred(),r=ui({rename:()=>pending.promise});r.controller.setContext({shop:A,userId:'owner'});r.type('Новое A');const saving=r.save();
  assert(r.input.disabled);assert(r.button.disabled);await r.save();r.controller.setContext({shop:B,userId:'owner'});
  pending.resolve({...A,name:'Новое A'});await saving;assert.equal(r.input.value,B.name);assert.equal(r.status.textContent,'','late success never leaks into another shop');
  const failure=ui({rename:async()=>{throw Error('offline');}});failure.controller.setContext({shop:A,userId:'owner'});failure.type('Повторить');await failure.save();assert.equal(failure.input.value,'Повторить');assert(!failure.button.disabled);assert.equal(failure.status.dataset.tone,'error');

  const app=fs.readFileSync('app.html','utf8'),start=app.indexOf('  function applyShopRename('),end=app.indexOf('  function scopeLabel()',start);
  assert(start>0&&end>start);const options=[{value:A.id,textContent:A.name},{value:B.id,textContent:B.name}],apiNames=[];
  const state={shop:{...B},session:{user:{id:'owner'}},document:{getElementById:()=>({options})},window:{WBApi:{setShopName:(id,name)=>apiNames.push([id,name])}}};
  vm.createContext(state);vm.runInContext(app.slice(start,end),state);
  state.applyShopRename({...A,name:'Новое A'},'owner');assert.equal(options[0].textContent,'Новое A');assert.equal(state.shop.name,B.name);assert.equal(apiNames.length,0);
  state.shop={...A};state.applyShopRename({...A,name:'Новое A'},'owner');assert.equal(state.shop.name,'Новое A');assert.equal(state.shop.slug,A.slug);assert.equal(state.shop.tax_rate,A.tax_rate);assert.deepEqual(apiNames,[[A.id,'Новое A']]);

  // Renaming changes the selected connection's label, not its status or data.
  const apiElements=new Map(),apiElement=id=>{if(!apiElements.has(id))apiElements.set(id,{value:'',textContent:'',dataset:{},addEventListener(){}});return apiElements.get(id);};
  let networkCalls=0;
  const apiState={window:{WBAuth:{getSession:async()=>({access_token:'fixture'})},WB_CONFIG:{SUPABASE_URL:'https://fixture.invalid',SUPABASE_ANON_KEY:'fixture'}},document:{getElementById:apiElement},AbortSignal,fetch:async()=>{networkCalls++;return{ok:true,json:async()=>({connection:{seller_name:'Seller'}})};}};
  vm.createContext(apiState);vm.runInContext(fs.readFileSync('assets/wb-api.js','utf8'),apiState);
  const api=apiState.window.WBApi;await api.setContext({shopId:A.id,name:A.name,allowed:true,manage:true});assert(api.connected);
  const before=networkCalls;api.setShopName(B.id,'Не выбран');assert.equal(apiElement('wbApiShopName').textContent,A.name);
  api.setShopName(A.id,'Новое A');assert.equal(apiElement('wbApiShopName').textContent,'Новое A');assert(api.connected);assert.equal(networkCalls,before,'rename never reloads API status or financial data');
  console.log('Shop rename: PASS (name-only update, owner/id filters, validation, dirty/save states, member/guest, retry, stale shops and unchanged slug/tax).');
})().catch(error=>{console.error(error);process.exitCode=1;});
