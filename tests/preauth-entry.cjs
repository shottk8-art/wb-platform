// Run the real index entry/Telegram callback with stub transport, not a real account.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const source=html.match(/<script>\s*(\(function \(\) \{[\s\S]*?\}\)\(\);)\s*<\/script>/)?.[1];
assert(source,'actual index entry must be found');
assert(!html.includes('<script async src="https://telegram.org'),'widget is loaded only when login is opened');
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function setup({session=null,search='',pathname='/index.html',fail=false,publicShop=null}={}){
  const nodes=new Map(),calls=[],storageValues=new Map();let finishOnboarding;
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{id,hidden:true,textContent:'',className:'',children:[],events:{},
      addEventListener(type,fn){this.events[type]=fn;},
      focus(){},
      setAttribute(key,value){this[key]=value;},
      querySelector(selector){return selector==='script'?this.children.find(n=>n.tagName==='script')||null:null;},
      appendChild(child){this.children.push(child);},
    });return nodes.get(id);
  };
  const storage={getItem:k=>storageValues.get(k)||null,setItem:(k,v)=>storageValues.set(k,v),removeItem:k=>storageValues.delete(k)};
  const state={
    window:{sessionStorage:storage,WBAuth:{
      getSession:async()=>session,
      signInWithTelegram:async()=>{calls.push('verify-login');if(fail)throw Error('Fixture login failed');return{user:{id:'confirmed-user'}};},
    },WBClientStart:{firstShop:async user=>{calls.push(['onboarding',user]);return new Promise(resolve=>finishOnboarding=resolve);}},
    supabaseClient:{from(table){calls.push(['table',table]);const q={select(){return q;},eq(k,v){calls.push([k,v]);return q;},maybeSingle:async()=>({data:publicShop,error:null})};return q;}},
    },
    document:{getElementById:node,querySelector:node,createElement:tag=>({...node('created-'+tag),tagName:tag})},
    location:{search,pathname,href:''},URLSearchParams,console:{error(){}},
    setTimeout:fn=>{fn();},Date,Promise,
  };
  vm.createContext(state);vm.runInContext(fs.readFileSync('assets/onboarding-draft.js','utf8'),state);
  vm.runInContext(source,state);
  return{state,calls,node,finish:result=>finishOnboarding(result)};
}
(async()=>{
  const guest=setup();await flush();
  assert.deepEqual(guest.calls,[['onboarding',null]]);
  assert.equal(guest.node('telegramLoginBox').children.length,0,'no login widget on first onboarding screen');
  assert.equal(guest.node('authScreen').hidden,true);
  guest.state.window.WBOnboardingDraft.save({name:'Guest shop',marketplace:'ozon',planId:'team'});
  guest.finish({requiresAuth:true});await flush();
  assert.equal(guest.node('authScreen').hidden,false);
  assert.equal(guest.node('telegramLoginBox').children.length,1);
  assert.equal(guest.node('authLead').textContent,'Войдите, чтобы подтвердить создание магазина.');
  await guest.state.window.onTelegramAuth({});
  assert.equal(guest.state.location.href,'/app.html');
  assert.equal(guest.state.window.WBOnboardingDraft.read('confirmed-user').name,'Guest shop');
  assert.equal(guest.state.window.WBOnboardingDraft.read('different-user'),null);

  const failed=setup({fail:true});await flush();
  failed.state.window.WBOnboardingDraft.save({name:'Retry shop',marketplace:'wildberries'});
  failed.finish({requiresAuth:true});await flush();await failed.state.window.onTelegramAuth({});
  assert.equal(failed.state.location.href,'');
  assert.equal(failed.state.window.WBOnboardingDraft.read().name,'Retry shop','failed login never binds/loses anonymous choices');
  assert.match(failed.node('authMsg').textContent,/Fixture login failed/);
  failed.node('backToOnboarding').events.click();await flush();
  assert.equal(failed.node('authScreen').hidden,true,'Back returns to onboarding');

  const loginOnly=setup();await flush();loginOnly.finish({loginOnly:true});await flush();
  assert.equal(loginOnly.node('authLead').textContent,'Откройте свой кабинет продавца.');
  await loginOnly.state.window.onTelegramAuth({});
  assert.equal(loginOnly.state.window.WBOnboardingDraft.read('confirmed-user'),null);

  const existing=setup({session:{user:{id:'owner'}}});await flush();
  assert.equal(existing.state.location.href,'/app.html');assert.equal(existing.calls.length,0,'existing session skips guest onboarding');

  for(const route of [{search:'?shop=disabled-shop'},{pathname:'/s/disabled-shop'}]){
    const publicView=setup(route);await flush();
    assert(!publicView.calls.some(c=>Array.isArray(c)&&c[0]==='onboarding'),'public slug never runs onboarding');
    assert(publicView.calls.some(c=>Array.isArray(c)&&c[0]==='share_enabled'&&c[1]===true));
    assert.equal(publicView.node('telegramLoginBox').children.length,1,'disabled public link retains working login fallback');
  }
  console.log('Pre-auth entry: PASS (guest first, lazy login, verified-session binding, retry/back, existing user, public routes).');
})().catch(error=>{console.error(error);process.exitCode=1;});
