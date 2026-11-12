import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import * as core from '../supabase/functions/wb-api/core.ts';
import {authorizeShop} from '../supabase/functions/wb-api/access.ts';
import {authorizeDaily,DAILY_USER_ID} from '../supabase/functions/wb-api/daily-access.ts';
const DAILY_SHOP_ID='853b81a0-e0e2-4195-bc80-1cdc362af946';
import {stocksAction,processStocks} from '../supabase/functions/wb-api/stocks.ts';
let handler;const upstream=[];
const second='63175e7a-5b26-425e-893f-68889b32f02f',foreign='00000000-0000-4000-8000-000000000001';
let currentUser=DAILY_USER_ID;const scopedReads=[],privateReads=[];
const admin={rpc:async name=>name==='wb_stock_accept_lease'?{data:[],error:null}:{data:null,error:null},from(table){const filters={};const q={select(){return q},eq(k,v){filters[k]=v;return q},maybeSingle:async()=>{scopedReads.push({table,filters});return {data:table==='shops'?{id:filters.id,owner_id:filters.id===foreign?'other-owner':DAILY_USER_ID}:table==='shop_members'&&currentUser==='member'?{user_id:'member'}:null,error:null}},order(){return q},limit(){return q},then(a,b){return Promise.resolve({data:[],error:null}).then(a,b)}};return q;}};
const user={auth:{getUser:async()=>({data:{user:{id:currentUser}},error:null})}};
const source=readFileSync(new URL('../supabase/functions/wb-api/index.ts',import.meta.url),'utf8').replace(/^import .*?;\n/gm,'');
const context=vm.createContext({...core,authorizeShop,authorizeDaily,stocksAction,processStocks,
  readDaily:async(a,shop)=>{privateReads.push(shop);return {shop}},readUnit:async(a,shop)=>{privateReads.push(shop);return {shop}},cabinetPeriod:m=>({dateFrom:m+'-01',dateTo:m+'-28'}),
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

for(const shop of [DAILY_SHOP_ID,second])for(const action of ['stocks','daily','unit']){
 assert.equal((await handler(request({action,shop_id:shop,month:'2026-11'},{Authorization:'Bearer session'}))).status,200);
}
const beforePrivate=privateReads.length;
for(const who of ['member','other-owner']){
 currentUser=who;
 for(const action of ['stocks','stocks_refresh','stocks_settings','stocks_tracking','daily','daily_start','unit'])assert.equal((await handler(request({action,shop_id:second,month:'2026-11'},{Authorization:'Bearer session'}))).status,403);
}
currentUser=DAILY_USER_ID;
assert.equal((await handler(request({action:'stocks',shop_id:foreign},{Authorization:'Bearer session'}))).status,403,'public visibility is not authorization for Karl');
assert.equal(privateReads.length,beforePrivate,'forbidden accounts never enter private analytics reads');
assert.ok(scopedReads.filter(r=>r.table.startsWith('wb_stock_')).every(r=>[DAILY_SHOP_ID,second].includes(r.filters.shop_id)));
console.log('Private route scope PASS: account across shops, members/other owners denied, normal shop authorization preserved.');
