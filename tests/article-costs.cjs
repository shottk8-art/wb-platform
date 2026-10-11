const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const window={};
vm.runInNewContext(fs.readFileSync('assets/dashboard.js','utf8'),{window,Intl,Map,Set,WeakMap,Date});
const report={sales_amount:4000,transfer_total:3000};
const rows=[{article:'top-114',bought_qty:2,revenue:4000}];
const d=window.WBDashboard.computeDerived(report,rows,new Map([['Top-114',1160],['top-114',0]]),0);
assert.equal(d.cogs,2320,'a zero placeholder must not hide a saved mixed-case price');
assert.equal(d.netProfit,680);
assert.equal(window.WBDashboard.computeDerived(report,rows,new Map([['other',1160]]),0).cogs,0,'different articles remain distinct');
console.log('Case-insensitive file costs: PASS.');
const requests=[];
window.supabaseClient={
 rpc:async(name,args)=>{requests.push({name,args});return {data:1,error:null};},
 from(table){let shopId;
  const q={select(){return q;},eq(column,value){if(column==='shop_id')shopId=value;return q;},order(){return q;},range(){return q;},
   insert:async()=>({error:null}),delete(){return q;},
   then(ok,bad){const data=shopId==='shop-a'?[{article:'Top-114',cost_price:1160,name:'Товар'},{article:'top-114',cost_price:0}]:[{article:'TOP-114',cost_price:900,name:'Другой магазин'}];return Promise.resolve({data,error:null}).then(ok,bad);}};
  return q;
 }
};
vm.runInNewContext(fs.readFileSync('assets/upload.js','utf8'),{window,Map,Date,console});
(async()=>{
 const catalogue=await window.WBUpload.listCosts('shop-a','wildberries');
 assert.equal(catalogue.length,1,'one visible cost row per article, not per case');
 assert.equal(catalogue[0].cost_price,1160);
 assert.equal((await window.WBUpload.listCosts('shop-b','ozon'))[0].cost_price,900);
 await window.WBUpload.saveCostPrice('shop-a','wildberries','top-114','',1200);
 assert.equal(requests[0].name,'save_cost_prices');
 assert.equal(requests[0].args.p_shop_id,'shop-a');
 await window.WBUpload.importCosts('shop-b','ozon',[{article:'top-114',cost_price:950}],'synthetic.xlsx');
 assert.equal(requests[1].args.p_shop_id,'shop-b');
 assert.equal(requests[1].args.p_rows[0].name,'Другой магазин','case-insensitive imported names remain shop-scoped');
 await window.WBUpload.deleteUpload('shop-a',{id:'test-upload',kind:'costs',articles:['Top-114']});
 assert.equal(requests[2].args.p_rows[0].cost_price,0,'undo also uses the atomic alias-aware save');
 console.log('Case-insensitive cost UI/write paths: PASS (one row, import, save, undo, shop scoping).');
})().catch(error=>{console.error(error);process.exitCode=1;});
