import {ApiError,cents,rub} from './core.ts';
import {advertising} from './economy.ts';
import {articleKey} from './articles.ts';

// Official: promotion#tag/finances/operation/getV1Upd and
// promotion#tag/statistics/operation/getV3Fullstats (50 campaigns / <=31 days).
// Store campaign and SKU sums, never raw clicks, orders or API response rows.
export function campaignDebits(response:any,from:string,to:string) {
  if(!Array.isArray(response))throw new ApiError(502,'WB не вернул историю рекламных затрат');
  const campaigns=new Map<number,any>();let undated=false;
  for(const r of response) {
    if(r.updSum==null || typeof r.paymentType!=='string')throw new ApiError(502,'Неполные рекламные списания WB');
    if(!r.updTime || !Number.isFinite(Date.parse(r.updTime))){undated=true;continue;}
    const date=new Date(Date.parse(r.updTime)+3*3600000).toISOString().slice(0,10);
    if(date<from || date>to)continue;
    if(!Number.isSafeInteger(r.advertId) || r.advertId<=0)throw new ApiError(502,'WB не указал ID рекламной кампании');
    const c=campaigns.get(r.advertId)||{id:r.advertId,totals:{},nms:[],stats_total:null};
    const old=c.totals[r.paymentType]?.amount;
    c.totals[r.paymentType]={amount:rub(cents(old)+cents(r.updSum))};
    campaigns.set(c.id,c);
  }
  if(campaigns.size>10000)throw new ApiError(502,'Слишком большой список рекламных кампаний');
  return {version:1,status:'loading',date_from:from,date_to:to,undated,campaigns:[...campaigns.values()].sort((a,b)=>a.id-b.id),offset:0};
}
export function campaignStats(response:any,ids:number[],from:string,to:string) {
  if(!Array.isArray(response))throw new ApiError(502,'WB не вернул статистику продвижения');
  const seen=new Set<number>();const result:any[]=[];
  for(const c of response) {
    if(!ids.includes(c.advertId)||seen.has(c.advertId)||c.currency!=='RUB'||c.sum==null||!Array.isArray(c.days))throw new ApiError(502,'Не удалось проверить статистику кампаний WB');
    seen.add(c.advertId);const nms=new Map<string,any>();const leaves=new Set<string>();
    for(const day of c.days) {
      // Dates here are calendar labels from WB, not instants to shift to Moscow.
      const date=String(day.date||'').slice(0,10);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<from||date>to||!Array.isArray(day.apps))throw new ApiError(502,'Некорректный период рекламной статистики WB');
      for(const app of day.apps) {
        if(!Array.isArray(app.nms))throw new ApiError(502,'Нет детализации рекламы по товарам');
        for(const nm of app.nms) {
          const id=String(nm.nmId),key=[date,app.appType,id].join(':');
          if(!/^\d+$/.test(id)||BigInt(id)<=0n||nm.sum==null||leaves.has(key))throw new ApiError(502,'WB повторил или не указал товар в рекламной статистике');
          leaves.add(key);const value=cents(nm.sum);if(value<0n)throw new ApiError(502,'Отрицательный расход в статистике WB');
          const old=nms.get(id)||{nm_id:id,name:String(nm.name||'').slice(0,300),amount:'0.00'};
          old.amount=rub(cents(old.amount)+value);nms.set(id,old);
        }
      }
    }
    result.push({id:c.advertId,stats_total:rub(cents(c.sum)),rounding_kopecks:leaves.size,nms:[...nms.values()]});
  }
  // Omitted campaigns are not fabricated as zero: retain an explicit unknown.
  return ids.map(id=>result.find(c=>c.id===id)||{id,stats_total:null,nms:[]});
}
export function articleAdvertising(source:any,orders:any[]) {
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
