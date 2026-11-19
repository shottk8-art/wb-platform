import {ApiError,cents,rub} from './core.ts';
import {advertising} from './economy.ts';
import {articleKey} from './articles.ts';

// Official: promotion#tag/finances/operation/getV1Upd and
// promotion#tag/statistics/operation/getV3Fullstats (50 campaigns / <=31 days).
// Store campaign and SKU sums, never raw clicks, orders or API response rows.
function calendarDay(value:any) {
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===value;
}
function addTypes(left:any,right:any) {
  const result={...left};
  for(const [type,entry] of Object.entries(right) as [string,any][])result[type]={amount:rub(cents(result[type]?.amount)+cents(entry.amount))};
  return result;
}
const money=(value:any)=>typeof value==='string' && /^-?\d+\.\d{2}$/.test(value);
const typesCovered=(totals:any)=>totals && typeof totals==='object' && !Array.isArray(totals)
  && Object.values(totals).every((entry:any)=>entry && money(entry.amount));
export function campaignDebits(response:any,from:string,to:string) {
  if(!Array.isArray(response))throw new ApiError(502,'WB не вернул историю рекламных затрат');
  const campaigns=new Map<number,any>();let undated=false;
  for(const r of response) {
    if(r.updSum==null || typeof r.paymentType!=='string')throw new ApiError(502,'Неполные рекламные списания WB');
    if(!r.updTime || !Number.isFinite(Date.parse(r.updTime))){undated=true;continue;}
    const date=new Date(Date.parse(r.updTime)+3*3600000).toISOString().slice(0,10);
    if(date<from || date>to)continue;
    if(!Number.isSafeInteger(r.advertId) || r.advertId<=0)throw new ApiError(502,'WB не указал ID рекламной кампании');
    const c=campaigns.get(r.advertId)||{id:r.advertId,totals:{},daily_totals:{},nms:[],stats_total:null};
    const old=c.totals[r.paymentType]?.amount;
    c.totals[r.paymentType]={amount:rub(cents(old)+cents(r.updSum))};
    c.daily_totals[date]=addTypes(c.daily_totals[date]||{},{[r.paymentType]:{amount:r.updSum}});
    campaigns.set(c.id,c);
  }
  if(campaigns.size>10000)throw new ApiError(502,'Слишком большой список рекламных кампаний');
  return {version:1,status:'loading',date_from:from,date_to:to,undated,
    daily:{version:1,date_from:from,date_to:to},campaigns:[...campaigns.values()].sort((a,b)=>a.id-b.id),offset:0};
}
export function campaignStats(response:any,ids:number[],from:string,to:string) {
  if(!Array.isArray(response))throw new ApiError(502,'WB не вернул статистику продвижения');
  const seen=new Set<number>();const result:any[]=[];
  for(const c of response) {
    if(!ids.includes(c.advertId)||seen.has(c.advertId)||c.currency!=='RUB'||c.sum==null||!Array.isArray(c.days))throw new ApiError(502,'Не удалось проверить статистику кампаний WB');
    seen.add(c.advertId);const nms=new Map<string,any>();const leaves=new Set<string>();const days:any[]=[];const dates=new Set<string>();
    for(const day of c.days) {
      // Dates here are calendar labels from WB, not instants to shift to Moscow.
      const date=String(day.date||'').slice(0,10);
      if(!calendarDay(date)||date<from||date>to||dates.has(date)||!Array.isArray(day.apps))throw new ApiError(502,'Некорректный период рекламной статистики WB');
      dates.add(date);const dailyNms=new Map<string,any>();let count=0;
      for(const app of day.apps) {
        if(!Array.isArray(app.nms))throw new ApiError(502,'Нет детализации рекламы по товарам');
        for(const nm of app.nms) {
          const id=String(nm.nmId),key=[date,app.appType,id].join(':');
          if(!/^\d+$/.test(id)||BigInt(id)<=0n||nm.sum==null||leaves.has(key))throw new ApiError(502,'WB повторил или не указал товар в рекламной статистике');
          leaves.add(key);const value=cents(nm.sum);if(value<0n)throw new ApiError(502,'Отрицательный расход в статистике WB');
          const old=nms.get(id)||{nm_id:id,name:String(nm.name||'').slice(0,300),amount:'0.00'};
          old.amount=rub(cents(old.amount)+value);nms.set(id,old);
          const daily=dailyNms.get(id)||{nm_id:id,name:old.name,amount:'0.00'};
          daily.amount=rub(cents(daily.amount)+value);dailyNms.set(id,daily);count++;
        }
      }
      days.push({date,stats_total:day.sum==null?rub([...dailyNms.values()].reduce((n,p)=>n+cents(p.amount),0n)):rub(cents(day.sum)),
        rounding_kopecks:count,nms:[...dailyNms.values()]});
    }
    result.push({id:c.advertId,stats_total:rub(cents(c.sum)),rounding_kopecks:leaves.size,nms:[...nms.values()],
      daily_stats:{version:1,date_from:from,date_to:to,days}});
  }
  // Omitted campaigns are not fabricated as zero: retain an explicit unknown.
  return ids.map(id=>result.find(c=>c.id===id)||{id,stats_total:null,nms:[]});
}
// Missing legacy daily evidence is unknown, including an empty old campaign
// list. Only explicit coverage from the original full-period requests proves 0.
export function clipArticleAdvertising(source:any,range:{dateFrom:string,dateTo:string}) {
  if(!source || source.version!==1 || source.status!=='downloaded' || source.undated
    || source.daily?.version!==1 || source.daily.date_from!==source.date_from || source.daily.date_to!==source.date_to
    || !calendarDay(source.date_from) || !calendarDay(source.date_to)
    || !calendarDay(range.dateFrom) || !calendarDay(range.dateTo) || range.dateFrom>range.dateTo
    || source.date_from>range.dateFrom || source.date_to<range.dateTo || !Array.isArray(source.campaigns))return null;
  const campaigns:any[]=[];
  for(const c of source.campaigns) {
    const stats=c.daily_stats;
    if(!c.daily_totals || Array.isArray(c.daily_totals) || !typesCovered(c.totals) || !Array.isArray(c.nms)
      || stats?.version!==1 || stats.date_from!==source.date_from || stats.date_to!==source.date_to || !Array.isArray(stats.days)
      || !money(c.stats_total) || !Number.isSafeInteger(c.rounding_kopecks) || c.rounding_kopecks<0)return null;
    let allTypes={},types={};
    for(const [date,totals] of Object.entries(c.daily_totals)) {
      if(!calendarDay(date) || date<source.date_from || date>source.date_to || !typesCovered(totals))return null;
      allTypes=addTypes(allTypes,totals);
      if(date>=range.dateFrom && date<=range.dateTo)types=addTypes(types,totals);
    }
    const typeKeys=new Set([...Object.keys(allTypes),...Object.keys(c.totals)]);
    for(const type of typeKeys)if(!money((allTypes as any)[type]?.amount) || !money(c.totals[type]?.amount)
      || cents((allTypes as any)[type].amount)!==cents(c.totals[type].amount))return null;
    const allNms=new Map<string,bigint>(),nms=new Map<string,any>(),dates=new Set();let full=0n,total=0n,rounding=0,fullRounding=0;
    for(const day of stats.days) {
      if(!calendarDay(day.date) || day.date<source.date_from || day.date>source.date_to || dates.has(day.date)
        || !Array.isArray(day.nms) || !money(day.stats_total) || !Number.isSafeInteger(day.rounding_kopecks) || day.rounding_kopecks<0)return null;
      dates.add(day.date);full+=cents(day.stats_total);fullRounding+=day.rounding_kopecks;
      const included=day.date>=range.dateFrom && day.date<=range.dateTo,ids=new Set();
      if(included){total+=cents(day.stats_total);rounding+=day.rounding_kopecks;}
      let dayTotal=0n;
      for(const p of day.nms) {
        if(typeof p.nm_id!=='string' || !/^\d+$/.test(p.nm_id) || BigInt(p.nm_id)<=0n || ids.has(p.nm_id) || !money(p.amount) || cents(p.amount)<0n)return null;
        dayTotal+=cents(p.amount);
        ids.add(p.nm_id);allNms.set(p.nm_id,(allNms.get(p.nm_id)||0n)+cents(p.amount));
        if(included){const old=nms.get(p.nm_id)||{...p,amount:'0.00'};old.amount=rub(cents(old.amount)+cents(p.amount));nms.set(p.nm_id,old);}
      }
      const delta=dayTotal-cents(day.stats_total);
      if((delta<0n?-delta:delta)>BigInt(day.rounding_kopecks))return null;
    }
    const delta=full-cents(c.stats_total);
    if((delta<0n?-delta:delta)>BigInt(fullRounding) || fullRounding!==c.rounding_kopecks || allNms.size!==c.nms.length)return null;
    const ids=new Set();
    for(const p of c.nms) {
      if(ids.has(p.nm_id) || !money(p.amount) || allNms.get(p.nm_id)!==cents(p.amount))return null;
      ids.add(p.nm_id);
    }
    campaigns.push({...c,totals:types,nms:[...nms.values()],stats_total:rub(total),rounding_kopecks:rounding});
  }
  return {...source,date_from:range.dateFrom,date_to:range.dateTo,campaigns};
}
export function articleAdvertising(source:any,orders:any[],range?:{dateFrom:string,dateTo:string}) {
  if(range) {
    source=clipArticleAdvertising(source,range);
    if(!source)return {products:new Map<string,any>(),unassigned:true,assigned:'0.00',daily_available:false};
  }
  const mapping=new Map<string,string>();const ambiguous=new Set<string>();
  for(const p of orders||[]) {
    const id=String(p.nm_id),article=String(p.vendor_code||p.nm_id).trim();
    if(mapping.has(id)&&articleKey(mapping.get(id))!==articleKey(article))ambiguous.add(id);
    mapping.set(id,article);
  }
  const products=new Map<string,any>();let unassigned=false,assigned=0n;
  for(const campaign of source.campaigns) {
    const types=advertising(campaign.totals),paid=cents(types.paid),bonus=cents(types.bonus);
    const nms=campaign.nms.filter((p:any)=>cents(p.amount)>0n);
    const sum=nms.reduce((n:bigint,p:any)=>n+cents(p.amount),0n);
    // WB rounds app/day/SKU leaves and campaign totals independently. This
    // bounds rounding by one kopeck per leaf; cash still comes exactly from upd.
    const delta=campaign.stats_total==null?null:sum-cents(campaign.stats_total);
    const exact=delta!=null&&(delta<0n?-delta:delta)<=BigInt(campaign.rounding_kopecks||0);
    if(!nms.length||!exact){if(paid!==0n||bonus!==0n)unassigned=true;continue;}
    for(const nm of nms) {
      const article=mapping.get(nm.nm_id);
      if(!article||ambiguous.has(nm.nm_id)){unassigned=true;continue;}
      // Never distribute a mixed money/bonus campaign across several SKUs.
      // A single-SKU campaign has a direct, exact money debit in /upd.
      const cash=source.undated||types.unknown.length?null:nms.length===1?paid:
        paid===0n?0n:bonus===0n&&sum===paid?cents(nm.amount):null;
      const key=articleKey(article),p=products.get(key)||{article,name:nm.name,amount:'0.00',stats_amount:'0.00'};
      p.amount=p.amount==null||cash==null?null:rub(cents(p.amount)+cash);
      p.stats_amount=rub(cents(p.stats_amount)+cents(nm.amount));products.set(key,p);
      if(cash!=null)assigned+=cash;
    }
  }
  return {products,unassigned:unassigned||source.undated,assigned:rub(assigned)};
}
