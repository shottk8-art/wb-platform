import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../assets/corbel.js',import.meta.url),'utf8');
function fixture(saved,blocked=false){
  const events=[],writes=[],elements=new Map(),buttons=[];
  const element=()=>({textContent:'',value:'',hidden:false,attrs:{},setAttribute(k,v){this.attrs[k]=v}});
  for(const id of ['profileName','profileTelegram','profileRole','profileTelegramLink'])elements.set(id,element());
  const root={dataset:{}},avatars=[element()],names=[element()];
  const context={document:{documentElement:root,readyState:'complete',getElementById:id=>elements.get(id),querySelector:()=>null,querySelectorAll:selector=>selector==='[data-profile-avatar]'?avatars:selector==='[data-profile-name]'?names:buttons},window:{dispatchEvent:e=>events.push(e)},localStorage:{getItem(){if(blocked)throw Error('unavailable');return saved},setItem(k,v){if(blocked)throw Error('unavailable');writes.push([k,v])}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}}};
  vm.createContext(context);vm.runInContext(source,context);
  return {api:context.window.WBShell,root,events,writes,elements,avatars,names};
}
const f=fixture('dark');
assert.equal(f.root.dataset.theme,'dark');
f.api.applyTheme('light');assert.equal(f.root.dataset.theme,'light');assert.equal(f.writes[0][0],'seller-appearance');assert.equal(f.writes[0][1],'light');assert.equal(f.events[0].type,'seller:themechange');
f.api.applyTheme('invalid');assert.equal(f.writes.length,1);
const privateMode=fixture('dark',true);privateMode.api.applyTheme('dark');assert.equal(privateMode.root.dataset.theme,'dark');
f.api.setProfile({user_metadata:{full_name:'Карл Шотт',telegram_username:'karlshott'}},true);
assert.equal(f.avatars[0].textContent,'КШ');assert.equal(f.elements.get('profileRole').value,'Владелец магазина');assert.equal(f.elements.get('profileTelegramLink').href,'https://t.me/karlshott');
f.api.setProfile({user_metadata:{full_name:'<img onerror=attack>',telegram_username:'javascript:attack'}},false);
assert.equal(f.names[0].textContent,'<img onerror=attack>');assert.equal(f.elements.get('profileTelegramLink').hidden,true);assert.equal(f.elements.get('profileRole').value,'Участник магазина');
for(const file of ['app.html','index.html','admin.html']){const html=readFileSync(new URL('../'+file,import.meta.url),'utf8');assert.match(html,/assets\/corbel.css/);assert.match(html,/assets\/corbel.js/);assert.doesNotMatch(html,/fonts.googleapis.com/)}
console.log('Appearance: PASS (both themes, persistence, blocked storage, account identity, link safety, shared surfaces; no network).');
