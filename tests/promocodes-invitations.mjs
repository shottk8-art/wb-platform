import assert from 'node:assert/strict';
import {authorizePromo,promoAction,PROMO_SHOP,PROMO_OWNER} from '../supabase/functions/wb-api/promocodes.ts';

const data={
  shops:[{id:PROMO_SHOP,owner_id:PROMO_OWNER}],
  shop_members:[{shop_id:PROMO_SHOP,telegram_username:'existing_member',user_id:'signed-in'}],
  wb_promo_viewers:[{id:'pending',shop_id:PROMO_SHOP,telegram_username:'existing_member',user_id:null}],
};
let writes=[];
const admin={from(table){
  const filters=[];let operation='read',payload;
  const result=()=>{
    const rows=(data[table]||[]).filter(row=>filters.every(fn=>fn(row)));
    if(operation==='update'){for(const row of rows)Object.assign(row,payload);writes.push({table,operation,ids:rows.map(r=>r.id)});}
    if(operation==='insert'){data[table]??=[];data[table].push({...payload,id:'new-grant'});writes.push({table,operation,payload});return {data:[data[table].at(-1)],error:null};}
    return {data:rows,error:null};
  };
  const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},is(k,v){filters.push(r=>r[k]===v);return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},limit(){return q;},order(){return q;},update(v){operation='update';payload=v;return q;},insert(v){operation='insert';payload=v;return q;},maybeSingle:async()=>{const r=result();return {...r,data:r.data[0]||null};},then:(a,b)=>Promise.resolve(result()).then(a,b)};return q;
}};

assert.deepEqual(await authorizePromo(admin,'signed-in',PROMO_SHOP),{owner:false},'an invitation added after sign-in must activate without another Telegram login');
assert.equal(data.wb_promo_viewers[0].user_id,'signed-in');
const applied=writes.length;
await authorizePromo(admin,'signed-in',PROMO_SHOP);assert.equal(writes.length,applied,'a resolved invitation needs no further writes');

data.wb_promo_viewers=[];
await assert.rejects(()=>authorizePromo(admin,'signed-in',PROMO_SHOP),e=>e.status===403,'shop membership alone never grants promo access');
data.wb_promo_viewers=[{id:'other',shop_id:PROMO_SHOP,telegram_username:'different_person',user_id:null}];
await assert.rejects(()=>authorizePromo(admin,'signed-in',PROMO_SHOP),e=>e.status===403);
assert.equal(data.wb_promo_viewers[0].user_id,null);
data.shop_members[0].shop_id='another-shop';data.wb_promo_viewers[0].telegram_username='existing_member';
await assert.rejects(()=>authorizePromo(admin,'signed-in',PROMO_SHOP),e=>e.status===403,'a different shop cannot resolve the invitation');
data.shop_members[0].shop_id=PROMO_SHOP;
data.wb_promo_viewers[0].user_id='another-user';
await assert.rejects(()=>authorizePromo(admin,'signed-in',PROMO_SHOP),e=>e.status===403,'never overwrite an already bound recipient');
data.wb_promo_viewers=[];
await promoAction(admin,PROMO_OWNER,PROMO_SHOP,{action:'promocodes_invite',username:'@Existing_Member'});
assert.equal(data.wb_promo_viewers.at(-1).user_id,'signed-in','new invites immediately bind a known same-shop member');
await promoAction(admin,PROMO_OWNER,PROMO_SHOP,{action:'promocodes_invite',username:'new_person'});
assert.equal(data.wb_promo_viewers.at(-1).user_id,null,'unknown usernames still require signed Telegram login');
assert.ok(writes.every(w=>w.table==='wb_promo_viewers'),'never create or modify shop membership');
console.log('Promo invitation PASS: existing-session activation, immediate known-member invite, pending new user, revocation and shop/recipient isolation.');
