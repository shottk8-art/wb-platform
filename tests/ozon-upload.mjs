import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const calls=[],events=[],periods=[{report:{year:2026,month:10},skus:[],analytics:{version:1}}];
const sb={auth:{getSession:async()=>({data:{session:{user:{id:'bbb002c4-cd7a-490d-b9c0-72aed5424261'}}}})},rpc:async(name,args)=>{calls.push({name,args});return {data:1}},from(){throw Error('Private report must be atomic, not direct table writes')}};
const window={supabaseClient:sb,WBParse:{parseOzonAccruals:async()=>({periods,transactionCount:12})}};
vm.runInNewContext(readFileSync(new URL('../assets/upload.js',import.meta.url),'utf8'),{window,document:{dispatchEvent:e=>events.push(e)},CustomEvent:class{constructor(type,options){this.type=type;Object.assign(this,options)}},Map,console});
assert.equal(await window.WBUpload.uploadOzonAccruals('shop',{name:'ozon.xlsx'}),1);assert.equal(calls.length,1);assert.equal(calls[0].name,'import_ozon_report');assert.equal(calls[0].args.p_shop_id,'shop');assert.equal(events[0].detail.shopId,'shop');
sb.rpc=async()=>({error:Error('Atomic import rejected')});await assert.rejects(()=>window.WBUpload.uploadOzonAccruals('shop',{name:'bad.xlsx'}));assert.equal(events.length,1,'a failed import does not invalidate the last UI source');
console.log('Ozon upload PASS: one atomic authenticated RPC, selected shop binding, no partial table writes and scoped invalidation after success.');
