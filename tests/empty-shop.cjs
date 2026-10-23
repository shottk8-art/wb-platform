const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('app.html','utf8');
const source=html.slice(html.indexOf('  async function refreshShopSwitch()'),html.indexOf('  function applyShopRename('));
const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{dataset:{},hidden:true});return nodes.get(id);};
let available=[];
const state={window:{WBAuth:{listMyShops:async()=>available}},shop:null,activeView:'overview',
  appScreen:node('appScreen'),document:{getElementById:node},escapeHtml:value=>String(value)};
vm.createContext(state);vm.runInContext(source,state);
(async()=>{
  await state.refreshShopSwitch();
  assert.equal(node('shopSwitch').disabled,true);assert.match(node('shopSwitch').innerHTML,/Нет магазинов/);
  assert.equal(node('appScreen').dataset.shopState,'empty');assert.equal(node('emptyShopNotice').hidden,false);
  available=[{id:'created',name:'Новый магазин'}];state.shop=available[0];await state.refreshShopSwitch();
  assert.equal(node('shopSwitch').value,'created');assert.equal(node('shopSwitch').disabled,false);
  assert.equal(node('appScreen').dataset.shopState,'ready');assert.equal(node('emptyShopNotice').hidden,true);
  available=[];state.shop=null;state.activeView='account';await state.refreshShopSwitch();
  assert.equal(node('emptyShopNotice').hidden,true,'profile remains usable without a shop');
  assert.match(html,/id="emptyShopCreateBtn"/);
  assert.match(html,/getElementById\('emptyShopCreateBtn'\)\.addEventListener\('click', \(\) => document\.getElementById\('newShopBtn'\)\.click\(\)\)/);
  console.log('Empty cabinet: PASS (no forced creation, explicit existing create action, shop selector reset and account access).');
})().catch(error=>{console.error(error);process.exitCode=1;});
