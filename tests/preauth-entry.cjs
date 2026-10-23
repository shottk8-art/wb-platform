// The real entry page now opens Telegram directly; old drafts are inert.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const source=html.match(/<script>\s*(\(function \(\) \{[\s\S]*?\}\)\(\);)\s*<\/script>/)?.[1];
assert(source);
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function setup({session=null,search='',pathname='/index.html',fail=false,sessionFail=false}={}){
  const nodes=new Map(),calls=[];
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{id,hidden:true,textContent:'',className:'',children:[],events:{},
      addEventListener(type,fn){this.events[type]=fn;},focus(){},
      setAttribute(key,value){this[key]=value;},
      querySelector(selector){return selector==='script'?this.children.find(n=>n.tagName==='script')||null:null;},
      appendChild(child){this.children.push(child);},
    });return nodes.get(id);
  };
  const window={WBAuth:{
    getSession:async()=>{if(sessionFail)throw Error('Session unavailable');return session;},
    signInWithTelegram:async()=>{calls.push('verify-login');if(fail)throw Error('Fixture login failed');return{user:{id:'confirmed-user'}};},
  },supabaseClient:{from(table){calls.push(['table',table]);const q={select(){return q;},eq(k,v){calls.push([k,v]);return q;},maybeSingle:async()=>({data:null,error:null})};return q;}}};
  for(const feature of ['WBClientStart','WBOnboardingDraft','WBTestSubscription'])Object.defineProperty(window,feature,{get(){throw Error('Disabled feature read: '+feature);}});
  const state={window,document:{getElementById:node,querySelector:node,createElement:tag=>({...node('created-'+tag),tagName:tag})},
    location:{search,pathname,href:''},URLSearchParams,console:{error(){}},setTimeout:fn=>fn(),Date,Promise};
  vm.createContext(state);vm.runInContext(source,state);
  return{state,calls,node};
}
(async()=>{
  const guest=setup();await flush();
  assert.equal(guest.node('authScreen').hidden,false,'guest sees Telegram immediately');
  assert.equal(guest.node('loadingScreen').hidden,true);
  assert.equal(guest.node('telegramLoginBox').children.length,1);
  await guest.state.window.onTelegramAuth({});
  assert.equal(guest.state.location.href,'/app.html');assert.deepEqual(guest.calls,['verify-login']);
  const failed=setup({fail:true});await flush();await failed.state.window.onTelegramAuth({});
  assert.equal(failed.state.location.href,'');assert.match(failed.node('authMsg').textContent,/Fixture login failed/);
  const unavailable=setup({sessionFail:true});await flush();
  assert.equal(unavailable.node('authScreen').hidden,false);assert.equal(unavailable.node('telegramLoginBox').children.length,1);
  const existing=setup({session:{user:{id:'owner'}}});await flush();
  assert.equal(existing.state.location.href,'/app.html');assert.equal(existing.node('telegramLoginBox').children.length,0);
  for(const route of [{search:'?shop=disabled-shop'},{pathname:'/s/disabled-shop'}]){
    const publicView=setup(route);await flush();
    assert(publicView.calls.some(c=>Array.isArray(c)&&c[0]==='share_enabled'&&c[1]===true));
    assert.equal(publicView.node('telegramLoginBox').children.length,1,'disabled public links retain login fallback');
  }
  for(const file of ['index.html','app.html']){
    const page=fs.readFileSync(file,'utf8');
    assert(!/WBClientStart|WBOnboardingDraft|WBTestSubscription|firstSetup|onboardingIntent/.test(page));
    assert(!/src="\/assets\/(test-subscription|onboarding-draft|welcome-preview|client-start)\.js/.test(page));
    assert(!/id="(clientWelcome|clientGuide|testBillingRoot|showClientGuide|backToOnboarding)"/.test(page));
    assert(!/href="\/assets\/client-start\.css/.test(page));
  }
  console.log('Direct entry: PASS (Telegram first, session redirect, retry/error, public links and no onboarding/billing runtime).');
})().catch(error=>{console.error(error);process.exitCode=1;});
