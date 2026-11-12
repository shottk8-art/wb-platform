import { ApiError, validateKey } from './core.ts';
import { authorizeDaily, DAILY_SHOP_ID } from './daily-access.ts';

export const STOCK_INTERVAL = 30 * 60 * 1000;
const PAGE = 10000, MAX_ROWS = 250000;
const COLUMNS = 'snapshot,fetched_at,stage,next_run_at,error_message,alert_days,target_days,updated_at';
const txt = (v: unknown) => String(v ?? '').trim().slice(0, 300);
function id(v: unknown) {
  if ((typeof v === 'number' && !Number.isSafeInteger(v)) || !/^-?\d+$/.test(String(v))) throw new ApiError(502, 'WB вернул некорректный идентификатор остатков');
  return String(v);
}
function count(v: unknown) {
  if (!Number.isSafeInteger(v) || Number(v) < 0) throw new ApiError(502, 'WB вернул некорректное количество товара');
  return Number(v);
}
function sum(a: number, b: number) { return count(a + b); }
export function stockPage(response: any, kind: 'wb' | 'seller') {
  if (response === null) return [];
  const items = response?.data?.items;
  if (!Array.isArray(items) || items.length > PAGE) throw new ApiError(502, 'Неожиданный формат остатков WB');
  const seen = new Set();
  return items.map((p: any) => {
    const row = { nm_id: id(p?.nmId), size_id: id(p?.chrtId), warehouse_id: `${kind}:${id(p?.warehouseId)}`, kind,
      warehouse: txt(p.warehouseName), region: txt(p.regionName), quantity: count(p.quantity),
      to_client: kind === 'wb' ? count(p.inWayToClient) : 0, from_client: kind === 'wb' ? count(p.inWayFromClient) : 0 };
    if (!row.warehouse || BigInt(row.nm_id) <= 0n || BigInt(row.size_id) <= 0n) throw new ApiError(502, 'Неполные данные остатков WB');
    const key = [row.nm_id,row.size_id,row.warehouse_id].join(':');
    if (seen.has(key)) throw new ApiError(502, 'WB повторил размер товара на одном складе');
    seen.add(key); return row;
  });
}
export function mergeStockRows(old: any[], page: any[]) {
  const rows = new Map(old.map(p => [[p.nm_id,p.size_id,p.warehouse_id].join(':'),p]));
  for (const row of page) {
    const key = [row.nm_id,row.size_id,row.warehouse_id].join(':');
    if (rows.has(key)) throw new ApiError(502, 'Страницы остатков WB пересеклись. Повторим полную загрузку');
    rows.set(key,row);
  }
  if (rows.size > MAX_ROWS) throw new ApiError(400, 'Объём остатков превышает лимит тестового раздела');
  return [...rows.values()];
}
export function demandPeriod(now = new Date()) {
  const today = new Date(new Date(now.getTime()+3*3600000).toISOString().slice(0,10)+'T00:00:00Z');
  return { from: new Date(+today-28*86400000).toISOString().slice(0,10), to: new Date(+today-86400000).toISOString().slice(0,10), days: 28 };
}
export function demandPage(response: any, period: any) {
  const products = response?.data?.products;
  if (!Array.isArray(products) || products.length > 1000) throw new ApiError(502, 'Не удалось прочитать спрос по товарам');
  const seen = new Set();
  return products.map((p: any) => {
    const nm = id(p?.product?.nmId), s = p.statistic?.selected;
    if (BigInt(nm)<=0n || seen.has(nm) || s?.period?.start!==period.from || s?.period?.end!==period.to) throw new ApiError(502, 'Не удалось проверить период спроса WB');
    seen.add(nm);
    return {nm_id:nm,article:txt(p.product.vendorCode)||nm,name:txt(p.product.title)||txt(p.product.vendorCode)||nm,orders:count(s.orderCount)};
  });
}
export function stockSettings(body: any) {
  const alert = body.alert_days, target = body.target_days;
  if (!Number.isInteger(alert) || alert<1 || alert>180 || !Number.isInteger(target) || target<alert || target>365) throw new ApiError(400, 'Порог: 1–180 дней. Целевой запас: от порога до 365 дней');
  return {alert_days:alert,target_days:target};
}
export function inventoryView(snapshot: any, settings: any) {
  if (!snapshot) return null;
  const products = new Map<string,any>(), warehouses = new Map<string,any>();
  for (const p of snapshot.catalogue || []) products.set(p.nm_id,{nm_id:p.nm_id,article:p.article,name:p.name,orders:p.orders,quantity:0,wb:0,seller:0,to_client:0,from_client:0,warehouses:[]});
  for (const row of snapshot.rows) {
    if (!products.has(row.nm_id)) products.set(row.nm_id,{nm_id:row.nm_id,article:row.nm_id,name:`Артикул WB ${row.nm_id}`,orders:null,quantity:0,wb:0,seller:0,to_client:0,from_client:0,warehouses:[]});
    const p = products.get(row.nm_id);
    if (!warehouses.has(row.warehouse_id)) warehouses.set(row.warehouse_id,{id:row.warehouse_id,name:row.warehouse,kind:row.kind,region:row.region,quantity:0});
    const w = warehouses.get(row.warehouse_id);w.quantity=sum(w.quantity,row.quantity);
    p.quantity=sum(p.quantity,row.quantity);p[row.kind]=sum(p[row.kind],row.quantity);
    p.to_client=sum(p.to_client,row.to_client);p.from_client=sum(p.from_client,row.from_client);
    let location=p.warehouses.find((x:any)=>x.id===row.warehouse_id);
    if (!location) {location={id:row.warehouse_id,quantity:0,to_client:0,from_client:0,sizes:[]};p.warehouses.push(location);}
    location.quantity=sum(location.quantity,row.quantity);location.to_client=sum(location.to_client,row.to_client);location.from_client=sum(location.from_client,row.from_client);
    location.sizes.push({id:row.size_id,quantity:row.quantity});
  }
  const rows=[...products.values()].map(p=>{
    const daily=p.orders==null?null:p.orders/snapshot.demand.days;
    const days=daily>0?p.quantity/daily:null;
    return {...p,daily_orders:daily,days_left:days,status:p.quantity===0?'out':days!=null&&days<=settings.alert_days?'low':days==null?'unknown':'ok',
      recommended:daily>0?Math.max(0,Math.ceil(settings.target_days*daily-p.quantity)):null};
  });
  return {products:rows,warehouses:[...warehouses.values()].sort((a,b)=>a.name.localeCompare(b.name,'ru')),demand:snapshot.demand,
    wb_checked_at:snapshot.wb_checked_at,seller_checked_at:snapshot.seller_checked_at,
    totals:{quantity:rows.reduce((n,p)=>sum(n,p.quantity),0),products:rows.length,warehouses:warehouses.size,
      low:rows.filter(p=>p.status==='low').length,out:rows.filter(p=>p.status==='out').length,unknown:rows.filter(p=>p.status==='unknown').length}};
}
export async function readStocks(admin:any,shopId:string) {
  const {data:s,error}=await admin.from('wb_stock_snapshots').select(COLUMNS).eq('shop_id',shopId).maybeSingle();
  if(error)throw new ApiError(500,'Не удалось прочитать остатки');
  if(!s)return {status:'not_connected',settings:{alert_days:14,target_days:30},inventory:null};
  return {status:s.stage!=='idle'?'loading':s.error_message?'error':'ready',fetched_at:s.fetched_at,next_update_at:s.next_run_at,
    stale:!s.fetched_at || Date.now()-Date.parse(s.fetched_at)>STOCK_INTERVAL+10*60000,error:s.error_message,
    settings:{alert_days:s.alert_days,target_days:s.target_days},inventory:inventoryView(s.snapshot,s)};
}
export async function stocksAction(admin:any,userId:string,shopId:string,body:any) {
  authorizeDaily(userId,shopId);
  if(body.action==='stocks_refresh') {
    const {error}=await admin.rpc('wb_stock_enqueue',{p_shop_id:shopId});
    if(error)throw new ApiError(500,'Не удалось запустить обновление остатков');
  } else if(body.action==='stocks_settings') {
    const settings=stockSettings(body);
    const {error}=await admin.from('wb_stock_snapshots').update(settings).eq('shop_id',shopId);
    if(error)throw new ApiError(500,'Не удалось сохранить порог пополнения');
  }
  return readStocks(admin,shopId);
}
export async function stockFetch(token:string,url:string,body:any) {
  let r:Response;
  try {r=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(25000),redirect:'error'});}
  catch {throw new ApiError(502,'WB временно не отвечает. Обновление остатков будет повторено');}
  if(!r.ok) {
    const retry=Math.max(60,Number(r.headers.get('X-Ratelimit-Retry')||r.headers.get('Retry-After'))||60);await r.body?.cancel();
    if(r.status===429)throw new ApiError(429,'WB ограничил частоту обновления остатков',retry);
    if(r.status===401||r.status===403)throw new ApiError(400,'WB не разрешил загрузку остатков. Проверьте срок ключа и категорию «Аналитика» в настройках API');
    if(r.status===402)throw new ApiError(400,'WB требует оплату доступа к этому методу API');
    throw new ApiError(502,'Не удалось получить остатки из WB. Повторим обновление');
  }
  if(r.status===204)return null;
  try{return await r.json();}catch{throw new ApiError(502,'WB вернул нечитаемый отчёт об остатках');}
}
export async function processStocks(admin:any,state:any,fetcher=stockFetch) {
  if(state.shop_id!==DAILY_SHOP_ID)throw new ApiError(403,'Доступ запрещён');
  const save=async(patch:any)=>{
    const {error}=await admin.from('wb_stock_snapshots').update({...patch,updated_at:new Date().toISOString()}).eq('shop_id',state.shop_id).eq('lease_token',state.lease_token);
    if(error)throw new ApiError(500,'Не удалось сохранить обновление остатков');
  };
  try {
    const {data:key,error}=await admin.rpc('wb_api_read_key',{p_shop_id:state.shop_id});
    if(error||!key)throw new ApiError(400,'Подключите API магазина в настройках');
    const {token}=validateKey(String(key));
    const pending=structuredClone(state.pending||{}),offset=state.page_offset||0;
    if(state.stage==='wb'||state.stage==='seller') {
      const kind=state.stage,raw=await fetcher(token,`https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/${kind==='wb'?'wb':'seller'}-warehouses`,{limit:PAGE,offset});
      const page=stockPage(raw,kind);pending.rows=mergeStockRows(pending.rows||[],page);
      pending[`${kind}_checked_at`] ||= new Date().toISOString();
      if(page.length===PAGE)await save({pending,page_offset:offset+PAGE,failure_count:0,error_message:null,next_run_at:new Date(Date.now()+60000).toISOString()});
      else await save({pending,stage:kind==='wb'?'seller':'demand',page_offset:0,failure_count:0,error_message:null,next_run_at:new Date(Date.now()+60000).toISOString()});
    } else if(state.stage==='demand') {
      pending.demand ||= {...demandPeriod(),checked_at:new Date().toISOString()};
      const raw=await fetcher(token,'https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products',{selectedPeriod:{start:pending.demand.from,end:pending.demand.to},skipDeletedNm:true,limit:1000,offset});
      const page=demandPage(raw,pending.demand),catalogue=pending.catalogue||[],seen=new Set(catalogue.map((p:any)=>p.nm_id));
      if(page.some((p:any)=>seen.has(p.nm_id)))throw new ApiError(502,'Страницы каталога WB пересеклись. Повторим загрузку');
      pending.catalogue=[...catalogue,...page];
      if(pending.catalogue.length>100000)throw new ApiError(400,'Слишком большой каталог для тестового раздела');
      if(page.length===1000)await save({pending,page_offset:offset+1000,failure_count:0,error_message:null,next_run_at:new Date(Date.now()+60000).toISOString()});
      else {
        const snapshot={version:1,rows:pending.rows||[],catalogue:pending.catalogue,demand:pending.demand,wb_checked_at:pending.wb_checked_at,seller_checked_at:pending.seller_checked_at};
        inventoryView(snapshot,{alert_days:state.alert_days,target_days:state.target_days}); // Validate safe totals before atomic publication.
        await save({snapshot,fetched_at:pending.wb_checked_at,stage:'idle',pending:{},page_offset:0,failure_count:0,error_message:null,next_run_at:new Date(Date.parse(pending.wb_checked_at)+STOCK_INTERVAL).toISOString()});
      }
    } else throw new ApiError(400,'Некорректный этап загрузки остатков');
    return {processed:true};
  } catch(e) {
    const limited=e instanceof ApiError&&e.status===429,failures=Number(state.failure_count||0)+(limited?0:1);
    const terminal=e instanceof ApiError&&e.status===400 || failures>=3;
    // A failed/incomplete snapshot never replaces the last complete inventory.
    await save({...(terminal?{stage:'idle',pending:{},page_offset:0}:{}),failure_count:failures,
      error_message:e instanceof ApiError?e.message:'Не удалось обновить остатки. Повторим загрузку',
      next_run_at:new Date(Date.now()+(limited?(e as ApiError).retryAfter*1000:terminal?15*60000:2**failures*60000)).toISOString()});
    return {processed:false};
  }
}
