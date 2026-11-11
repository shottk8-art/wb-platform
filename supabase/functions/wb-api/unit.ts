import { ApiError, cents, rub } from './core.ts';
import { aggregateFinanceRows, mergeFinanceModels, readCabinet, readCostPrices, cabinetPeriod } from './cabinet.ts';
import { articleKey } from './articles.ts';
import { articleAdvertising } from './article-ads.ts';
import { economy } from './economy.ts';

// Compact, pilot-only financial totals per article. Never persist source rows.
export function aggregateUnitFinance(rows:any[],cursor='0') {
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
export function mergeUnitFinance(previous:any,page:any) {
  if(!previous)return page;
  const buckets=new Map(previous.buckets.map((p:any)=>[p.key,{...p}]));
  for(const p of page.buckets) {
    const old:any=buckets.get(p.key);
    if(!old){buckets.set(p.key,p);continue;}
    const totals=mergeFinanceModels({row_count:old.rows,sales_covered_rows:old.rows,bought_qty:old.quantity,totals:old.totals,products:[]},
      {row_count:p.rows,sales_covered_rows:p.rows,bought_qty:p.quantity,totals:p.totals,products:[]}).totals;
    buckets.set(p.key,{...old,name:old.name||p.name,rows:old.rows+p.rows,quantity:old.quantity+p.quantity,totals});
  }
  return {...page,row_count:previous.row_count+page.row_count,buckets:[...buckets.values()]};
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
  if(unit?.version!==1 || unit.row_count!==Number(cabinet.job.row_count)
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
    const cogs=bucket.quantity!==0 && !(Number(price)>0)?null:rub(BigInt(bucket.quantity)*cents(price));
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
  for(let date=new Date(first.dateFrom+'T00:00:00Z');date.toISOString().slice(0,7)<=String(to);date.setUTCMonth(date.getUTCMonth()+1))months.push(date.toISOString().slice(0,7));
  return months;
}
export async function readUnit(admin:any,shopId:string,from:unknown,to:unknown) {
  const months=unitMonths(from,to),items:any[]=[],pending:any[]=[];
  const [shop,settings,costs]=await Promise.all([
    admin.from('shops').select('id,name,tax_rate').eq('id',shopId).single(),
    admin.from('wb_api_month_settings').select('month,operational_expenses,external_promotion_expenses').eq('shop_id',shopId),
    readCostPrices(admin,shopId),
  ]);
  if(shop.error || settings.error || costs.error)throw new ApiError(500,'Не удалось прочитать настройки юнит-экономики');
  const catalog={shop:shop.data,settings:settings.data||[],costs:costs.data||[]};
  for(const month of months) {
    const cabinet=await readCabinet(admin,shopId,cabinetPeriod(month),undefined,catalog);
    if(!cabinet.complete || !cabinet.finance){pending.push({month,status:(cabinet.refresh_job||cabinet.job)?.status==='loading'?'loading':'needs_preparation',error:cabinet.job?.error_message||null});continue;}
    const {data:job,error}=await admin.from('wb_api_preview_jobs').select('cursor_id,unit:finance_model->unit,article_ads:summary->api_sources->article_ads,orders:summary->api_sources->orders->rows').eq('shop_id',shopId).eq('id',cabinet.job.id).single();
    if(error || !job)throw new ApiError(500,'Не удалось прочитать юнит-экономику');
    if(job.article_ads?.version!==1 || job.article_ads.status!=='downloaded' || (job.article_ads.date_from && (job.article_ads.date_from!==cabinet.period.dateFrom || job.article_ads.date_to!==cabinet.period.dateTo))){pending.push({month,status:cabinet.refresh_job?.status==='loading'?'loading':'needs_preparation',error:cabinet.refresh_job?.error_message||null});continue;}
    const result=job.unit?.cursor_id===String(job.cursor_id)?calculateUnit(cabinet,job.unit):{status:'needs_preparation'};
    if(result.status!=='ready')pending.push({month,status:cabinet.refresh_job?.status==='loading'?'loading':'needs_preparation',error:cabinet.refresh_job?.error_message||null});
    else items.push({...attachArticleAds(result,job.article_ads,job.orders,cabinet),month,period:cabinet.period,updated_at:cabinet.job.updated_at});
  }
  if(pending.length)return {status:pending.some(p=>p.status==='loading')?'loading':'needs_preparation',pending,products:[],months};
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
      common.set(entry.key,old?{...entry,amount:old.amount==null||entry.amount==null?null:rub(cents(old.amount)+cents(entry.amount))}:{...entry});
    }
  }
  const rows=[...products.values()].sort((a,b)=>Number(b.sales)-Number(a.sales));
  const sum=(key:string)=>rows.some(p=>p[key]==null)?null:rub(rows.reduce((n,p)=>n+cents(p[key]),0n));
  const totals={sales:sum('sales'),expenses:sum('total_expenses'),net_profit:sum('net_profit'),internal_ads:sum('internal_ads'),drr:ratio(sum('internal_ads'),sum('sales'))};
  return {status:'ready',method:'direct_only',products:rows,common_expenses:[...common.values()],totals:{...totals,margin:ratio(totals.net_profit,totals.sales),profitability:ratio(totals.net_profit,totals.expenses)},months,
    period:{dateFrom:items[0].period.dateFrom,dateTo:items.at(-1).period.dateTo},updated_at:items.map(p=>p.updated_at).sort()[0]};
}
