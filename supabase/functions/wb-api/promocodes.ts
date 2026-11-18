import {ApiError,cents,rub,validatePeriod,validateKey,pageCursor,sanitizeRows} from './core.ts';
import {deferRequest} from './rate-limit.ts';

export const PROMO_SHOP='853b81a0-e0e2-4195-bc80-1cdc362af946';
export const PROMO_OWNER='bbb002c4-cd7a-490d-b9c0-72aed5424261';
export const PROMO_FIELDS=['rrdId','sellerOperName','docTypeName','quantity','retailPriceWithDisc','rrDate','uuidPromocode'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const lower=(v:any)=>String(v??'').trim().toLowerCase();
const month=(date:string)=>date.slice(0,7)+'-01';
const endOfMonth=(date:string)=>new Date(Date.UTC(+date.slice(0,4),+date.slice(5,7),0)).toISOString().slice(0,10);
const moscowToday=()=>new Date(Date.now()+10800000).toISOString().slice(0,10);
const shiftDay=(date:string,days:number)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
const shiftMonth=(date:string,months:number)=>new Date(Date.UTC(+date.slice(0,4),+date.slice(5,7)-1+months,1)).toISOString().slice(0,10);
export function previousPromoPeriod(p:any){
  const fullMonths=p.dateFrom.endsWith('-01')&&p.dateTo===endOfMonth(p.dateTo);
  const count=(+p.dateTo.slice(0,4)- +p.dateFrom.slice(0,4))*12+ +p.dateTo.slice(5,7)- +p.dateFrom.slice(5,7)+1;
  const days=Math.round((Date.parse(p.dateTo)-Date.parse(p.dateFrom))/86400000)+1;
  return {dateFrom:fullMonths?shiftMonth(p.dateFrom,-count):shiftDay(p.dateFrom,-days),dateTo:shiftDay(p.dateFrom,-1),basis:fullMonths?'calendar_months':'equal_days'};
}

export function promoPeriod(from:any,to:any){
  const p=validatePeriod(from,to),today=moscowToday();
  const oldest=new Date(Date.UTC(+today.slice(0,4),+today.slice(5,7)-12,1)).toISOString().slice(0,10);
  if(p.dateFrom<oldest)throw new ApiError(400,'Выберите период за последние 12 месяцев');
  return p;
}
function periods(p:any){
  const result=[];let m=month(p.dateFrom);
  while(m<=month(p.dateTo)){result.push({from:m,to:[endOfMonth(m),moscowToday()].sort()[0]});m=new Date(Date.UTC(+m.slice(0,4),+m.slice(5,7),1)).toISOString().slice(0,10);}
  return result;
}
export function aggregatePromocodes(rows:any[],cursor:string,range:any){
  const buckets=new Map<string,any>();let covered=0,unallocated=0;
  for(const row of rows){
    if(Object.hasOwn(row,'uuidPromocode'))covered++;
    const id=lower(row.uuidPromocode);if(!id)continue;
    if(!uuid.test(id))throw new ApiError(502,'WB вернул некорректный ID промокода');
    const operation=lower(row.sellerOperName);if(!['продажа','возврат'].includes(operation))continue;
    const qty=Number(row.quantity);
    if(row.quantity==null||!Number.isSafeInteger(qty)||qty<0||row.retailPriceWithDisc==null)throw new ApiError(502,'Неполные продажи по промокоду');
    const price=cents(row.retailPriceWithDisc);if(price<0n)throw new ApiError(502,'Некорректная цена по промокоду');
    const raw=String(row.rrDate||''),day=raw.slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+'T00:00:00Z'))||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day||day<range.dateFrom||day>range.dateTo){unallocated++;continue;}
    const key=day+':'+id,p=buckets.get(key)||{day,promo_id:id,sold_qty:0,returned_qty:0,sold_amount:0n,returned_amount:0n};
    const returned=lower(row.docTypeName)==='возврат'||operation==='возврат';
    p[returned?'returned_qty':'sold_qty']+=qty;p[returned?'returned_amount':'sold_amount']+=BigInt(qty)*price;
    if(!Number.isSafeInteger(p.sold_qty)||!Number.isSafeInteger(p.returned_qty))throw new ApiError(502,'Слишком большое количество товаров');
    buckets.set(key,p);
  }
  return {version:1,cursor_id:cursor,row_count:rows.length,covered_rows:covered,unallocated_rows:unallocated,
    buckets:[...buckets.values()].map(p=>({...p,sold_amount:rub(p.sold_amount),returned_amount:rub(p.returned_amount)}))};
}
export function mergePromocodes(previous:any,page:any){
  if(!previous)return page;
  const buckets=new Map(previous.buckets.map((p:any)=>[p.day+':'+p.promo_id,{...p}]));
  for(const p of page.buckets){const key=p.day+':'+p.promo_id,old:any=buckets.get(key);
    buckets.set(key,old?{...p,sold_qty:old.sold_qty+p.sold_qty,returned_qty:old.returned_qty+p.returned_qty,
      sold_amount:rub(cents(old.sold_amount)+cents(p.sold_amount)),returned_amount:rub(cents(old.returned_amount)+cents(p.returned_amount))}:{...p});}
  return {...page,row_count:previous.row_count+page.row_count,covered_rows:previous.covered_rows+page.covered_rows,
    unallocated_rows:previous.unallocated_rows+page.unallocated_rows,buckets:[...buckets.values()]};
}
function validModel(job:any){const m=job.model;return m?.version===1&&m.row_count===Number(job.row_count)&&m.cursor_id===String(job.cursor_id)&&m.covered_rows===m.row_count&&m.unallocated_rows===0&&Array.isArray(m.buckets);}
export async function authorizePromo(admin:any,userId:string,shopId:string){
  if(shopId!==PROMO_SHOP)throw new ApiError(403,'Статистика промокодов недоступна');
  const {data:shop,error}=await admin.from('shops').select('owner_id').eq('id',PROMO_SHOP).maybeSingle();
  if(error)throw new ApiError(500,'Не удалось проверить доступ');
  if(shop?.owner_id!==PROMO_OWNER)throw new ApiError(403,'Статистика промокодов недоступна');
  if(userId===PROMO_OWNER)return {owner:true};
  const {data:override,error:overrideError}=await admin.from('user_section_access').select('allowed').eq('user_id',userId).eq('section','promocodes').maybeSingle();
  if(overrideError)throw new ApiError(500,'Не удалось проверить доступ к разделу');
  if(override?.allowed===false)throw new ApiError(403,'Доступ к промокодам закрыт администратором');
  if(override?.allowed===true)return {owner:false};
  const {data:viewer,error:viewerError}=await admin.from('wb_promo_viewers').select('id').eq('shop_id',PROMO_SHOP).eq('user_id',userId).limit(1).maybeSingle();
  if(viewerError)throw new ApiError(500,'Не удалось проверить доступ');
  if(viewer)return {owner:false};
  // An owner-managed member can already be signed in when invited. Resolve
  // only explicit pending grants in this shop; never trust profile metadata.
  const {data:members,error:memberError}=await admin.from('shop_members').select('telegram_username').eq('shop_id',PROMO_SHOP).eq('user_id',userId);
  if(memberError)throw new ApiError(500,'Не удалось проверить участника магазина');
  const usernames=(members||[]).map((m:any)=>m.telegram_username).filter(Boolean);
  if(usernames.length){
    const {data:activated,error:activationError}=await admin.from('wb_promo_viewers').update({user_id:userId}).eq('shop_id',PROMO_SHOP).in('telegram_username',usernames).is('user_id',null).select('id');
    if(activationError)throw new ApiError(500,'Не удалось активировать доступ к промокодам');
    if(activated?.length)return {owner:false};
  }
  throw new ApiError(403,'Доступ не выдан. Попросите владельца TOPLASH добавить ваш ник Telegram');
}
export async function readPromocodes(admin:any,p:any){
  const today=moscowToday(),history={dateFrom:shiftMonth(today,-11),dateTo:today};
  const start=history.dateFrom,finish=month(today);
  const [normal,backfill,names,aliases]=await Promise.all([
    admin.from('wb_api_preview_jobs').select('id,date_from,date_to,status,row_count,cursor_id,updated_at,created_at,model:finance_model->promocodes').eq('shop_id',PROMO_SHOP).gte('date_from',start).lte('date_from',finish).order('created_at',{ascending:false}),
    admin.from('wb_promo_jobs').select('id,date_from,date_to,status,row_count,cursor_id,model,updated_at,created_at,error_message').eq('shop_id',PROMO_SHOP).gte('date_from',start).lte('date_from',finish).order('created_at',{ascending:false}),
    admin.from('wb_promo_names').select('promo_id,name,code').eq('shop_id',PROMO_SHOP),
    admin.from('wb_promo_id_aliases').select('alias_id,promo_id').eq('shop_id',PROMO_SHOP),
  ]);
  if(normal.error||backfill.error||names.error||aliases.error)throw new ApiError(500,'Не удалось прочитать статистику промокодов');
  // The saved catalogue is also the audience boundary: historical IDs that
  // are absent from the owner's verified WB list never reach this response.
  const catalog=new Map<string,any>((names.data||[]).map((n:any)=>[n.promo_id,n]));
  if(!catalog.size)return {status:'needs_catalog',period:p,fetched_at:null,missing_months:[],loading_months:[],refreshing:false,error:null,rows:[],catalog_count:0,basis:'financial_operation_date',metric:'buyouts',currency:'RUB'};
  // WB's earlier financial rows can use the ID from the same card's URL.
  // Only explicit, privately verified mappings may join that history to a card.
  const canonical=new Map<string,string>([...catalog.keys()].map(id=>[id,id]));
  for(const alias of aliases.data||[]){
    if(!catalog.has(alias.promo_id))continue;
    if(canonical.has(alias.alias_id)&&canonical.get(alias.alias_id)!==alias.promo_id)throw new ApiError(500,'Неоднозначные ID промокодов. Обратитесь к владельцу магазина');
    canonical.set(alias.alias_id,alias.promo_id);
  }
  // Expose only verified aliases of saved cards so a financial-report ID can
  // find its campaign without adding unrelated promotions to the catalogue.
  const historical=new Map<string,string[]>([...catalog.keys()].map(id=>[id,[]]));
  for(const [id,promo] of canonical)if(id!==promo)historical.get(promo)!.push(id);
  const cached=new Map<string,any>();
  function collect(period:any){
    const key=period.dateFrom+':'+period.dateTo;if(cached.has(key))return cached.get(key);
    const rows=new Map<string,any>([...catalog.keys()].map(promo_id=>[promo_id,{promo_id,sold_qty:0,returned_qty:0,sold_amount:0n,returned_amount:0n}])),missing:string[]=[],loading:string[]=[],errors:string[]=[];let fetched:string|null=null;
    for(const range of periods(period)){
    const end=[range.to,period.dateTo].sort()[0];
    const active=(backfill.data||[]).find((j:any)=>j.date_from===range.from&&j.status==='loading');if(active)loading.push(range.from.slice(0,7));
    const candidates=[...(normal.data||[]),...(backfill.data||[])].filter((j:any)=>j.date_from===range.from&&j.date_to>=end&&j.status==='complete'&&validModel(j)).sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)));
    const chosen=candidates[0];
    if(!chosen){missing.push(range.from.slice(0,7));
      const failure=(backfill.data||[]).find((j:any)=>j.date_from===range.from&&j.status==='error');if(failure)errors.push(failure.error_message||'Не удалось загрузить период');continue;}
    fetched=fetched==null||chosen.updated_at<fetched?chosen.updated_at:fetched;
    for(const b of chosen.model.buckets){const id=canonical.get(b.promo_id);if(b.day<period.dateFrom||b.day>period.dateTo||!id)continue;
      const old=rows.get(id);
      old.sold_qty+=b.sold_qty;old.returned_qty+=b.returned_qty;old.sold_amount+=cents(b.sold_amount);old.returned_amount+=cents(b.returned_amount);}
  }
  const result=[...rows.values()].map(r=>({...r,name:catalog.get(r.promo_id).name,code:catalog.get(r.promo_id).code||'',historical_ids:historical.get(r.promo_id),net_qty:r.sold_qty-r.returned_qty,
    net_amount:rub(r.sold_amount-r.returned_amount),sold_amount:rub(r.sold_amount),returned_amount:rub(r.returned_amount)}));
    const ready=!missing.length;
    const metrics=ready?{active_codes:result.filter(r=>r.sold_qty>0).length,sold_qty:result.reduce((n,r)=>n+r.sold_qty,0),sold_amount:rub(result.reduce((n,r)=>n+cents(r.sold_amount),0n)),net_amount:rub(result.reduce((n,r)=>n+cents(r.net_amount),0n))}:null;
    const value={status:ready?'ready':loading.length?'loading':errors.length?'error':'needs_preparation',period,fetched_at:fetched,metrics,
    missing_months:missing,loading_months:loading,refreshing:loading.length>0,error:errors[0]||null,rows:ready?result:[],
    catalog_count:catalog.size,basis:'financial_operation_date',metric:'buyouts',currency:'RUB'};
    cached.set(key,value);return value;
  }
  const current=collect(p),previous=previousPromoPeriod(p);
  const prior=previous.dateFrom<history.dateFrom?{status:'outside_history',period:previous,metrics:null,missing_months:[],loading_months:[],refreshing:false,error:null}:collect(previous);
  const {rows:_priorRows,...comparison}=prior;
  const trendRows=periods(history).map(range=>{
    const result=collect({dateFrom:range.from,dateTo:range.to});
    return {year:+range.from.slice(0,4),month:+range.from.slice(5,7),status:result.status,partial:range.from===month(today),...(result.metrics||{active_codes:null,sold_qty:null,sold_amount:null,net_amount:null})};
  });
  return {...current,comparison,trend:{period:history,rows:trendRows,metrics:collect(history).metrics}};
}
export async function promoAction(admin:any,userId:string,shopId:string,body:any){
  const access=await authorizePromo(admin,userId,shopId);
  if(body.action==='promocodes_access')return {allowed:true,owner:access.owner,shop_id:PROMO_SHOP};
  const owners=['promocodes_start','promocodes_name','promocodes_viewers','promocodes_invite','promocodes_revoke'];
  if(owners.includes(body.action)&&!access.owner)throw new ApiError(403,'Действие доступно только владельцу');
  if(body.action==='promocodes_viewers'){
    const {data,error}=await admin.from('wb_promo_viewers').select('id,telegram_username,user_id,invited_at').eq('shop_id',PROMO_SHOP).order('invited_at');
    if(error)throw new ApiError(500,'Не удалось прочитать список доступа');return {viewers:data,owner:true};
  }
  if(body.action==='promocodes_invite'){
    const username=lower(body.username).replace(/^@/,'');if(!/^[a-z][a-z0-9_]{4,31}$/.test(username))throw new ApiError(400,'Введите корректный ник Telegram без ссылки');
    const {data:member,error:memberError}=await admin.from('shop_members').select('user_id').eq('shop_id',PROMO_SHOP).eq('telegram_username',username).maybeSingle();
    if(memberError)throw new ApiError(500,'Не удалось проверить участника магазина');
    const {error}=await admin.from('wb_promo_viewers').insert({shop_id:PROMO_SHOP,telegram_username:username,user_id:member?.user_id||null});
    if(error)throw new ApiError(error.code==='23505'?409:500,error.code==='23505'?'Этот пользователь уже приглашён':'Не удалось добавить доступ');return {saved:true};
  }
  if(body.action==='promocodes_revoke'){
    if(!uuid.test(body.viewer_id))throw new ApiError(400,'Выберите пользователя');
    const {error}=await admin.from('wb_promo_viewers').delete().eq('id',body.viewer_id).eq('shop_id',PROMO_SHOP);
    if(error)throw new ApiError(500,'Не удалось отозвать доступ');return {saved:true};
  }
  if(body.action==='promocodes_name'){
    const name=String(body.name??'').trim();if(!uuid.test(body.promo_id)||!name||name.length>120)throw new ApiError(400,'Укажите ID и название промо до 120 символов');
    const code=body.code===undefined?undefined:String(body.code??'').trim();if(code!==undefined&&code.length>64)throw new ApiError(400,'Промокод должен быть не длиннее 64 символов');
    const {error}=await admin.from('wb_promo_names').upsert({shop_id:PROMO_SHOP,promo_id:lower(body.promo_id),name,...(code===undefined?{}:{code})},{onConflict:'shop_id,promo_id'});
    if(error)throw new ApiError(500,'Не удалось сохранить название');return {saved:true};
  }
  if(!['promocodes_read','promocodes_start'].includes(body.action))throw new ApiError(400,'Неизвестное действие');
  const p=promoPeriod(body.from,body.to);
  let result=await readPromocodes(admin,p);
  if(body.action==='promocodes_start'&&result.status!=='needs_catalog'){
    const queued=new Set<string>();
    for(const range of periods(p))if(body.refresh===true||result.missing_months.includes(range.from.slice(0,7))){
      const {error}=await admin.rpc('wb_promo_queue_month',{p_month:range.from,p_refresh:body.refresh===true});
      if(error)throw new ApiError(500,'Не удалось запустить загрузку промокодов');queued.add(range.from);}
    if(result.comparison?.period&&result.comparison.status!=='outside_history')for(const range of periods(result.comparison.period))if(!queued.has(range.from)&&result.comparison.missing_months.includes(range.from.slice(0,7))){
      const {error}=await admin.rpc('wb_promo_queue_month',{p_month:range.from,p_refresh:body.refresh===true&&result.comparison.status==='error'});
      if(error)throw new ApiError(500,'Не удалось запустить загрузку сравнения');}
    result=await readPromocodes(admin,p);
  }
  return {...result,owner:access.owner};
}
export async function processPromoPage(admin:any,job:any,fetcher:any){
  if(job.shop_id!==PROMO_SHOP)throw new ApiError(403,'Доступ запрещён');
  try{
    const {data:wait,error:claimError}=await admin.rpc('wb_api_claim_request',{p_shop_id:PROMO_SHOP,p_kind:'finance'});
    if(claimError)throw new ApiError(500,'Не удалось проверить лимит WB');if(Number(wait)>0)return {retry_after:Number(wait)};
    const {data:key,error:keyError}=await admin.rpc('wb_api_read_key',{p_shop_id:PROMO_SHOP});
    if(keyError||!key)throw new ApiError(400,'Подключите API TOPLASH');const {token}=validateKey(String(key));
    const raw=await fetcher(token,'https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed',{
      dateFrom:job.date_from,dateTo:job.date_to+'T23:59:59',rrdId:Number(job.cursor_id),limit:50000,period:job.finance_period,fields:PROMO_FIELDS});
    const cursor=pageCursor(raw||[],String(job.cursor_id)),rows=sanitizeRows(raw||[],true).filter((r:any)=>BigInt(String(r.rrdId))>BigInt(job.cursor_id));
    const model=mergePromocodes(job.model,aggregatePromocodes(rows,cursor,{dateFrom:job.date_from,dateTo:job.date_to}));
    if(!raw?.length&&(model.covered_rows!==model.row_count||model.unallocated_rows))throw new ApiError(400,'WB не вернул полные ID или даты промокодов. Последний полный снимок сохранён');
    const {data:committed,error}=await admin.rpc('wb_promo_commit_page',{p_job_id:job.id,p_lease:job.lease_token,p_expected_cursor:String(job.cursor_id),p_expected_rows:Number(job.row_count),p_model:model,p_complete:!raw?.length});
    if(error||committed!==true)throw new ApiError(500,'Прогресс загрузки изменился. Повторим безопасно');
    return {processed:true};
  }catch(e){
    const limited=e instanceof ApiError&&e.status===429,failures=Number(job.failure_count||0)+(limited?0:1);
    const terminal=e instanceof ApiError&&e.status===400||failures>=5;
    await deferRequest(admin,PROMO_SHOP,limited?(e as ApiError).retryAfter:Math.min(3600,120*2**failures),limited);
    const {error}=await admin.from('wb_promo_jobs').update({status:terminal?'error':'loading',failure_count:failures,error_message:e instanceof ApiError?e.message:'Не удалось загрузить промокоды',updated_at:new Date().toISOString()}).eq('id',job.id).eq('lease_token',job.lease_token);
    if(error)throw new ApiError(500,'Не удалось сохранить состояние загрузки');return {processed:false};
  }
}
