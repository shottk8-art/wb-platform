import { ApiError, cents, rub } from './core.ts';

export const MEDIA_ESTIMATE_NOTE='Расходы WB Media временно приняты за 0 ₽: данные не получены. Расчёт предварительный.';

// Full campaign history is an optional recovery path, never an unbounded body
// that can terminate the worker before its ordinary error handler runs.
export async function readMediaHistoryResponse(response:Response) {
  const reader=response.body?.getReader();if(!reader)throw new ApiError(502,'WB Медиа не вернул историю кампании');
  const chunks:Uint8Array[]=[];let size=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
      if(size>1048576){await reader.cancel();throw new ApiError(502,'История WB Медиа слишком велика для безопасной обработки');}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return JSON.parse(new TextDecoder().decode(bytes));
  }finally{reader.releaseLock();}
}

// WB's financial API also supplies billed Media services in deduction rows.
// A campaign-card/list zero must never erase these actual charges. This source
// follows financial-report recognition, not the spending statement's dates.
// No file/manual fallback and no addition of overlapping campaign statistics.
export const isMediaDeduction = (label: unknown) => /(?:вб|wb)[.\s]*(?:медиа|media)(?=$|[^\p{L}\p{N}_])/iu.test(String(label || ''));
export function mediaFinancialSource(deductions: any, complete: boolean, from: string, to: string, fetchedAt: string | null = null, model?: any) {
  if (!complete) return null;
  const total = model?.totals?.wbMediaDeductions;
  if (total != null && (cents(total) !== 0n || Number(model.media_deduction_count) > 0)) {
    return { status: 'downloaded', amount: rub(cents(total)), date_from: from, date_to: to,
      source: 'wb_financial_deductions', recognition: 'financial_report', fetched_at: fetchedAt };
  }
  if (!Array.isArray(deductions)) return null;
  const rows = deductions.filter(row => isMediaDeduction(row?.label));
  if (!rows.length) return null;
  let amount = 0n;
  for (const row of rows) {
    if (row.amount == null) throw new ApiError(502, 'WB не вернул сумму финансового удержания за медиа');
    amount += cents(row.amount);
  }
  return { status: 'downloaded', amount: rub(amount), date_from: from, date_to: to,
    source: 'wb_financial_deductions', recognition: 'financial_report', fetched_at: fetchedAt };
}

// Official WB Media list + interval statistics. Budget/price and nested daily
// impressions are not expenses and must never be summed a second time.
// https://dev.wildberries.ru/docs/openapi/promotion#tag/statistics/operation/postV1Stats
export function mediaCampaignPage(response: any) {
  if (response === null) return []; // documented 204: no campaigns
  if (!Array.isArray(response)) throw new ApiError(502, 'Не удалось прочитать список WB Медиа');
  const seen = new Set<number>();
  return response.map(row => {
    const id = row?.advertId;
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) throw new ApiError(502, 'Некорректный список кампаний WB Медиа');
    seen.add(id);
    return id;
  });
}

export function mediaCampaignSelection(response: any, from: string, to: string) {
  const ids = mediaCampaignPage(response);
  const begin = Date.parse(`${from}T00:00:00+03:00`);
  const end = Date.parse(`${to}T00:00:00+03:00`) + 86400000;
  const timestamp = (value: unknown) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return null;
    const day = value.slice(0,10), calendar = new Date(`${day}T00:00:00Z`);
    return Number.isFinite(calendar.getTime()) && calendar.toISOString().slice(0,10) === day ? value : null;
  };
  return ids.map((id: number, index: number) => {
    const row = response[index], created_at = timestamp(row.createTime), ended_at = timestamp(row.endTime);
    const status = Number.isSafeInteger(row.status) ? row.status : null;
    // Only exclude provably disjoint lifetimes. A paused/declined/unknown
    // campaign without a reliable end date may still have spent in the month.
    const reason = created_at && Date.parse(created_at) >= end ? 'created_after_month'
      : status === 7 && ended_at && Date.parse(ended_at) < begin && (!created_at || Date.parse(ended_at) >= Date.parse(created_at)) ? 'completed_before_month' : null;
    return { id, status, created_at, ended_at, excluded_reason: reason };
  });
}

export function mediaCampaignEvidence(response: any, id: number, from: string, to: string) {
  if (response === null) return { no_spend_in_month: false, lifetime_expenses: null };
  if (response?.advertId !== id) throw new ApiError(502, 'WB Медиа вернул сведения о другой кампании');
  const value = response.extended?.expenses;
  const amount = value == null ? null : cents(value);
  if (amount !== null && amount < 0n) throw new ApiError(502, 'Некорректные расходы кампании WB Медиа');
  // A genuine lifetime total of zero proves zero for any closed subperiod.
  // Missing expenses, missing items and a declined status alone do not.
  let outside = false;
  if (Array.isArray(response.items) && response.items.length > 0) {
    const items = mediaCampaignSelection(response.items.map((item: any) => ({advertId:item?.id,status:item?.status,createTime:item?.date_from,endTime:item?.date_to})),from,to);
    outside = items.every(item => item.excluded_reason !== null);
  }
  return { no_spend_in_month: amount === 0n || outside, lifetime_expenses: amount === null ? null : rub(amount) };
}

export function mediaBannersUnavailable(response: any) {
  return Array.isArray(response) && response.length === 1 && typeof response[0]?.error === 'string'
    && /^не удалось получить id баннеров размещения(?:[.\s]|$)/i.test(response[0].error.trim());
}

export function mediaIntervalAmount(response: any, from: string, to: string) {
  // One campaign/interval per request makes coverage unambiguous. Empty/missing
  // wrappers, missing expenses and "campaign not found" are NOT proof of zero.
  if (!Array.isArray(response) || response.length !== 1) throw new ApiError(502, 'WB Медиа не вернул статистику за месяц');
  const block = response[0];
  const error = typeof block?.error === 'string' ? block.error.trim().toLowerCase() : '';
  // Observed WB response: statistics are prepared asynchronously. This is
  // neither a failed request nor evidence of zero spend; keep the same cursor.
  if (error === 'статистика в процессе получения' && block?.interval?.begin === from && block?.interval?.end === to) return null;
  if (block?.error || block?.interval?.begin !== from || block?.interval?.end !== to || !Array.isArray(block.stats)) {
    throw new ApiError(502, 'Не удалось проверить период расходов WB Медиа');
  }
  let total = 0n;
  for (const row of block.stats) {
    if (row?.expenses == null) throw new ApiError(502, 'WB Медиа не вернул сумму расходов');
    const amount = cents(row.expenses);
    if (amount < 0n) throw new ApiError(502, 'Некорректные расходы WB Медиа');
    total += amount;
  }
  return rub(total);
}

// WB can keep an interval request "preparing" even for an old closed campaign.
// Its documented campaign-only variant returns all placements/days instead.
// Use it only with complete monetary coverage: platform/day charges must match
// EACH placement's expenses AND their sum must match the campaign card's actual
// lifetime expenses. A missing day then cannot hide an unaccounted charge.
// https://dev.wildberries.ru/docs/openapi/promotion#tag/statistics/operation/postV1Stats
export function mediaCampaignDailyAmount(response: any, id: number, from: string, to: string, lifetime: unknown) {
  if (!Array.isArray(response) || response.length !== 1 || lifetime == null) return null;
  const block=response[0];
  if (block?.error || block?.interval || block?.dates || !Array.isArray(block?.stats) || !block.stats.length) return null;
  if (block.advert_id != null && block.advert_id !== id) return null;
  const expected=cents(lifetime);
  if(expected<0n)return null;
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'});
  const dayOf=(value:unknown)=>{
    if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))return null;
    const day=value.slice(0,10);
    if(new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day)return null;
    const parts=formatter.formatToParts(new Date(value));
    return ['year','month','day'].map(key=>parts.find(p=>p.type===key)!.value).join('-');
  };
  const placements=new Set(),days=new Map<string,bigint>();
  let covered=0n,period=0n;
  for(const row of block.stats){
    if(!Number.isSafeInteger(row?.item_id) || row.item_id<=0 || placements.has(row.item_id) || row.expenses==null || !Array.isArray(row.daily_stats))return null;
    placements.add(row.item_id);
    const expense=cents(row.expenses);if(expense<0n)return null;
    const seenDays=new Set();let dated=0n;
    for(const daily of row.daily_stats){
      const day=dayOf(daily?.date);
      if(!day || seenDays.has(day) || !Array.isArray(daily.app_type_stats) || !daily.app_type_stats.length)return null;
      seenDays.add(day);
      const apps=new Set();let amount=0n;
      for(const app of daily.app_type_stats){
        if(!Number.isSafeInteger(app?.app_type) || app.app_type<=0 || apps.has(app.app_type) || !Array.isArray(app.stats) || !app.stats.length)return null;
        apps.add(app.app_type);
        for(const stat of app.stats){
          if(!stat || typeof stat!=='object' || Array.isArray(stat))return null;
          // Legacy WB replies label a daily platform charge "price". Never use
          // the placement's price/budget. Accept that alias only under the full
          // expense reconciliation below; sparse no-charge counters omit it.
          if(stat.expenses!=null && stat.price!=null && cents(stat.expenses)!==cents(stat.price))return null;
          const value=cents(stat.expenses ?? stat.price ?? 0);if(value<0n)return null;
          amount+=value;
        }
      }
      dated+=amount;days.set(day,(days.get(day)||0n)+amount);
      if(day>=from && day<=to)period+=amount;
    }
    if(dated!==expense)return null;
    covered+=expense;
  }
  if(covered!==expected)return null;
  const spent=[...days].filter(([,amount])=>amount>0n).map(([day])=>day).sort();
  return {amount:rub(period),covered_expenses:rub(covered),lifetime_expenses:rub(expected),
    first_spend:spent[0] ?? null,last_spend:spent.at(-1) ?? null,date_from:from,date_to:to,source:'wb_media_campaign_daily_stats'};
}

// Private failure metadata only: never persist a raw body, headers, SKU stats
// or arbitrary upstream fields. This distinguishes period/shape errors.
export function mediaResponseDiagnostic(response: any) {
  const block = Array.isArray(response) ? response[0] : null;
  const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T[\d:.+Z-]+)?$/.test(value) ? value.slice(0,40) : null;
  const error = typeof block?.error === 'string' ? block.error.slice(0,240)
    .replace(/[A-Za-z0-9_./+=-]{32,}/g,'<redacted>').replace(/\S+@\S+/g,'<redacted>') : null;
  return {response_count:Array.isArray(response)?response.length:null,begin:date(block?.interval?.begin),end:date(block?.interval?.end),
    stats_array:Array.isArray(block?.stats),error};
}

export function mediaSource(source: any, from: string, to: string) {
  if (source?.status === 'downloaded' && source.date_from === from && source.date_to === to && source.amount != null && cents(source.amount) >= 0n) {
    return { status: 'downloaded', amount: rub(cents(source.amount)), date_from: from, date_to: to, fetched_at: source.fetched_at ?? null };
  }
  if(source?.estimated===true && source.date_from===from && source.date_to===to){
    return {status:'estimated',amount:'0.00',estimated:true,date_from:from,date_to:to,source:'temporary_zero',note:MEDIA_ESTIMATE_NOTE,fetched_at:source.fetched_at ?? null};
  }
  return { status: source?.status === 'loading' ? 'loading' : 'pending', amount: null, date_from: from, date_to: to };
}
