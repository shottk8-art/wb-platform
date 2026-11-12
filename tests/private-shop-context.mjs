import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const start=app.indexOf('  function updateShareBox()'),end=app.indexOf('\n  }',start)+4;
let bound={shopId:'old',allowed:false};const calls=[],nodes=new Map();
const node=id=>{if(!nodes.has(id))nodes.set(id,{dataset:{},style:{}});return nodes.get(id)};
const check=()=>{assert.equal(bound.shopId,'second');assert.equal(bound.allowed,true);calls.push(bound.shopId)};
const ctx=vm.createContext({shop:{id:'second',name:'Second',slug:'second'},session:{user:{id:'Karl'}},activeView:'daily',reportMarketplace:'wildberries',
 document:{getElementById:node,querySelectorAll:()=>[]},location:{origin:'https://test.invalid'},isOwner:()=>true,apiCabinetAllowed:()=>true,
 setActiveView:()=>check(),updateOverviewSource(){},window:{WBApi:{setContext(next){bound=next}},WBApiCabinet:{setContext(){}},WBDaily:{setContext:next=>{if(next.shopId)check()}},WBStock:{setContext:next=>{if(next.shopId)check()}}}});
vm.runInContext(app.slice(start,end)+'\nupdateShareBox();',ctx);
assert.equal(calls.length,3,'opening a private view and both controllers sees the new API shop');
console.log('Private shop context PASS: navigation and private loaders bind the selected API shop before reading.');
