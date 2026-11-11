import { ApiError, cents, rub } from './core.ts';
import { aggregateFinanceRows, readCabinet } from './cabinet.ts';
import { advertising, economy } from './economy.ts';
import { articleKey } from './articles.ts';

// Dates with no offset are WB's Moscow calendar dates. Offset timestamps are
// converted to Moscow, matching advertising. Never substitute the sale date
// for a missing financial-operation date: services and returns would drift.
export function operationDay(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return null;
  const raw=value.slice(0,10), check=new Date(raw+'T00:00:00Z');
  if (!Number.isFinite(check.getTime()) || check.toISOString().slice(0,10)!==raw) return null;
  if (value.length===10 || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return raw;
  const time=Date.parse(value);
  return Number.isFinite(time) ? new Date(time+3*3600000).toISOString().slice(0,10) : null;
}
const daysBetween=(from:string,to:string)=>{
  const days:string[]=[];
  for(let date=new Date(from+'T00:00:00Z');date.toISOString().slice(0,10)<=to;date.setUTCDate(date.getUTCDate()+1)) days.push(date.toISOString().slice(0,10));
  return days;
};
function addMoney(left:any,right:any) {
  const keys=new Set([...Object.keys(left||{}),...Object.keys(right||{})]);
  return Object.fromEntries([...keys].map(key=>[key,(key==='salesAmount' && (left?.[key]===null || right?.[key]===null)) ? null : rub(cents(left?.[key])+cents(right?.[key]))]));
}
export function aggregateDailyFinance(rows:any[],period:any,cursor='0') {
  const groups=new Map<string,any[]>();
  for(const row of rows) {
    const day=operationDay(row.rrDate);
    const key=day && day>=period.dateFrom && day<=period.dateTo ? day : 'unallocated';
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key)!.push(row);
  }
  const days=Object.fromEntries([...groups].sort(([a],[b])=>a.localeCompare(b)).map(([date,items])=>{
    const model=aggregateFinanceRows(items);
    return [date,{rows:items.length,totals:model.totals,quantity:model.bought_qty,
      products:model.products.filter((p:any)=>p.bought_qty!==0).map((p:any)=>({article:p.article,quantity:p.bought_qty}))}];
  }));
  return {version:1,date_from:period.dateFrom,date_to:period.dateTo,cursor_id:cursor,row_count:rows.length,days};
}
export function mergeDailyFinance(previous:any,page:any) {
  if(!previous)return page;
  if(previous.version!==1 || previous.date_from!==page.date_from || previous.date_to!==page.date_to) return page;
  const days:any=structuredClone(previous.days);
  for(const [date,p] of Object.entries(page.days) as [string,any][]) {
    const old=days[date];
    if(!old){days[date]=p;continue;}
    const quantities=new Map<string,number>();
    for(const row of [...old.products,...p.products])quantities.set(row.article,(quantities.get(row.article)||0)+row.quantity);
    days[date]={rows:old.rows+p.rows,quantity:old.quantity+p.quantity,totals:addMoney(old.totals,p.totals),
      products:[...quantities].filter(([,n])=>n!==0).map(([article,quantity])=>({article,quantity}))};
  }
  return {...page,row_count:previous.row_count+page.row_count,days:Object.fromEntries(Object.entries(days).sort(([a],[b])=>a.localeCompare(b)))};
}

// Equal distribution in integer kopecks, including negative adjustments.
export function allocateAmount(value:unknown,dates:string[]) {
  if(!dates.length)throw new ApiError(500,'Не удалось распределить расходы');
  const total=cents(value),n=BigInt(dates.length),base=total/n,remainder=total%n;
  return new Map(dates.map((date,i)=>[date,base+(BigInt(i)<(remainder<0n?-remainder:remainder)?(remainder<0n?-1n:1n):0n)]));
}
function financeCogs(bucket:any,prices:Map<string,any>) {
  let cost=0n;const missing:string[]=[];
  for(const product of bucket.products || []) {
    const price=prices.get(articleKey(product.article));
    if(product.quantity!==0 && !(Number(price)>0)){missing.push(product.article);continue;}
    cost+=BigInt(product.quantity)*cents(price);
  }
  return {amount:missing.length?null:rub(cost),missing};
}
export function calculateDaily(cabinet:any,daily:any,adsDaily:any) {
  const period=cabinet.period,dates=daysBetween(period.dateFrom,period.dateTo);
  const expected=Number(cabinet.job.row_count);
  if(daily?.version!==1 || daily.row_count!==expected || daily.date_from!==period.dateFrom || daily.date_to!==period.dateTo)
    return {status:'needs_preparation',days:[],monthly_profit:cabinet.net_profit};
  if(cabinet.sources.ads?.undated)throw new ApiError(409,'В рекламе есть списания без даты. Ежедневная прибыль пока неизвестна.');
  if(cabinet.sources.media.amount==null)throw new ApiError(409,'Расходы WB Медиа ещё не получены. Ежедневная прибыль пока неизвестна.');
  if(Object.values(daily.days||{}).reduce((sum:number,b:any)=>sum+b.rows,0)!==expected)
    throw new ApiError(500,'Дневные данные не прошли проверку полноты');
  const totalFinance=Object.values(daily.days||{}).reduce((sum:any,b:any)=>addMoney(sum,b.totals),{});
  for(const [key,value] of Object.entries(cabinet.finance || {})) {
    if(key==='bought_qty')continue;
    if(value==null ? totalFinance[key]!==null : cents(value)!==cents(totalFinance[key]))
      throw new ApiError(409,'Дневные и месячные данные различаются. Обновите месяц.');
  }
  // An empty received advertising response is a verified zero, not missing.
  if(!adsDaily || typeof adsDaily!=='object')return {status:'needs_preparation',days:[],monthly_profit:cabinet.net_profit};
  const paidByDay=new Map<string,string>(),bonusByDay=new Map<string,string>();
  let paid=0n,bonus=0n;
  for(const [date,totals] of Object.entries(adsDaily)) {
    if(!dates.includes(date))throw new ApiError(409,'Рекламные списания выходят за выбранный период');
    const ads=advertising(totals);
    if(ads.unknown.length)throw new ApiError(409,'Неизвестный тип рекламного списания');
    paid+=cents(ads.paid);bonus+=cents(ads.bonus);paidByDay.set(date,ads.paid);bonusByDay.set(date,ads.bonus);
  }
  if(paid!==cents(cabinet.economy.internal_ads) || bonus!==cents(cabinet.economy.promo))
    throw new ApiError(409,'Не все рекламные расходы распределены по дням. Обновите месяц.');
  const prices=new Map<string,any>(cabinet.products.map((p:any)=>[articleKey(p.article),p.cost_price]));
  const operating=allocateAmount(cabinet.settings.operational_expenses,dates);
  const external=allocateAmount(cabinet.settings.external_promotion_expenses,dates);
  const financialMedia=cabinet.sources.media.source==='wb_financial_deductions';
  const mediaAllocation=financialMedia ? null : allocateAmount(cabinet.sources.media.amount,dates);
  const makeRow=(date:string)=>{
    const bucket=daily.days[date] || {rows:0,totals:aggregateFinanceRows([]).totals,products:[],quantity:0};
    const cogs=financeCogs(bucket,prices),undated=date==='unallocated';
    const ads={paid:paidByDay.get(date)||'0.00',bonus:bonusByDay.get(date)||'0.00',unknown:[]};
    const media=financialMedia ? bucket.totals.wbMediaDeductions : rub(mediaAllocation?.get(date)||0n);
    const settings={operational_expenses:rub(operating.get(date)||0n),external_promotion_expenses:rub(external.get(date)||0n)};
    const e=economy(bucket.totals,cogs.amount,settings,media,ads,cabinet.shop.tax_rate,0,true);
    const f=(key:string)=>cents(bucket.totals[key]);
    const expenses=[
      ['commission','Комиссия и расчёты WB',bucket.totals.salesAmount==null?null:rub(f('salesAmount')-f('forPay'))],
      ['logistics','Логистика',bucket.totals.deliveryService],['storage','Хранение',bucket.totals.paidStorage],
      ['acceptance','Приёмка',bucket.totals.paidAcceptance],['penalty','Штрафы',bucket.totals.penalty],
      ['deductions','Прочие удержания',rub(f('deduction')-f('advertisingDeductions'))],
      ['corrections','Корректировка вознаграждения',bucket.totals.additionalPayment],
      ['loyalty','Отзывы и лояльность',rub(f('cashbackAmount')+f('cashbackCommissionChange')-f('cashbackDiscount'))],
      ['cogs','Себестоимость',cogs.amount],['tax','Налог',e!.tax],
      ['internal','Внутренняя реклама',ads.paid],['media','WB Медиа',media],
      ['operating','Операционные расходы',settings.operational_expenses],['external','Внешнее продвижение',settings.external_promotion_expenses],
    ].map(([key,label,amount])=>({key,label,amount,allocated:['operating','external'].includes(key!) || (key==='media' && !financialMedia)}));
    return {date,rows:bucket.rows,sales:bucket.totals.salesAmount,quantity:bucket.quantity,payout:e!.payout,cogs:cogs.amount,
      tax:e!.tax,internal_ads:ads.paid,promo:ads.bonus,media_ads:media,
      operational_expenses:settings.operational_expenses,external_promotion_expenses:settings.external_promotion_expenses,
      marketplace_expenses:bucket.totals.salesAmount==null?null:rub(cents(bucket.totals.salesAmount)-cents(e!.payout)),
      advertising_already_withheld:e!.advertising_already_withheld,net_profit:e!.net_profit,
      missing_costs:cogs.missing,missing:e!.missing,expenses,allocated:!undated && (!!cents(settings.operational_expenses)||!!cents(settings.external_promotion_expenses)||(!financialMedia && !!cents(media)))};
  };
  const rows=dates.map(makeRow),unallocated=daily.days.unallocated ? makeRow('unallocated') : null;
  const all=unallocated?[...rows,unallocated]:rows;
  // Round tax at month level, just like the overview, and reconcile kopecks.
  let taxRounding='0.00';
  if(cabinet.economy.tax!=null && all.every(r=>r.tax!=null)) {
    const delta=cents(cabinet.economy.tax)-all.reduce((sum,r)=>sum+cents(r.tax),0n);
    const last=[...all].reverse().find(r=>cents(r.sales)!==0n)||rows[rows.length-1];
    taxRounding=rub(delta);last.tax=rub(cents(last.tax)+delta);
    last.expenses.find(item=>item.key==='tax')!.amount=last.tax;
    if(last.net_profit!=null)last.net_profit=rub(cents(last.net_profit)-delta);
  }
  let accumulated=0n,known=true;
  for(const row of rows){if(row.net_profit==null)known=false;else accumulated+=cents(row.net_profit);(row as any).cumulative_profit=known?rub(accumulated):null;}
  const total=all.some(r=>r.net_profit==null)?null:rub(all.reduce((sum,r)=>sum+cents(r.net_profit),0n));
  if(cabinet.net_profit!=null && total!==cabinet.net_profit)throw new ApiError(409,'Сумма ежедневной прибыли не совпала с обзором. Проверьте себестоимость и обновите месяц.');
  return {status:'ready',days:rows,unallocated,monthly_profit:total,tax_rounding:taxRounding,
    allocation:'equal_elapsed_days',media_allocation:!financialMedia,timezone:'Europe/Moscow',date_basis:'rrDate'};
}

export async function readDaily(admin:any,shopId:string,period:any) {
  const cabinet=await readCabinet(admin,shopId,period);
  const {data:months,error:monthsError}=await admin.from('wb_api_preview_jobs').select('date_from').eq('shop_id',shopId).eq('status','complete').order('date_from',{ascending:false});
  if(monthsError)throw new ApiError(500,'Не удалось прочитать периоды аналитики');
  const monthValues=[...new Set((months||[]).map((p:any)=>p.date_from.slice(0,7)))].slice(0,12);
  const common={period:cabinet.period || period,months:monthValues,updated_at:cabinet.job?.updated_at || null,
    refreshing:(cabinet.refresh_job || cabinet.job)?.status==='loading',refresh_error:(cabinet.refresh_job || cabinet.job)?.error_message || null,
    monthly_profit:cabinet.net_profit??null};
  if(!cabinet.complete || !cabinet.finance)return {...common,status:common.refreshing?'loading':'needs_preparation',days:[]};
  const {data:job,error}=await admin.from('wb_api_preview_jobs').select('cursor_id,daily:finance_model->daily,ads_daily:summary->api_sources->internal_ads->daily_totals')
    .eq('shop_id',shopId).eq('id',cabinet.job.id).single();
  if(error || !job)throw new ApiError(500,'Не удалось прочитать ежедневную аналитику');
  const daily=job.daily;
  if(daily?.cursor_id!==String(job.cursor_id))return {...common,status:common.refreshing?'loading':'needs_preparation',days:[]};
  const result=calculateDaily(cabinet,daily,job.ads_daily);
  return {...common,...result,status:result.status==='needs_preparation' && common.refreshing?'loading':result.status};
}
