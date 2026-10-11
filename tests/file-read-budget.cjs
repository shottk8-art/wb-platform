const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const costs=Array.from({length:1105},(_,i)=>({article:`sku-${i}`,name:`Товар ${i}`,cost_price:10}));
const sales=costs.map(c=>({article:c.article,bought_qty:1,revenue:30,year:2026,month:9}));
const report={year:2026,month:9,sales_amount:33150,transfer_total:25000,ads_spend:100,wb_media_spend:20,operational_expenses:30,external_promotion_expenses:40};
let queries=0;
const window={supabaseClient:{
  rpc:async(name,args)=>{queries++;assert.equal(name,'get_file_trend');assert.equal(args.p_shop_id,'shop-a');assert.equal(args.p_marketplace,'ozon');return {data:[{report,cogs:11050}]};},
  from(table){let range=[0,999],columns;
    const q={select(c){columns=c;return q;},eq(){return q;},order(){return q;},range(a,b){range=[a,b];return q;},maybeSingle:async()=>({data:report}),
      then(ok,bad){queries++;return Promise.resolve({data:(table==='sku_sales'?sales:costs).slice(range[0],range[1]+1)}).then(ok,bad);}};
    return q;
  }
}};
vm.runInNewContext(fs.readFileSync('assets/dashboard.js','utf8'),{window,Intl,Map,Set,WeakMap,Date});
(async()=>{
 const data=await window.WBDashboard.loadPeriodData('shop-a',2026,9,'ozon');
 assert.equal(data.skus.length,1105,'a store with >1000 products must not lose sales');
 assert.equal(data.costMap.size,1105,'cost prices must not stop at the API default row cap');
 queries=0;
 const trend=await window.WBDashboard.loadTrendData('shop-a',10,'ozon');
 assert.equal(queries,1,'chart must read only 12 aggregates in one RPC, not all historical sales');
 assert.equal(trend[0].profit,10445);
 console.log('File read budget: PASS (>1000 products intact, one aggregate chart query, unchanged profit).');
})().catch(e=>{console.error(e);process.exitCode=1;});
