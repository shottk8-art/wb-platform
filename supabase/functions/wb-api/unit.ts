import { ApiError, cents, rub, validatePeriod, validateShopId } from './core.ts';
import { aggregateFinanceRows, mergeFinanceModels, readCabinet, readCostPrices, cabinetPeriod } from './cabinet.ts';
import { articleKey, hasCostPrice } from './articles.ts';
import { articleAdvertising, clipArticleAdvertising } from './article-ads.ts';
import { advertising, economy } from './economy.ts';
import { operationDay } from './daily.ts';

// Stored once per daily model. Codec v1 uses [day,key,rows,quantity,money]
// tuples, where money maps field indexes to nonzero decimal RUB strings or
// explicit null sales. Only this exact manifest authorizes omitted known zeros.
export const UNIT_DAILY_CODEC='sku_day_sparse_money_v1';
export const UNIT_DAILY_SCHEMA=Object.freeze(['day','key','rows','quantity','money']);
export const UNIT_DAILY_MONEY_FIELDS=Object.freeze([
  'retailAmount','forPay','deliveryService','paidStorage','paidAcceptance','penalty','deduction',
  'cashbackAmount','cashbackDiscount','cashbackCommissionChange','salesAmount','additionalPayment',
  'advertisingDeductions','wbMediaDeductions',
]);
const moneyValue=(key:string,value:any)=>key==='salesAmount' && value===null || typeof value==='string' && /^-?\d+\.\d{2}$/.test(value);
const exactList=(actual:any,expected:readonly string[])=>Array.isArray(actual) && actual.length===expected.length && expected.every((v,i)=>actual[i]===v);
function fullMoney(totals:any) {
  return totals && typeof totals==='object' && !Array.isArray(totals)
    && Object.keys(totals).length===UNIT_DAILY_MONEY_FIELDS.length
    && UNIT_DAILY_MONEY_FIELDS.every(key=>Object.hasOwn(totals,key) && moneyValue(key,totals[key]));
}
function encodeUnitDaily(buckets:any[],meta:any) {
  const encoded:any[]=[];
  for(const b of buckets) {
    if(!fullMoney(b.totals))return null;
    const money:any={};
    UNIT_DAILY_MONEY_FIELDS.forEach((key,i)=>{
      const value=b.totals[key];
      if(value===null || cents(value)!==0n)money[i]=value;
    });
    encoded.push([b.day,b.key,b.rows,b.quantity,money]);
  }
  encoded.sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1]));
  return {...meta,version:2,codec:UNIT_DAILY_CODEC,schema:[...UNIT_DAILY_SCHEMA],money_fields:[...UNIT_DAILY_MONEY_FIELDS],buckets:encoded};
}
// Legacy v1 requires every money field explicitly in every full bucket. It
// never gets sparse defaults. Monthly metadata is the sole SKU/name catalogue.
export function decodeUnitDaily(unit:any) {
  const d=unit?.daily;
  if(unit?.version!==1 || !Array.isArray(unit.buckets) || !d || ![1,2].includes(d.version)
    || d.cursor_id!==unit.cursor_id || d.row_count!==unit.row_count || !Number.isSafeInteger(d.row_count) || d.row_count<0
    || !Number.isSafeInteger(d.covered_rows) || d.covered_rows<0 || d.covered_rows>d.row_count
    || typeof d.history_complete!=='boolean' || !Array.isArray(d.buckets))return null;
  const sparse=d.version===2;
  if(sparse ? d.codec!==UNIT_DAILY_CODEC || !exactList(d.schema,UNIT_DAILY_SCHEMA) || !exactList(d.money_fields,UNIT_DAILY_MONEY_FIELDS)
    : d.codec!==undefined || d.schema!==undefined || d.money_fields!==undefined)return null;
  const catalogue=new Map<string,any>();let monthlyRows=0;
  for(const b of unit.buckets) {
    if(typeof b.key!=='string' || typeof b.article!=='string' || typeof b.name!=='string' || catalogue.has(b.key) || articleKey(b.article)!==b.key
      || !Number.isSafeInteger(b.rows) || b.rows<=0 || !Number.isSafeInteger(b.quantity) || !fullMoney(b.totals))return null;
    catalogue.set(b.key,b);monthlyRows+=b.rows;
  }
  if(monthlyRows!==unit.row_count)return null;
  const buckets:any[]=[],seen=new Set();let covered=0;
  for(const stored of d.buckets) {
    let day,key,rows,quantity,totals;
    if(sparse) {
      if(!Array.isArray(stored) || stored.length!==UNIT_DAILY_SCHEMA.length)return null;
      [day,key,rows,quantity]=stored;
      const money=stored[4];
      if(!money || typeof money!=='object' || Array.isArray(money))return null;
      totals=Object.fromEntries(UNIT_DAILY_MONEY_FIELDS.map(field=>[field,'0.00']));
      for(const [index,value] of Object.entries(money)) {
        const i=Number(index),field=UNIT_DAILY_MONEY_FIELDS[i];
        if(!Number.isSafeInteger(i) || String(i)!==index || !field || !moneyValue(field,value))return null;
        totals[field]=value;
      }
    } else {
      if(!stored || Array.isArray(stored) || !fullMoney(stored.totals))return null;
      ({day,key,rows,quantity,totals}=stored);
    }
    const product=catalogue.get(key),id=JSON.stringify([day,key]);
    if(typeof day!=='string' || day.length!==10 || operationDay(day)!==day || !product || seen.has(id)
      || !Number.isSafeInteger(rows) || rows<=0 || !Number.isSafeInteger(quantity))return null;
    seen.add(id);covered+=rows;
    buckets.push({key,article:product.article,name:product.name,day,rows,quantity,totals});
  }
  if(covered!==d.covered_rows)return null;
  return {...d,buckets};
}

// Compact, pilot-only financial totals per article. Never persist source rows.
function aggregateUnitBuckets(rows:any[],cursor:string) {
  const groups=new Map<string,any[]>();
  for(const row of rows) {
    const article=String(row.vendorCode || (Number(row.nmId)>0?row.nmId:'')).trim();
    const key=articleKey(article);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key)!.push(row);
  }
  return {version:1,cursor_id:cursor,row_count:rows.length,buckets:[...groups].map(([key,items])=>{
    const model=aggregateFinanceRows(items,cursor);
    return {key,article:key?String(items.find(p=>String(p.vendorCode||'').trim())?.vendorCode || items[0].nmId).trim():'',
      name:String(items.find(p=>p.title)?.title||'').slice(0,300),rows:items.length,quantity:model.bought_qty,totals:model.totals};
  })};
}
export function aggregateUnitFinance(rows:any[],cursor='0') {
  const result:any=aggregateUnitBuckets(rows,cursor);
  const days=new Map<string,any[]>();let covered=0;
  for(const row of rows) {
    const value=row.rrDate,day=operationDay(value);
    if(!day || value.length!==10 && (!/T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(value) || !Number.isFinite(Date.parse(value))))continue;
    covered++;if(!days.has(day))days.set(day,[]);days.get(day)!.push(row);
  }
  const meta={cursor_id:cursor,row_count:rows.length,covered_rows:covered,history_complete:true};
  result.daily=encodeUnitDaily([...days].flatMap(([day,items])=>
    aggregateUnitBuckets(items,cursor).buckets.map((b:any)=>({...b,day}))),meta)
    || encodeUnitDaily([],{...meta,covered_rows:0,history_complete:false});
  return result;
}
function mergeBuckets(left:any[],right:any[],daily=false) {
  const key=(b:any)=>daily?JSON.stringify([b.day,b.key]):b.key;
  const buckets=new Map(left.map((p:any)=>[key(p),{...p}]));
  for(const p of right) {
    const old:any=buckets.get(key(p));
    if(!old){buckets.set(key(p),p);continue;}
    const totals=mergeFinanceModels({row_count:old.rows,sales_covered_rows:old.rows,bought_qty:old.quantity,totals:old.totals,products:[]},
      {row_count:p.rows,sales_covered_rows:p.rows,bought_qty:p.quantity,totals:p.totals,products:[]}).totals;
    buckets.set(key(p),{...old,name:old.name||p.name,rows:old.rows+p.rows,quantity:old.quantity+p.quantity,totals});
  }
  return [...buckets.values()];
}
export function mergeUnitFinance(previous:any,page:any,checkpoint?:{cursor_id:string,row_count:number}) {
  const continuous=(!previous || previous.version===1) && (!checkpoint || (previous ? previous.cursor_id===String(checkpoint.cursor_id) && previous.row_count===checkpoint.row_count : checkpoint.row_count===0 && String(checkpoint.cursor_id)==='0'));
  const result:any=previous?{...page,row_count:previous.row_count+page.row_count,buckets:mergeBuckets(previous.buckets,page.buckets)}:{...page};
  // A resumed legacy/stale prefix can never be blessed by a new or empty page.
  if(previous?.incomplete || !continuous)result.incomplete=true;
  if(page.daily || previous?.daily) {
    const old=decodeUnitDaily(previous),fresh=decodeUnitDaily(page);
    result.daily=encodeUnitDaily(mergeBuckets(old?.buckets||[],fresh?.buckets||[],true),{
      cursor_id:page.cursor_id,row_count:result.row_count,
      covered_rows:(old?.covered_rows||0)+(fresh?.covered_rows||0),
      history_complete:!!(continuous && !result.incomplete && (!previous || old?.history_complete) && fresh?.history_complete)});
  }
  return result;
}
// Validate the entire saved daily prefix against every monthly SKU/category
// before clipping. A matching last cursor alone is not proof of old coverage.
export function clipUnitFinance(unit:any,period:{dateFrom:string,dateTo:string},range:{dateFrom:string,dateTo:string}) {
  const d=decodeUnitDaily(unit);
  if(unit?.version!==1 || unit.incomplete || !d || d.history_complete!==true
    || d.cursor_id!==unit.cursor_id || d.row_count!==unit.row_count || d.covered_rows!==unit.row_count
    || typeof range.dateFrom!=='string' || range.dateFrom.length!==10 || operationDay(range.dateFrom)!==range.dateFrom
    || typeof range.dateTo!=='string' || range.dateTo.length!==10 || operationDay(range.dateTo)!==range.dateTo
    || range.dateFrom<period.dateFrom || range.dateTo>period.dateTo || range.dateFrom>range.dateTo
    || !Array.isArray(d.buckets))return null;
  const seen=new Set();
  for(const b of d.buckets) {
    const key=JSON.stringify([b.day,b.key]);
    if(typeof b.day!=='string' || b.day.length!==10 || operationDay(b.day)!==b.day || b.day<period.dateFrom || b.day>period.dateTo || seen.has(key)
      || !Number.isSafeInteger(b.rows) || b.rows<=0 || !Number.isSafeInteger(b.quantity) || !b.totals)return null;
    seen.add(key);
  }
  const all=mergeBuckets([],d.buckets);
  if(all.length!==unit.buckets.length || all.reduce((n,b)=>n+b.rows,0)!==unit.row_count)return null;
  const byKey=new Map(all.map(b=>[b.key,b]));
  for(const b of unit.buckets) {
    const day=byKey.get(b.key);
    if(!day || day.rows!==b.rows || day.quantity!==b.quantity)return null;
    for(const [key,value] of Object.entries(b.totals)) {
      if(value==null ? day.totals[key]!==null : day.totals[key]==null || cents(value)!==cents(day.totals[key]))return null;
    }
  }
  const buckets=mergeBuckets([],d.buckets.filter((b:any)=>b.day>=range.dateFrom && b.day<=range.dateTo))
    .map(({day,...b}:any)=>b);
  return {version:1,cursor_id:unit.cursor_id,row_count:buckets.reduce((n,b)=>n+b.rows,0),buckets};
}
const ratio=(numerator:unknown,denominator:unknown)=>numerator==null || denominator==null || cents(denominator)<=0n ? null : Number(cents(numerator))/Number(cents(denominator))*100;
function ledger(finance:any) {
  const f=(key:string)=>cents(finance[key]);
  return [
    ['commission','Комиссия и расчёты WB',finance.salesAmount==null?null:rub(f('salesAmount')-f('forPay'))],
    ['logistics','Логистика',finance.deliveryService],['storage','Хранение',finance.paidStorage],
    ['acceptance','Приёмка',finance.paidAcceptance],['penalty','Штрафы',finance.penalty],
    ['deductions','Прочие удержания',rub(f('deduction')-f('advertisingDeductions'))],
    ['corrections','Корректировка вознаграждения',finance.additionalPayment],
    ['loyalty','Отзывы и лояльность',rub(f('cashbackAmount')+f('cashbackCommissionChange')-f('cashbackDiscount'))],
    ['internal','Внутренняя реклама в финансовом отчёте',rub(f('advertisingDeductions')-f('wbMediaDeductions'))],
    ['media','WB Медиа в финансовом отчёте',finance.wbMediaDeductions],
  ].map(([key,label,amount])=>({key,label,amount}));
}
export function calculateUnit(cabinet:any,unit:any) {
  if(unit?.version!==1 || unit.incomplete || unit.row_count!==Number(cabinet.job.row_count)
    || unit.buckets.reduce((n:number,b:any)=>n+b.rows,0)!==Number(cabinet.job.row_count))return {status:'needs_preparation',products:[]};
  // Validate every monetary field independently, not just the final profit.
  for(const [key,value] of Object.entries(cabinet.finance)) {
    if(key==='bought_qty')continue;
    const total=unit.buckets.some((b:any)=>b.totals[key]===null)?null:rub(unit.buckets.reduce((n:bigint,b:any)=>n+cents(b.totals[key]),0n));
    if(value==null ? total!==null : cents(value)!==cents(total))throw new ApiError(409,'Расходы по артикулам не совпали с финансовым итогом. Обновите месяц.');
  }
  const catalogue=new Map(cabinet.products.map((p:any)=>[articleKey(p.article),p]));
  const make=(bucket:any)=>{
    const product:any=catalogue.get(bucket.key),price=product?.cost_price;
    const cogs=bucket.quantity!==0 && !hasCostPrice(product)?null:rub(BigInt(bucket.quantity)*cents(price));
    const e=economy(bucket.totals,cogs,{operational_expenses:'0.00',external_promotion_expenses:'0.00'},'0.00',{paid:'0.00',bonus:'0.00',unknown:[]},cabinet.shop.tax_rate,0,true)!;
    // Direct advertising is the deduction identified by WB on this article.
    // Do not add it back or subtract the shop's advertising totals a second time.
    const profit=cogs==null || e.tax==null || bucket.totals.salesAmount==null ? null : rub(cents(e.payout)-cents(cogs)-cents(e.tax));
    const expenses=[...ledger(bucket.totals),{key:'cogs',label:'Себестоимость',amount:cogs},{key:'tax',label:'Налог с продаж',amount:e.tax}];
    const total=expenses.some(e=>e.amount==null)?null:rub(expenses.reduce((n,e)=>n+cents(e.amount),0n));
    return {article:bucket.article,name:product?.name||bucket.name||bucket.article,quantity:bucket.quantity,sales:bucket.totals.salesAmount,
      expenses,total_expenses:total,net_profit:profit,margin:ratio(profit,bucket.totals.salesAmount),profitability:ratio(profit,total),
      cost_price:price??null,missing_costs:cogs==null};
  };
  const products=unit.buckets.filter((b:any)=>b.key).map(make);
  const sharedBucket=unit.buckets.find((b:any)=>!b.key);
  const shared=sharedBucket?make(sharedBucket):null;
  const all=shared?[...products,shared]:products;
  if(cabinet.economy.tax!=null && all.length && all.every(p=>p.expenses.find(e=>e.key==='tax')?.amount!=null)) {
    const delta=cents(cabinet.economy.tax)-all.reduce((n,p)=>n+cents(p.expenses.find(e=>e.key==='tax')!.amount),0n);
    const target=[...all].sort((a,b)=>Math.abs(Number(b.sales))-Math.abs(Number(a.sales)))[0];
    const tax=target.expenses.find(e=>e.key==='tax')!;tax.amount=rub(cents(tax.amount)+delta);
    if(target.total_expenses!=null)target.total_expenses=rub(cents(target.total_expenses)+delta);
    if(target.net_profit!=null)target.net_profit=rub(cents(target.net_profit)-delta);
    target.margin=ratio(target.net_profit,target.sales);target.profitability=ratio(target.net_profit,target.total_expenses);
  }
  const common=shared?.expenses.filter((e:any)=>e.key!=='cogs')||[];
  // Account-level actual advertising is not attributable to products. Preserve
  // the signed source adjustment separately; it can be negative across dates.
  common.push({key:'ads_difference',label:'Реклама магазина: разница источников',amount:cabinet.economy.advertising_total==null?null:rub(
    cents(cabinet.economy.internal_ads)+cents(cabinet.sources.media.amount)-cents(cabinet.finance.advertisingDeductions))},
    {key:'operating',label:'Операционные расходы',amount:rub(cents(cabinet.settings.operational_expenses))},
    {key:'external',label:'Внешнее продвижение',amount:rub(cents(cabinet.settings.external_promotion_expenses))});
  if(shared && cents(shared.sales)!==0n)common.push({key:'unidentified_sales',label:'Продажи без артикула (справочно)',amount:shared.sales,reference:true});
  const sum=(key:string)=>products.some((p:any)=>p[key]==null)?null:rub(products.reduce((n:bigint,p:any)=>n+cents(p[key]),0n));
  return {status:'ready',products,common_expenses:common,unidentified:shared,
    totals:{sales:sum('sales'),expenses:sum('total_expenses'),net_profit:sum('net_profit')},
    method:'direct_only',tax_basis:'current_shop_rate',advertising_basis:'article_financial_deduction'};
}
export function attachArticleAds(result:any,source:any,orders:any[],cabinet:any) {
  const ads=articleAdvertising(source,orders);
  // Advertising-only SKUs remain visible even when they had no financial rows.
  for(const [key,a] of ads.products)if(!result.products.some((p:any)=>articleKey(p.article)===key)) {
    result.products.push({article:a.article,name:a.name||a.article,quantity:0,sales:'0.00',
      expenses:result.products[0]?.expenses.map((e:any)=>({...e,amount:'0.00'}))||[
        ...ledger(Object.fromEntries(Object.keys(cabinet.finance).map(k=>[k,'0.00']))),
        {key:'cogs',label:'Себестоимость',amount:'0.00'},{key:'tax',label:'Налог с продаж',amount:'0.00'}],
      total_expenses:'0.00',net_profit:'0.00',cost_price:null,missing_costs:false});
  }
  let adjustment=0n;
  for(const p of result.products) {
    const a=ads.products.get(articleKey(p.article));
    const amount=ads.unassigned?null:a?.amount??(a?null:'0.00');
    const e=p.expenses.find((e:any)=>e.key==='internal');
    const withheld=cents(e.amount);adjustment+=withheld;
    e.label='Внутренняя реклама';e.amount=amount;
    p.internal_ads=amount;p.ad_stats_amount=a?.stats_amount??(ads.unassigned?null:'0.00');
    p.advertising_unknown=amount==null;
    if(amount==null){p.net_profit=null;p.total_expenses=null;}
    else {
      adjustment-=cents(amount);
      if(p.net_profit!=null)p.net_profit=rub(cents(p.net_profit)+withheld-cents(amount));
      if(p.total_expenses!=null)p.total_expenses=rub(cents(p.total_expenses)-withheld+cents(amount));
    }
    p.drr=ratio(amount,p.sales);p.margin=ratio(p.net_profit,p.sales);p.profitability=ratio(p.net_profit,p.total_expenses);
  }
  // Remove the shared financial advertising debit now attributed to SKUs.
  // Fold its add-back into one signed residual, instead of displaying two
  // huge cancelling lines as if both were still common advertising costs.
  const sharedInternal=result.common_expenses.find((e:any)=>e.key==='internal');
  adjustment+=cents(sharedInternal?.amount);
  result.common_expenses=result.common_expenses.filter((e:any)=>e.key!=='internal');
  const common=result.common_expenses.find((e:any)=>e.key==='ads_difference');
  if(common)common.label='Реклама без привязки к товару';
  if(common)common.amount=ads.unassigned||result.products.some((p:any)=>p.advertising_unknown)||common.amount==null?null:rub(cents(common.amount)+adjustment);
  const sum=(key:string)=>result.products.some((p:any)=>p[key]==null)?null:rub(result.products.reduce((n:bigint,p:any)=>n+cents(p[key]),0n));
  result.totals={sales:sum('sales'),expenses:sum('total_expenses'),net_profit:sum('net_profit'),internal_ads:sum('internal_ads')};
  result.advertising_basis='campaign_sku_stats_and_money_debits';
  return result;
}
export function unitMonths(from:unknown,to:unknown) {
  const first=cabinetPeriod(from),last=cabinetPeriod(to);
  if(first.dateFrom>last.dateFrom)throw new ApiError(400,'Начало периода должно быть раньше окончания');
  const months:string[]=[];
  for(let date=new Date(first.dateFrom+'T00:00:00Z');date.toISOString().slice(0,7)<=String(to);date.setUTCMonth(date.getUTCMonth()+1)) {
    if(months.length===12)throw new ApiError(400,'Доступны текущий и 11 предыдущих месяцев');
    months.push(date.toISOString().slice(0,7));
  }
  return months;
}
function rangeCabinet(cabinet:any,unit:any,ads:any,period:any) {
  let model=aggregateFinanceRows([]);
  for(const b of unit.buckets)model=mergeFinanceModels(model,{row_count:b.rows,sales_covered_rows:b.rows,
    bought_qty:b.quantity,totals:b.totals,products:[]});
  const finance={...model.totals,bought_qty:model.bought_qty};
  const settings={operational_expenses:'0.00',external_promotion_expenses:'0.00'};
  // Only dated financial Media deductions can answer a sub-month period.
  // A monthly Media API amount (even estimated) has no daily allocation here.
  const media=cabinet.sources.media.source==='wb_financial_deductions'?finance.wbMediaDeductions:null;
  const types=ads.campaigns.reduce((totals:any,c:any)=>{
    for(const [key,v] of Object.entries(c.totals) as [string,any][])totals[key]={amount:rub(cents(totals[key]?.amount)+cents(v.amount))};
    return totals;
  },{});
  return {...cabinet,period,finance,settings,job:{...cabinet.job,row_count:unit.row_count},
    sources:{...cabinet.sources,media:{...cabinet.sources.media,amount:media}},
    economy:economy(finance,null,settings,media,advertising(types),cabinet.shop.tax_rate,0,true)};
}
export async function readUnit(admin:any,shopId:string,from:unknown,to:unknown,range?:{dateFrom:string,dateTo:string}) {
  validateShopId(shopId);
  const months=unitMonths(from,to),items:any[]=[],pending:any[]=[];
  let requested:{dateFrom:string,dateTo:string}|undefined;
  if(range!==undefined) {
    requested=validatePeriod(range?.dateFrom,range?.dateTo);
    if(requested.dateFrom.slice(0,7)!==from || requested.dateTo.slice(0,7)!==to)
      throw new ApiError(400,'Даты должны соответствовать выбранным месяцам');
  }
  const basis={date:'rrDate',timezone:'Europe/Moscow',revenue:'seller_price',tax:'current_shop_rate',
    expenses:'direct_only',advertising:'campaign_sku_stats_and_money_debits',manual_expenses:'excluded_from_sku'};
  const needs=(month:string,cabinet:any,sources:string[])=>pending.push({month,
    status:(cabinet.refresh_job||cabinet.job)?.status==='loading'?'loading':'needs_preparation',
    error:(cabinet.refresh_job||cabinet.job)?.error_message||null,required_sources:sources});
  const [shop,settings,costs]=await Promise.all([
    admin.from('shops').select('id,name,tax_rate').eq('id',shopId).single(),
    admin.from('wb_api_month_settings').select('month,operational_expenses,external_promotion_expenses').eq('shop_id',shopId),
    readCostPrices(admin,shopId),
  ]);
  if(shop.error || settings.error || costs.error)throw new ApiError(500,'Не удалось прочитать настройки юнит-экономики');
  const catalog={shop:shop.data,settings:settings.data||[],costs:costs.data||[]};
  for(const month of months) {
    const cabinet=await readCabinet(admin,shopId,cabinetPeriod(month),undefined,catalog);
    if(!cabinet.complete || !cabinet.finance){needs(month,cabinet,['monthly_sources']);continue;}
    const period=requested?{dateFrom:requested.dateFrom>cabinet.period.dateFrom?requested.dateFrom:cabinet.period.dateFrom,
      dateTo:requested.dateTo<cabinetPeriod(month).dateTo?requested.dateTo:cabinetPeriod(month).dateTo}:cabinet.period;
    if(requested && (cabinet.period.dateFrom!==month+'-01' || cabinet.period.dateTo<period.dateTo)) {
      needs(month,cabinet,['finance_period']);continue;
    }
    const partial=period.dateFrom!==cabinet.period.dateFrom || period.dateTo!==cabinet.period.dateTo;
    const calendarEnd=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
    // Matching a current-month snapshot permits the monthly SKU fast path,
    // but does not give month-only manual expenses dates within that snapshot.
    const excludeManual=!!requested && (period.dateFrom!==month+'-01' || period.dateTo!==calendarEnd);
    const {data:job,error}=await admin.from('wb_api_preview_jobs').select('cursor_id,unit:finance_model->unit,article_ads:summary->api_sources->article_ads,orders:summary->api_sources->orders->rows').eq('shop_id',shopId).eq('id',cabinet.job.id).single();
    if(error || !job)throw new ApiError(500,'Не удалось прочитать юнит-экономику');
    if(job.article_ads?.version!==1 || job.article_ads.status!=='downloaded' || (job.article_ads.date_from && (job.article_ads.date_from!==cabinet.period.dateFrom || job.article_ads.date_to!==cabinet.period.dateTo))){needs(month,cabinet,['article_ads']);continue;}
    let result=job.unit?.cursor_id===String(job.cursor_id)?calculateUnit(cabinet,job.unit):{status:'needs_preparation'};
    if(result.status!=='ready'){needs(month,cabinet,['unit_finance']);continue;}
    let source=job.article_ads,selected=cabinet;
    if(partial) {
      const unit=clipUnitFinance(job.unit,cabinet.period,period),ads=clipArticleAdvertising(source,period);
      const missing=[...(!unit?['unit_daily_finance']:[]),...(!ads?['article_ads_daily']:[])];
      if(missing.length){needs(month,cabinet,missing);continue;}
      source=ads;selected=rangeCabinet(cabinet,unit,ads,period);result=calculateUnit(selected,unit);
    }
    result=attachArticleAds(result,source,job.orders,selected);
    for(const e of result.common_expenses) {
      if(excludeManual && ['operating','external'].includes(e.key))Object.assign(e,{amount:null,excluded:true,reason:'monthly_expense_without_dates'});
      if(partial && e.key==='ads_difference' && selected.sources.media.amount==null)Object.assign(e,{unavailable:true,reason:'media_daily_unavailable'});
    }
    items.push({...result,media_estimated:!!cabinet.sources.media.estimated,month,period,partial,exclude_manual:excludeManual,updated_at:cabinet.job.updated_at});
  }
  if(pending.length)return {status:pending.some(p=>p.status==='loading')?'loading':'needs_preparation',pending,products:[],months,
    ...(requested?{period:requested}:{}),date_basis:'financial_operation_date',basis};
  const products=new Map<string,any>();const common=new Map<string,any>();
  for(const item of items) {
    for(const p of item.products) {
      const key=articleKey(p.article),old=products.get(key);
      if(!old){products.set(key,structuredClone(p));continue;}
      const add=(a:any,b:any)=>a==null||b==null?null:rub(cents(a)+cents(b));
      for(const field of ['sales','total_expenses','net_profit','internal_ads','ad_stats_amount'])old[field]=add(old[field],p[field]);
      old.quantity+=p.quantity;old.missing_costs ||= p.missing_costs;old.advertising_unknown ||= p.advertising_unknown;
      old.expenses.forEach((e:any,i:number)=>e.amount=add(e.amount,p.expenses[i].amount));
      old.drr=ratio(old.internal_ads,old.sales);old.margin=ratio(old.net_profit,old.sales);old.profitability=ratio(old.net_profit,old.total_expenses);
    }
    for(const entry of item.common_expenses) {
      const old=common.get(entry.key);
      common.set(entry.key,old?{...old,...entry,...(old.excluded?{excluded:true,reason:old.reason}:{}),
        ...(old.unavailable?{unavailable:true,reason:old.reason}:{}),amount:old.amount==null||entry.amount==null?null:rub(cents(old.amount)+cents(entry.amount))}:{...entry});
    }
  }
  const rows=[...products.values()].sort((a,b)=>Number(b.sales)-Number(a.sales));
  const sum=(key:string)=>rows.some(p=>p[key]==null)?null:rub(rows.reduce((n,p)=>n+cents(p[key]),0n));
  const totals={sales:sum('sales'),expenses:sum('total_expenses'),net_profit:sum('net_profit'),internal_ads:sum('internal_ads'),drr:ratio(sum('internal_ads'),sum('sales'))};
  return {status:'ready',method:'direct_only',products:rows,common_expenses:[...common.values()],media_estimated:items.some(p=>p.media_estimated),totals:{...totals,margin:ratio(totals.net_profit,totals.sales),profitability:ratio(totals.net_profit,totals.expenses)},months,
    period:requested||{dateFrom:items[0].period.dateFrom,dateTo:items.at(-1).period.dateTo},date_basis:'financial_operation_date',basis:{...basis,finance:items.some(p=>p.partial)?'daily_sku':'monthly_sku'},
    excluded_expenses:items.filter(p=>p.exclude_manual).flatMap(p=>['operating','external'].map(key=>({month:p.month,key,reason:'monthly_expense_without_dates'}))),
    common_expense_notes:[...(items.some(p=>p.exclude_manual)?['Ручные расходы месяца без дат исключены из неполных месяцев. Общие расходы не включаются в прибыль SKU.']:[]),
      ...(items.some(p=>p.common_expenses.some((e:any)=>e.reason==='media_daily_unavailable'))?['Общая корректировка рекламы неизвестна: у WB Медиа нет дневной детализации.']:[])],
    updated_at:items.map(p=>p.updated_at).sort()[0]};
}
