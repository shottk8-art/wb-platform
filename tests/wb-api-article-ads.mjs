import assert from 'node:assert/strict';
import {campaignDebits,campaignStats,articleAdvertising} from '../supabase/functions/wb-api/article-ads.ts';
import {aggregateUnitFinance,calculateUnit,attachArticleAds} from '../supabase/functions/wb-api/unit.ts';
import {aggregateFinanceRows,readCabinet,processCabinetSource,adsSnapshot} from '../supabase/functions/wb-api/cabinet.ts';
const DAILY_SHOP_ID='853b81a0-e0e2-4195-bc80-1cdc362af946';
import {cents} from '../supabase/functions/wb-api/core.ts';
const from='2026-10-01',to='2026-10-31';
const debit=(advertId,amount,type='Баланс',date=from)=>({advertId,updSum:amount,paymentType:type,updTime:date+'T10:00:00+03:00'});
const stat=(advertId,nms)=>({advertId,currency:'RUB',sum:nms.reduce((s,n)=>s+Number(n.sum),0),days:[{date:from+'T00:00:00Z',apps:[{appType:1,nms}]}]});
const nm=(id,sum)=>({nmId:id,sum,name:'Product'});
const orders=[{nm_id:'1',vendor_code:'A'},{nm_id:'2',vendor_code:'b'}];
function source(debits,stats){const s=campaignDebits(debits,from,to);const parsed=campaignStats(stats,s.campaigns.map(c=>c.id),from,to);for(const c of parsed)Object.assign(s.campaigns.find(p=>p.id===c.id),c);return {...s,status:'downloaded'};}
let s=source([debit(1,70),debit(1,30,'Промобонусы'),debit(2,40)], [stat(1,[nm(1,100)]),stat(2,[nm(1,30),nm(2,10)])]);
let a=articleAdvertising(s,orders);assert.equal(a.unassigned,false);assert.equal(a.products.get('a').amount,'100.00');assert.equal(a.products.get('b').amount,'10.00');
assert.equal(a.products.get('a').stats_amount,'130.00','stats spending is distinct from cash; bonus is excluded');
const mixed=source([debit(1,50),debit(1,50,'Промобонусы')],[stat(1,[nm(1,60),nm(2,40)])]);
a=articleAdvertising(mixed,orders);assert.equal(a.products.get('a').amount,null,'mixed multi-SKU cash must never be prorated');
assert.equal(articleAdvertising(source([debit(1,100,'Промобонусы')],[stat(1,[nm(1,60),nm(2,40)])]),orders).products.get('a').amount,'0.00');
assert.equal(articleAdvertising(source([debit(1,99)],[stat(1,[nm(1,60),nm(2,40)])]),orders).products.get('a').amount,null,'a source mismatch is never a proportional adjustment');
assert.equal(articleAdvertising(source([debit(1,100)],[stat(1,[nm(999,100)])]),orders).unassigned,true,'missing nmId mapping is explicit');
assert.equal(articleAdvertising(source([debit(1,100)],[]),orders).unassigned,true,'an omitted campaign is not zero');
assert.equal(articleAdvertising(source([],[]),orders).unassigned,false,'an empty verified debit period proves no money advertising');
const rounded=stat(1,[nm(1,100)]);rounded.sum=99.99;
assert.equal(articleAdvertising(source([debit(1,99)],[rounded]),orders).products.get('a').amount,'99.00','independent kopeck rounding never changes the exact single-SKU debit');
rounded.sum=50;assert.equal(articleAdvertising(source([debit(1,99)],[rounded]),orders).unassigned,true,'large hierarchy mismatch is unknown');
assert.equal(campaignDebits([debit(1,1),debit(1,1),debit(2,100,'Баланс','2026-11-01')],from,to).campaigns[0].totals.Баланс.amount,'2.00','legitimate equal operations retained, outside-period excluded');
assert.equal(campaignDebits([{...debit(1,1),updTime:null}],from,to).undated,true);
assert.throws(()=>campaignStats([stat(1,[nm(1,1),nm(1,1)])],[1],from,to),/повторил/);
assert.throws(()=>campaignStats([{...stat(1,[nm(1,1)]),currency:'USD'}],[1],from,to));
assert.throws(()=>campaignStats([stat(2,[nm(1,1)])],[1],from,to));
const financeRows=[{vendorCode:'A',sellerOperName:'Продажа',docTypeName:'Продажа',quantity:1,retailPriceWithDisc:1000,forPay:800},
 {vendorCode:'A',sellerOperName:'Удержание',bonusTypeName:'WB Продвижение',deduction:10},
 {sellerOperName:'Удержание',bonusTypeName:'WB Продвижение',deduction:100}];
const model=aggregateFinanceRows(financeRows,'1'),job={id:'j',status:'complete',date_from:from,date_to:to,row_count:3,cursor_id:'1',finance_model:model,
 summary:{pilot:{finance_complete:true},api_sources:{orders:{status:'downloaded',orders_amount:'1000',rows:orders},internal_ads:adsSnapshot([debit(1,110)],from,to),media:{status:'downloaded',date_from:from,date_to:to,amount:'0'}}}};
const cabinet=await readCabinet({},DAILY_SHOP_ID,{dateFrom:from,dateTo:to},job.id,{shop:{id:DAILY_SHOP_ID,tax_rate:0},settings:[],costs:[{article:'a',cost_price:100}],job});
const r=attachArticleAds(calculateUnit(cabinet,aggregateUnitFinance(financeRows,'1')),s,orders,cabinet);
const p=r.products.find(p=>p.article==='A');assert.equal(p.net_profit,'600.00','replace already-withheld10 with exact paid100 once');assert.equal(p.drr,10);
assert.equal(r.products.find(p=>p.article==='b').net_profit,'-10.00','an advertising-only product still incurs its expense');
for(const p of r.products)assert.equal(cents(p.sales)-p.expenses.reduce((n,e)=>n+cents(e.amount),0n),cents(p.net_profit));
assert.equal(r.products.reduce((n,p)=>n+cents(p.net_profit),0n)-r.common_expenses.reduce((n,e)=>e.reference?n:n+cents(e.amount),0n),cents(cabinet.net_profit),'products + signed common costs reconcile to the existing shop accounting');
// Real worker boundary: cooldown before decrypt/fetch, atomic batch cursor,
// replay-safe retries, privacy gate, no partial source committing after a failure.
const token=`e30.${Buffer.from(JSON.stringify({acc:3,exp:4102444800})).toString('base64url')}.${'x'.repeat(100)}`;
let wait=0,reads=0,fail=false;const saved={id:'job',shop_id:DAILY_SHOP_ID,date_from:from,date_to:to,summary:{pilot:{stage:'article_ads_debits'},api_sources:{}}};
const admin={rpc:async name=>{if(name==='wb_api_read_key')reads++;return {data:name==='wb_api_read_key'?token:wait};},from(table){if(table==='shops'){let id;const q={select(){return q},eq(k,v){id=v;return q},maybeSingle:async()=>({data:{owner_id:id===DAILY_SHOP_ID?'bbb002c4-cd7a-490d-b9c0-72aed5424261':'other'},error:null})};return q;}let update;const q={update(v){update=v;return q},eq(){return q},then(a,b){if(fail)return Promise.resolve({error:{}}).then(a,b);Object.assign(saved,update);return Promise.resolve({error:null}).then(a,b)}};return q;}};
let calls=0;const fetcher=async(_token,url)=>{calls++;return url.includes('/upd?')?[debit(1,100)]:[stat(1,[nm(1,100)])]};
wait=30;await processCabinetSource(admin,structuredClone(saved),fetcher);assert.equal(reads,0);assert.equal(calls,0);
wait=0;await processCabinetSource(admin,structuredClone(saved),fetcher);assert.equal(saved.summary.pilot.stage,'article_ads_stats');assert.equal(saved.summary.api_sources.internal_ads.period_totals.Баланс.amount,'100.00','overview and unit share the exact debit read');
fail=true;await assert.rejects(()=>processCabinetSource(admin,structuredClone(saved),fetcher));assert.equal(saved.summary.api_sources.article_ads.offset,0);
fail=false;await processCabinetSource(admin,structuredClone(saved),fetcher);assert.equal(saved.status,'complete');assert.equal(saved.summary.api_sources.article_ads.offset,1);
await assert.rejects(()=>processCabinetSource(admin,{...saved,shop_id:'00000000-0000-4000-8000-000000000001',summary:{pilot:{stage:'article_ads_debits'}}},fetcher),/Доступ/);
console.log('Article ads PASS: cash vs bonus, exact SKU attribution, rounding, no prorating, real-money DRR, source mismatch/missing mapping, ads-only SKU, no double deduction, shop reconciliation, durable atomic batch and private gate.');
