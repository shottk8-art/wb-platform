import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../assets/corbel.js',import.meta.url),'utf8');
function fixture(saved,blocked=false,withButtons=false){
  const events=[],writes=[],elements=new Map(),buttons=[];
  const element=()=>({textContent:'',value:'',hidden:false,attrs:{},dataset:{},handlers:{},setAttribute(k,v){this.attrs[k]=v},getAttribute(k){return this.attrs[k]},querySelector(){return null},addEventListener(k,v){this.handlers[k]=v}});
  const choices=withButtons?['light','dark'].map(theme=>Object.assign(element(),{dataset:{themeChoice:theme}})):[];
  const toggles=withButtons?[element()]:[];
  for(const id of ['profileName','profileTelegram','profileRole','profileTelegramLink'])elements.set(id,element());
  const root={dataset:{}},avatars=[element()],names=[element()];
  const context={document:{documentElement:root,readyState:'complete',getElementById:id=>elements.get(id),querySelector:()=>null,querySelectorAll:selector=>selector==='[data-profile-avatar]'?avatars:selector==='[data-profile-name]'?names:selector==='[data-theme-choice]'?choices:selector==='[data-theme-toggle]'?toggles:buttons},window:{dispatchEvent:e=>events.push(e)},localStorage:{getItem(){if(blocked)throw Error('unavailable');return saved},setItem(k,v){if(blocked)throw Error('unavailable');writes.push([k,v])}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}}};
  vm.createContext(context);vm.runInContext(source,context);
  return {api:context.window.WBShell,root,events,writes,elements,avatars,names,choices,toggles};
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
const rapid=fixture('light',false,true),pending=[];
rapid.api.motion={theme(next,button,commit){pending.push(commit)}};
rapid.choices[1].handlers.click();rapid.choices[0].handlers.click();
pending[0]();assert.equal(rapid.root.dataset.theme,'light','superseded dark callback cannot commit');
pending[1]();assert.equal(rapid.root.dataset.theme,'light','latest light choice survives pending transition');
rapid.toggles[0].handlers.click();rapid.toggles[0].handlers.click();
pending[2]();pending[3]();assert.equal(rapid.root.dataset.theme,'light','two rapid toggles return to initial appearance');
for(const file of ['app.html','index.html','admin.html']){const html=readFileSync(new URL('../'+file,import.meta.url),'utf8');assert.match(html,/assets\/corbel.css/);assert.match(html,/assets\/corbel.js/);assert.doesNotMatch(html,/fonts.googleapis.com/)}
console.log('Appearance: PASS (both themes, persistence, blocked storage, account identity, link safety, shared surfaces; no network).');
