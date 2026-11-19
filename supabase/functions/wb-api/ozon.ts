import {ApiError,cents as sourceCents,rub} from './core.ts';
import {articleKey,costCatalogue} from './articles.ts';
import {readCostPrices} from './cabinet.ts';
import {compareDaily} from './daily.ts';

function ozonPeriod(value:string){
 if(typeof value!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)||value<'2000-01'||value>new Date(Date.now()+3*3600000).toISOString().slice(0,7))throw new ApiError(400,'Выберите доступный месяц Ozon');
 const [y,m]=value.split('-').map(Number),last=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10),today=new Date(Date.now()+3*3600000).toISOString().slice(0,10);
 return {dateFrom:value+'-01',dateTo:last>today?today:last};
}
function ozonMonths(from:string,to:string){
 const first=ozonPeriod(from),last=ozonPeriod(to);if(first.dateFrom>last.dateFrom)throw new ApiError(400,'Начало периода должно быть раньше окончания');
 const months=[];for(let d=new Date(first.dateFrom+'T00:00:00Z');d.toISOString().slice(0,7)<=to;d.setUTCMonth(d.getUTCMonth()+1)){months.push(d.toISOString().slice(0,7));if(months.length>36)throw new ApiError(400,'Выберите диапазон до 36 месяцев');}return months;
}
type OzonRange={dateFrom:string,dateTo:string};
const isoDay=(value:any):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const monthEnd=(month:string)=>new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
function ozonRange(from:string,to:string,range:OzonRange){
 if(!range||!isoDay(range.dateFrom)||!isoDay(range.dateTo)||range.dateFrom>range.dateTo)throw new ApiError(400,'Укажите корректные даты Ozon');
 if(range.dateFrom<ozonPeriod(from).dateFrom||range.dateTo>ozonPeriod(to).dateTo)throw new ApiError(400,'Выберите даты в доступных месяцах Ozon, без будущих дат');
 return {dateFrom:range.dateFrom,dateTo:range.dateTo};
}
const cents=(value:unknown)=>{try{return sourceCents(value);}catch{throw new ApiError(409,'Не удалось проверить суммы Ozon. Повторно загрузите отчёт по начислениям.');}};
const sum=(items:any[],key:string)=>items.some(p=>p[key]==null)?null:rub(items.reduce((n,p)=>n+cents(p[key]),0n));
const ratio=(a:any,b:any)=>a==null||b==null||cents(b)<=0n?null:Number(cents(a))/Number(cents(b))*100;
const tax=(sales:any,rate:any)=>{
 const amount=cents(sales)*cents(rate||0),remainder=amount%10000n;
 // Match Math.round's signed half-cent rule without converting money to floats.
 return rub(amount/10000n+(remainder>=5000n?1n:remainder< -5000n?-1n:0n));
};
const ledger=(groups:any)=>Object.entries(groups||{}).map(([label,amount])=>({key:label==='Продвижение и реклама'?'internal':'ozon:'+label,label,amount:rub(-cents(amount))}));
const object=(value:any)=>value!=null&&typeof value==='object'&&!Array.isArray(value);
function validBucket(b:any){
 return object(b)&&Number.isSafeInteger(b.rows)&&b.rows>=0&&Number.isSafeInteger(b.quantity)&&b.sales!=null&&b.net!=null&&object(b.groups)
  &&Object.values(b.groups).every(v=>v!=null)&&cents(b.sales)+Object.values(b.groups).reduce((n:bigint,v:any)=>n+cents(v),0n)===cents(b.net)
  &&(b.rows>0||(b.quantity===0&&cents(b.sales)===0n&&cents(b.net)===0n&&Object.values(b.groups).every(v=>cents(v)===0n)));
}
function groupTotals(items:any[]){
 const groups=new Map<string,bigint>();for(const p of items)for(const [label,value] of Object.entries(p.groups))groups.set(label,(groups.get(label)||0n)+cents(value));return groups;
}
function sameGroups(a:any[],b:any[]){
 const left=groupTotals(a),right=groupTotals(b);return [...new Set([...left.keys(),...right.keys()])].every(k=>(left.get(k)||0n)===(right.get(k)||0n));
}
export function validateOzonModel(model:any,report:any){
 try{
 if(model?.version!==1||!isoDay(model.coverage?.from)||!isoDay(model.coverage?.to)||model.coverage.from>model.coverage.to||model.coverage.from.slice(0,7)!==model.coverage.to.slice(0,7)||!Array.isArray(model.products)||!object(model.days)||!report)return false;
 if(!object(model.totals)||!Number.isSafeInteger(model.totals.rows)||model.totals.rows<0||!Number.isSafeInteger(model.totals.quantity)||model.totals.sales==null||model.totals.net==null||['sales_amount','transfer_total','ads_spend','bought_qty'].some(k=>report[k]==null))return false;
 if(cents(model.totals.sales)!==cents(report.sales_amount)||cents(model.totals.net)!==cents(report.transfer_total)-cents(report.ads_spend)||model.totals.quantity!==Number(report.bought_qty))return false;
 const days=Object.entries(model.days) as [string,any][];
 if(days.some(([d,b])=>!isoDay(d)||d<model.coverage.from||d>model.coverage.to||!Array.isArray(b?.products)||b.products.some((p:any)=>!object(p)||typeof p.article!=='string'||!Number.isSafeInteger(p.quantity))||b.products.reduce((n:number,p:any)=>n+p.quantity,0)!==b.quantity))return false;
 if(model.products.some((p:any)=>typeof p?.article!=='string')||new Set(model.products.map((p:any)=>articleKey(p.article))).size!==model.products.length)return false;
 for(const items of [days.map(([,d])=>d),model.products]){
  if(items.some(p=>!validBucket(p)))return false;
  if(items.reduce((n,p)=>n+p.rows,0)!==model.totals.rows||items.reduce((n,p)=>n+p.quantity,0)!==model.totals.quantity)return false;
  for(const key of ['sales','net'])if(sum(items,key)!==model.totals[key])return false;
 }
 return sameGroups(days.map(([,d])=>d),model.products);
 }catch{return false;}
}
function cogs(products:any[],prices:Map<string,any>){
 let total=0n;const missing:string[]=[];
 for(const p of products){if(!p.quantity)continue;const price=prices.get(articleKey(p.article))?.cost_price;if(!p.article||!(Number(price)>0)){missing.push(p.article||'Товар без артикула');continue;}total+=BigInt(p.quantity)*cents(price);}
 return {amount:missing.length?null:rub(total),missing};
}
function roundTax(rows:any[],sales:any,rate:any){
 const delta=cents(tax(sales,rate))-rows.reduce((n,p)=>n+cents(p.tax),0n);if(!delta||!rows.length)return;
 const p=[...rows].reverse().find(p=>cents(p.sales)!==0n)||rows.at(-1);p.tax=rub(cents(p.tax)+delta);
 p.expenses.find((e:any)=>e.key==='tax').amount=p.tax;
 if(p.total_expenses!=null)p.total_expenses=rub(cents(p.total_expenses)+delta);
 if(p.net_profit!=null)p.net_profit=rub(cents(p.net_profit)-delta);
}
export function calculateOzonDaily(model:any,report:any,prices:Map<string,any>,rate:any){
 if(!validateOzonModel(model,report))return {status:'needs_import',days:[]};
 const days:any[]=[];
 for(let d=new Date(model.coverage.from+'T00:00:00Z');d.toISOString().slice(0,10)<=model.coverage.to;d.setUTCDate(d.getUTCDate()+1)){
  const date=d.toISOString().slice(0,10),b=model.days[date]||{rows:0,sales:'0.00',net:'0.00',quantity:0,groups:{},products:[]},cost=cogs(b.products,prices),t=tax(b.sales,rate);
  const expenses=[...ledger(b.groups),{key:'cogs',label:'Себестоимость',amount:cost.amount},{key:'tax',label:'Налог с продаж',amount:t}];
  days.push({date,rows:b.rows,sales:b.sales,quantity:b.quantity,cogs:cost.amount,tax:t,expenses,missing_costs:cost.missing,
   missing:cost.missing.length?['Заполните себестоимость для расчёта прибыли']:[],net_profit:cost.amount==null?null:rub(cents(b.net)-cents(cost.amount)-cents(t))});
 }
 roundTax(days,model.totals.sales,rate);
 let accumulated=0n,known=true;
 for(const d of days){if(d.net_profit==null)known=false;else accumulated+=cents(d.net_profit);d.cumulative_profit=known?rub(accumulated):null;}
 return {status:'ready',days,monthly_profit:sum(days,'net_profit'),unallocated:null,excluded_expenses:['operational_expenses','external_promotion_expenses'],media_allocation:false,timezone:'Europe/Moscow',date_basis:'accrual_date',coverage_declared:model.coverage.declared};
}
function unitRow(b:any,prices:Map<string,any>,rate:any){
 const cost=cogs([b],prices),t=tax(b.sales,rate),expenses=[...ledger(b.groups),{key:'cogs',label:'Себестоимость',amount:cost.amount},{key:'tax',label:'Налог с продаж',amount:t}];
 const total=expenses.some(e=>e.amount==null)?null:rub(expenses.reduce((n,e)=>n+cents(e.amount),0n)),profit=total==null?null:rub(cents(b.sales)-cents(total));
 return {article:b.article,name:b.name||b.article,quantity:b.quantity,sales:b.sales,tax:t,expenses,total_expenses:total,net_profit:profit,internal_ads:rub(-cents(b.groups['Продвижение и реклама'])),cost_price:prices.get(articleKey(b.article))?.cost_price??null,missing_costs:cost.amount==null};
}
function unitResult(model:any,prices:Map<string,any>,rate:any){
 const all=model.products.map((b:any)=>unitRow(b,prices,rate));roundTax(all,model.totals.sales,rate);
 const products=all.filter((p:any)=>p.article).map((p:any)=>({...p,margin:ratio(p.net_profit,p.sales),profitability:ratio(p.net_profit,p.total_expenses),drr:ratio(p.internal_ads,p.sales)}));
 const common=all.filter((p:any)=>!p.article).flatMap((p:any)=>p.expenses.filter((e:any)=>e.key!=='cogs'));
 const unidentified=all.find((p:any)=>!p.article);if(unidentified&&cents(unidentified.sales)!==0n)common.push({key:'unidentified_sales',label:'Продажи без артикула (справочно)',amount:unidentified.sales,reference:true});
 return {status:'ready',products,common_expenses:common};
}
export function calculateOzonUnit(model:any,report:any,prices:Map<string,any>,rate:any){
 if(!validateOzonModel(model,report))return {status:'needs_import'};
 return unitResult(model,prices,rate);
}
function mergeBuckets(items:any[]){
 const products=new Map<string,any>();
 for(const p of items){const key=articleKey(p.article),old=products.get(key);
  if(!old){products.set(key,{...p,groups:{...p.groups}});continue;}
  old.rows+=p.rows;old.quantity+=p.quantity;old.name ||= p.name;
  for(const field of ['sales','net'])old[field]=rub(cents(old[field])+cents(p[field]));
  for(const [label,amount] of Object.entries(p.groups))old.groups[label]=rub(cents(old.groups[label])+cents(amount));
 }
 return [...products.values()];
}
function selectedModel(model:any,period:OzonRange){
 try{
 if(model.coverage.from>period.dateFrom||model.coverage.to<period.dateTo)return null;
 // Whole imported periods retain their monthly SKU aggregates, including old
 // imports whose daily products contain quantities only.
 if(model.coverage.from===period.dateFrom&&model.coverage.to===period.dateTo)return model;
 const days=Object.fromEntries(Object.entries(model.days).filter(([d])=>d>=period.dateFrom&&d<=period.dateTo)),selected=Object.values(days) as any[];
 if(selected.some(d=>d.rows!==0)){
  // A range needs actual per-day SKU ledgers. Quantity-only legacy buckets
  // cannot assign revenue or fees to dates and must never be prorated.
  const allDays=Object.values(model.days) as any[];
  if(allDays.some(d=>d.products.some((p:any)=>!validBucket(p))||d.products.reduce((n:number,p:any)=>n+p.rows,0)!==d.rows||['sales','net'].some(k=>sum(d.products,k)!==d[k])||!sameGroups(d.products,[d])))return null;
  const dated=mergeBuckets(allDays.flatMap(d=>d.products)),monthly=new Map(model.products.map((p:any)=>[articleKey(p.article),p]));
  if(dated.length!==monthly.size||dated.some(p=>{const b:any=monthly.get(articleKey(p.article));return !b||p.rows!==b.rows||p.quantity!==b.quantity||cents(p.sales)!==cents(b.sales)||cents(p.net)!==cents(b.net)||!sameGroups([p],[b]);}))return null;
 }
 const products=mergeBuckets(selected.flatMap(d=>d.products));
 const names=new Map<string,any>(model.products.map((p:any)=>[articleKey(p.article),p]));
 for(const p of products){const monthly=names.get(articleKey(p.article));p.article=monthly?.article??p.article;p.name=monthly?.name||p.name;}
 return {...model,coverage:{from:period.dateFrom,to:period.dateTo,declared:model.coverage.declared},days,products,
  totals:{rows:selected.reduce((n,d)=>n+d.rows,0),quantity:selected.reduce((n,d)=>n+d.quantity,0),sales:sum(selected,'sales'),net:sum(selected,'net')}};
 }catch{return null;}
}
export async function readOzonMonths(admin:any,shopId:string){
 const [reports,snapshots]=await Promise.all([
  admin.from('monthly_reports').select('year,month').eq('shop_id',shopId).eq('marketplace','ozon').order('year',{ascending:false}).order('month',{ascending:false}),
  admin.from('ozon_analytics_months').select('month,coverage:model->coverage').eq('shop_id',shopId).order('month',{ascending:false})]);
 if(reports.error||snapshots.error)throw new ApiError(500,'Не удалось прочитать периоды Ozon');
 const months=(reports.data||[]).map((r:any)=>`${r.year}-${String(r.month).padStart(2,'0')}`),available=new Set(months),periods=[];
 for(const s of snapshots.data||[]){const month=typeof s.month==='string'?s.month.slice(0,7):'',c=s.coverage;
  if(available.has(month)&&isoDay(c?.from)&&isoDay(c?.to)&&c.from<=c.to&&c.from.slice(0,7)===month&&c.to.slice(0,7)===month)periods.push({month,dateFrom:c.from,dateTo:c.to});
 }
 return {months,periods};
}
async function sources(admin:any,shopId:string,from:string,to:string){
 const [snapshots,reports,shop,costs]=await Promise.all([
  admin.from('ozon_analytics_months').select('month,model,updated_at').eq('shop_id',shopId).gte('month',from+'-01').lte('month',to+'-01').order('month'),
  admin.from('monthly_reports').select('year,month,sales_amount,transfer_total,ads_spend,bought_qty,operational_expenses,external_promotion_expenses').eq('shop_id',shopId).eq('marketplace','ozon'),
  admin.from('shops').select('tax_rate').eq('id',shopId).single(),readCostPrices(admin,shopId)]);
 if(snapshots.error||reports.error||shop.error||!shop.data||costs.error)throw new ApiError(500,'Не удалось прочитать аналитику Ozon');
 return {snapshots:snapshots.data||[],reports:reports.data||[],rate:shop.data.tax_rate,prices:costCatalogue(costs.data||[])};
}
const reportFor=(data:any,month:string)=>data.reports.find((r:any)=>`${r.year}-${String(r.month).padStart(2,'0')}`===month);
const message='Загрузите «Отчёт по начислениям» Ozon за выбранный период в разделе «Отчёты». Старые загрузки содержат только месячные итоги.';
const manualExpenseNote='Ручные расходы заданы за месяц без дат. Для неполных месяцев они исключены из выбранного периода и не распределяются по товарам.';
export async function readOzonDaily(admin:any,shopId:string,month:string){
 const period=ozonPeriod(month),before=new Date(period.dateFrom+'T00:00:00Z');before.setUTCMonth(before.getUTCMonth()-1);const previous=before.toISOString().slice(0,7);
 const data=await sources(admin,shopId,previous,month);
 const read=(m:string)=>{const s=data.snapshots.find((s:any)=>s.month.slice(0,7)===m),report=reportFor(data,m),model=s?.model;
  const result=model?calculateOzonDaily(model,report,data.prices,data.rate):{status:'needs_import',days:[]};
  return {...result,marketplace:'ozon',period:model?{dateFrom:model.coverage.from,dateTo:model.coverage.to}:period,updated_at:s?.updated_at,refreshing:false,message};};
 const current=read(month);
 if(current.status!=='ready')return current;
 // The shared comparator assumes a month starts on day 1. Partial starting
 // ranges keep day-level comparisons but do not claim a comparable whole period.
 const compared=compareDaily(current,read(previous));
 if(current.period.dateFrom.slice(-2)!=='01')compared.comparison={month:previous,status:'unavailable',error:'Для сравнения итогов нужен отчёт с начала месяца. Сравнение отдельных дней доступно на графике.'};
 return compared;
}
export async function readOzonUnit(admin:any,shopId:string,from:string,to:string,range?:OzonRange){
 const supported=ozonMonths(from,to),period=range===undefined?undefined:ozonRange(from,to,range),months=period?ozonMonths(period.dateFrom.slice(0,7),period.dateTo.slice(0,7)):supported;
 const data=await sources(admin,shopId,months[0],months.at(-1)!),pending:any[]=[],rows:any[]=[],common=new Map<string,any>(),coverage:any[]=[],excluded=new Set<string>();
 for(const m of months){const s=data.snapshots.find((s:any)=>s.month?.slice(0,7)===m),report=reportFor(data,m),part=period?{dateFrom:period.dateFrom>m+'-01'?period.dateFrom:m+'-01',dateTo:period.dateTo<monthEnd(m)?period.dateTo:monthEnd(m)}:undefined;
  const valid=validateOzonModel(s?.model,report)&&s.model.coverage.from.slice(0,7)===m,model=valid?(part?selectedModel(s.model,part):s.model):null;
  if(valid)coverage.push({month:m,dateFrom:s.model.coverage.from,dateTo:s.model.coverage.to,declared:s.model.coverage.declared});
  const r=model?unitResult(model,data.prices,data.rate):{status:'needs_import'};
  if(r.status!=='ready'){pending.push({month:m,status:'needs_import'});continue;}
  if(!period&&months.length>1){const i=months.indexOf(m),coverage=s.model.coverage,last=monthEnd(m);if((i>0&&coverage.from!==m+'-01')||(i<months.length-1&&coverage.to!==last)){pending.push({month:m,status:'needs_import'});continue;}}
  rows.push(...r.products);
  const partial=part&&(part.dateFrom!==m+'-01'||part.dateTo!==monthEnd(m));
  const manual=[['operating','Операционные расходы','operational_expenses'],['external','Внешнее продвижение','external_promotion_expenses']].map(([key,label,field])=>{
   if(partial){excluded.add(field);return {key,label,amount:null,status:'unavailable',excluded:true,reason:'monthly_without_dates',note:manualExpenseNote};}
   return {key,label,amount:rub(cents(report[field]??0))};
  });
  for(const e of [...r.common_expenses,...manual]){const prev=common.get(e.key);common.set(e.key,{...prev,...e,amount:e.amount==null||prev?.amount===null?null:rub(cents(prev?.amount)+cents(e.amount)),...(prev?.excluded?{status:'unavailable',excluded:true,reason:'monthly_without_dates'}:{})});}
 }
 if(pending.length)return {status:'needs_import',pending,products:[],message,marketplace:'ozon',...(period?{period,coverage}:{})};
 const grouped=new Map<string,any>();for(const p of rows){const k=articleKey(p.article),old=grouped.get(k);if(!old){grouped.set(k,structuredClone(p));continue;}
  for(const field of ['sales','tax','total_expenses','net_profit','internal_ads'])old[field]=old[field]==null||p[field]==null?null:rub(cents(old[field])+cents(p[field]));old.quantity+=p.quantity;old.missing_costs ||=p.missing_costs;
  for(const e of p.expenses){const exists=old.expenses.find((x:any)=>x.key===e.key);if(exists)exists.amount=exists.amount==null||e.amount==null?null:rub(cents(exists.amount)+cents(e.amount));else old.expenses.push({...e});}}
 const products=[...grouped.values()].map(p=>({...p,drr:ratio(p.internal_ads,p.sales),margin:ratio(p.net_profit,p.sales),profitability:ratio(p.net_profit,p.total_expenses)}));
 const totals:any={sales:sum(products,'sales'),net_profit:sum(products,'net_profit'),internal_ads:sum(products,'internal_ads'),expenses:sum(products,'total_expenses')};totals.drr=ratio(totals.internal_ads,totals.sales);totals.margin=ratio(totals.net_profit,totals.sales);totals.profitability=ratio(totals.net_profit,totals.expenses);
 return {status:'ready',marketplace:'ozon',products,totals,common_expenses:[...common.values()],period:period||{dateFrom:data.snapshots[0]?.model.coverage.from||from+'-01',dateTo:data.snapshots.at(-1)?.model.coverage.to||to+'-01'},
  ...(period?{coverage,excluded_expenses:[...excluded],date_basis:'accrual_date',method:'direct_only',...(excluded.size?{message:manualExpenseNote}:{})}:{})};
}
