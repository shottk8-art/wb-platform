import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import * as core from '../supabase/functions/wb-api/core.ts';
import {authorizeShop} from '../supabase/functions/wb-api/access.ts';
import {authorizeDaily,DAILY_USER_ID,DAILY_SHOP_ID} from '../supabase/functions/wb-api/daily-access.ts';
import {stocksAction,processStocks} from '../supabase/functions/wb-api/stocks.ts';
let handler;const upstream=[];
const admin={rpc:async name=>name==='wb_stock_accept_lease'?{data:[],error:null}:{data:null,error:null},from(table){const q={select(){return q},eq(){return q},maybeSingle:async()=>({data:table==='shops'?{id:DAILY_SHOP_ID,owner_id:DAILY_USER_ID}:null,error:null}),order(){return q},limit(){return q},then(a,b){return Promise.resolve({data:[],error:null}).then(a,b)}};return q;}};
const user={auth:{getUser:async()=>({data:{user:{id:DAILY_USER_ID}},error:null})}};
const source=readFileSync(new URL('../supabase/functions/wb-api/index.ts',import.meta.url),'utf8').replace(/^import .*?;\n/gm,'');
const context=vm.createContext({...core,authorizeShop,authorizeDaily,stocksAction,processStocks,
  Request,Response,AbortSignal,console,Set,createClient:(url,key,options)=>options?.global?user:admin,
  fetch:async(url,opts)=>{upstream.push(url);return new Response(JSON.stringify(url.includes('seller-info')?{sid:'seller',name:'Test'}:{}),{status:200,headers:{'Content-Type':'application/json'}})},
  Deno:{env:{get:name=>name},serve:fn=>{handler=fn;}}});
vm.runInContext(stripTypeScriptTypes(source,{mode:'strip'}),context);
const request=(body,headers={})=>new Request('https://test.invalid',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
assert.equal((await handler(request({action:'stocks',shop_id:DAILY_SHOP_ID}))).status,401);
assert.equal((await handler(request({shop_id:DAILY_SHOP_ID},{'X-WB-Stock-Lease':'00000000-0000-0000-0000-000000000001'}))).status,403,'fake stock worker reaches the private lease verifier');
assert.equal((await handler(request({shop_id:DAILY_SHOP_ID},{'Origin':'https://wb-platform.netlify.app','X-WB-Stock-Lease':'00000000-0000-0000-0000-000000000001'}))).status,403,'browser requests cannot enter the worker');
assert.equal((await handler(request({action:'stocks',shop_id:DAILY_SHOP_ID},{Authorization:'Bearer session'}))).status,200);
// Execute the ordinary WB helper too: a misplaced worker branch must not break
// the financial integration by accidentally referencing the handler's req/json.
const ordinary=await vm.runInContext("wbFetch('test-token','https://common-api.wildberries.ru/api/v1/seller-info')",context);
assert.equal(ordinary.sid,'seller');assert.equal(upstream.length,1);
console.log('Stock route PASS: bearer auth, one-use worker seam, forbidden browser worker, ordinary WB requests remain functional.');
