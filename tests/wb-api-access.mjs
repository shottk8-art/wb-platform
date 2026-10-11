import assert from 'node:assert/strict';
import { authorizeShop } from '../supabase/functions/wb-api/access.ts';
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
const shops=[{id:a,owner_id:'owner-a'},{id:b,owner_id:'owner-b'}];
const members=[{shop_id:a,user_id:'member-a'}];
let reads=[];
const admin={from(table){const filters={};const q={select(){return q},eq(k,v){filters[k]=v;return q},maybeSingle:async()=>{reads.push({table,filters});return {data:(table==='shops'?shops:members).find(row=>Object.entries(filters).every(([k,v])=>row[k]===v))||null,error:null}}};return q}};
for(const [id,owner] of [[a,'owner-a'],[b,'owner-b']]) {
  assert.equal((await authorizeShop(admin,id,owner,'connect')).owner_id,owner);
  assert.equal((await authorizeShop(admin,id,owner,'cabinet')).id,id);
}
assert.equal((await authorizeShop(admin,a,'member-a','cabinet')).id,a);
assert.equal((await authorizeShop(admin,a,'member-a','cabinet_settings')).id,a,'existing team data-edit rights remain unchanged');
for(const action of ['connect','check','disconnect']) await assert.rejects(()=>authorizeShop(admin,a,'member-a',action),e=>e.status===403);
for(const user of ['owner-b','stranger']) for(const action of ['status','cabinet','cabinet_trend','cabinet_start','cabinet_settings']) await assert.rejects(()=>authorizeShop(admin,a,user,action),e=>e.status===403);
await assert.rejects(()=>authorizeShop(admin,b,'member-a','cabinet'),e=>e.status===403);
assert.ok(reads.filter(r=>r.table==='shop_members').every(r=>r.filters.shop_id && r.filters.user_id));
console.log('Production WB access: owners across shops, scoped team access, owner-only credentials, stranger isolation PASS.');
