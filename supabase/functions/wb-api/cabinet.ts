import { ApiError, cents, rub, summarize, validateKey, validatePeriod, validateShopId } from './core.ts';
import { advertising, economy } from './economy.ts';
import { articleKey, costCatalogue } from './articles.ts';
import { mediaCampaignSelection, mediaCampaignEvidence, mediaIntervalAmount, mediaResponseDiagnostic, mediaSource, mediaFinancialSource, isMediaDeduction } from './media.ts';

export function cabinetPeriod(value: unknown, now = new Date()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) throw new ApiError(400, 'Выберите месяц');
  if (Number(value.slice(5)) < 1 || Number(value.slice(5)) > 12) throw new ApiError(400, 'Некорректный месяц');
  const today = new Date(now.getTime() + 3 * 3600000).toISOString().slice(0,10);
  const current = new Date(today.slice(0,7) + '-01T00:00:00Z');
  const oldest = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 11, 1)).toISOString().slice(0,10);
  const start = `${value}-01`, d = new Date(start + 'T00:00:00Z');
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  if (start < oldest || start > today) throw new ApiError(400, 'Доступны текущий и 11 предыдущих месяцев');
  const period = validatePeriod(start, last > today ? today : last, now);
  return period;
}
const text = (value: unknown) => String(value || '').slice(0, 300);
const oldestMonth = () => {
  const now=new Date(Date.now()+3*3600000);
  return new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-11,1)).toISOString().slice(0,10);
};
async function readCostPrices(admin:any,shopId:string) {
  const rows:any[]=[];
  for(let offset=0;;offset+=1000) {
    const {data,error}=await admin.from('sku_costs').select('article,cost_price,updated_at').eq('shop_id',shopId).order('article').range(offset,offset+999);
    if(error) throw new ApiError(500,'Не удалось прочитать себестоимость');
    rows.push(...(data || []));
    if(!data || data.length<1000) return {data:rows,error:null};
  }
}
export function orderPage(response: any, from: string, to: string) {
  if (response?.data?.currency !== 'RUB' || !Array.isArray(response?.data?.products)) throw new ApiError(400, 'Неожиданный формат аналитики WB');
  const seen = new Set();
  return response.data.products.map((p: any) => {
    const s = p.statistic?.selected, nm = String(p.product?.nmId || '');
    if (!/^\d+$/.test(nm) || seen.has(nm) || s?.period?.start !== from || s?.period?.end !== to || !Number.isSafeInteger(s?.orderCount) || s.orderCount < 0 || s?.orderSum == null) throw new ApiError(400, 'Не удалось проверить заказы WB за выбранный месяц');
    seen.add(nm);
    const amount = cents(s.orderSum);
    if (amount < 0n) throw new ApiError(400, 'Некорректная сумма заказов WB');
    return { nm_id: nm, vendor_code: text(p.product.vendorCode), title: text(p.product.title), orders_count: s.orderCount, orders_amount: rub(amount) };
  });
}
export function adsSnapshot(response: any, from: string, to: string) {
  if (!Array.isArray(response)) throw new ApiError(400, 'Неожиданный формат рекламных расходов WB');
  const totals: Record<string, bigint> = {}, operations: Record<string, number> = {};
  let undated = 0;
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' });
  for (const row of response) {
    const amount = cents(row?.updSum);
    if (row?.updSum == null || typeof row.paymentType !== 'string') throw new ApiError(400, 'Неполные данные рекламных списаний WB');
    if (!row.updTime || !Number.isFinite(Date.parse(row.updTime))) { undated++; continue; }
    const parts = formatter.formatToParts(new Date(row.updTime));
    const date = ['year','month','day'].map(t => parts.find(p => p.type === t)!.value).join('-');
    if (date < from || date > to) continue;
    const type = text(row.paymentType);
    totals[type] = (totals[type] || 0n) + amount;
    operations[type] = (operations[type] || 0) + 1;
  }
  return { status: 'downloaded', date_from: from, date_to: to, timezone: 'Europe/Moscow', fetched_at: new Date().toISOString(),
    period_totals: Object.fromEntries(Object.entries(totals).map(([key, v]) => [key, { amount: rub(v), operations: operations[key] }])),
    undated_operations: undated, classification_pending: advertising(Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,{amount:rub(v)}]))).unknown, applied_to_dashboard: false };
}

async function commit(admin: any, job: any, summary: any, status = 'loading') {
  const { error } = await admin.from('wb_api_preview_jobs').update({ summary, status, failure_count: 0, error_message: null, updated_at: new Date().toISOString() }).eq('id', job.id).eq('shop_id', job.shop_id);
  if (error) throw new ApiError(500, 'Не удалось сохранить загрузку источника');
}
// Durable, bounded work per cron tick; no browser-owned continuation. Media
// permits a personal-token burst of 10; inspect at most five campaigns (at most
// ten media calls with card fallbacks) per tick, under the existing shared quota.
export async function processCabinetSource(admin: any, job: any, wbFetch: any) {
  validateShopId(job.shop_id);
  const financialMedia = mediaFinancialSource(job.summary?.deductions, !!job.summary?.pilot?.finance_complete,
    job.date_from, job.date_to, job.updated_at ?? null, job.finance_model);
  // Repair just Media from the already downloaded financial API snapshot.
  // Do not restart finance/orders/ads or query zero-expense campaigns again.
  if (financialMedia && ['media_list','media_stats'].includes(job.summary?.pilot?.stage)) {
    const summary = structuredClone(job.summary);
    summary.api_sources ||= {};
    summary.api_sources.media = financialMedia;
    summary.pilot.stage = 'done';
    await commit(admin, job, summary, 'complete');
    return { retry_after: 0 };
  }
  const { data: wait, error: claimError } = await admin.rpc('wb_api_claim_request', { p_shop_id: job.shop_id, p_kind: 'finance' });
  if (claimError) throw new ApiError(500, 'Не удалось начать загрузку');
  if (Number(wait) > 0) return { retry_after: Number(wait) };
  const { data: key, error } = await admin.rpc('wb_api_read_key', { p_shop_id: job.shop_id });
  if (error || !key) throw new ApiError(400, 'Сначала подключите API');
  const { token } = validateKey(String(key));
  const summary = structuredClone(job.summary), pilot = summary.pilot;
  if (pilot.stage === 'orders') {
    let response;
    try { response = await wbFetch(token, 'https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products', {
      selectedPeriod: { start: job.date_from, end: job.date_to }, nmIds: [], brandNames: [], subjectIds: [], tagIds: [], skipDeletedNm: false, limit: 1000, offset: pilot.orders_offset || 0,
    }); } catch (e) { if (e instanceof ApiError && /Нет доступа/.test(e.message)) throw new ApiError(400, 'Для заказов включите категорию «Аналитика» в персональном ключе'); throw e; }
    const page = orderPage(response, job.date_from, job.date_to);
    const previous = summary.api_sources?.orders?.rows || [], seen = new Set(previous.map((p: any) => String(p.nm_id)));
    if (page.some((p: any) => seen.has(p.nm_id))) throw new ApiError(400, 'WB повторил товары между страницами. Обновите выгрузку');
    const rows = [...previous, ...page];
    summary.api_sources ||= {};
    summary.api_sources.orders = { status: page.length < 1000 ? 'downloaded' : 'loading', date_from: job.date_from, date_to: job.date_to,
      currency: 'RUB', source: 'sales_funnel_products_v3', fetched_at: new Date().toISOString(), rows,
      orders_amount: rub(rows.reduce((sum: bigint, p: any) => sum + cents(p.orders_amount), 0n)), orders_count: rows.reduce((sum: number, p: any) => sum + p.orders_count, 0),
      products_count: rows.length, applied_to_dashboard: false };
    pilot.orders_offset = (pilot.orders_offset || 0) + page.length;
    if (page.length < 1000) pilot.stage = 'ads';
    await commit(admin, job, summary);
  } else if (pilot.stage === 'ads') {
    let response;
    try { response = await wbFetch(token, `https://advert-api.wildberries.ru/adv/v1/upd?from=${job.date_from}&to=${job.date_to}`); }
    catch (e) { if (e instanceof ApiError && /Нет доступа/.test(e.message)) throw new ApiError(400, 'Для рекламных затрат включите категорию «Продвижение» в персональном ключе'); throw e; }
    summary.api_sources ||= {};
    summary.api_sources.internal_ads = adsSnapshot(response, job.date_from, job.date_to);
    summary.api_sources.media = financialMedia || { status: 'loading', date_from: job.date_from, date_to: job.date_to, amount: null, campaign_ids: [], list_offset: 0 };
    pilot.stage = financialMedia ? 'done' : 'media_list';
    await commit(admin, job, summary, financialMedia ? 'complete' : 'loading');
  } else if (pilot.stage === 'media_list' || pilot.stage === 'media_stats') {
    summary.api_sources ||= {};
    const media = summary.api_sources.media ||= { status: 'loading', date_from: job.date_from, date_to: job.date_to, amount: null, campaign_ids: [], list_offset: 0 };
    // Old jobs discarded campaign lifetimes and can poll a past campaign
    // forever. Re-read only the media list, retaining all financial sources.
    if (pilot.stage === 'media_stats' && media.selection_version !== 2 && media.list_offset > 0) {
      pilot.stage = 'media_list';
      Object.assign(media, { campaign_ids: [], campaign_records: [], list_offset: 0, stats_offset: 0, partial_amount: '0.00', pending_count: 0 });
    }
    Object.assign(media, { status: 'loading', date_from: job.date_from, date_to: job.date_to, amount: null });
    const fetchMedia = async (url: string, body?: any) => {
      try { return await wbFetch(token, url, body); }
      catch (e) { if (e instanceof ApiError && /Нет доступа/.test(e.message)) throw new ApiError(400, 'Нет доступа к WB Медиа. Проверьте категорию «Продвижение» в персональном ключе'); throw e; }
    };
    if (pilot.stage === 'media_list') {
      const page = mediaCampaignSelection(await fetchMedia(`https://advert-media-api.wildberries.ru/adv/v1/adverts?limit=100&offset=${media.list_offset || 0}&order=id&direction=asc`), job.date_from, job.date_to);
      const previous = media.campaign_records || [], seen = new Set(previous.map((row: any) => row.id));
      if (page.some(row => seen.has(row.id))) throw new ApiError(502, 'WB Медиа повторил кампании между страницами');
      media.campaign_records = [...previous, ...page];
      media.campaign_ids = media.campaign_records.filter((row: any) => !row.excluded_reason).map((row: any) => row.id);
      media.selection_version = 2;
      media.list_offset = (media.list_offset || 0) + page.length;
      if (page.length < 100) {
        media.stats_offset = 0; media.partial_amount = '0.00';
        pilot.stage = media.campaign_ids.length ? 'media_stats' : 'done';
        if (!media.campaign_ids.length) Object.assign(media, { status: 'downloaded', amount: '0.00', fetched_at: new Date().toISOString(), source: 'wb_media_interval_stats' });
      }
    } else {
      for (let checked = 0; checked < 5; checked++) {
        const id = media.campaign_ids?.[media.stats_offset || 0];
        if (!Number.isSafeInteger(id) || id <= 0) throw new ApiError(502, 'Не удалось продолжить загрузку WB Медиа');
        media.campaign_records ||= [];
        let record = media.campaign_records.find((row: any) => row.id === id);
        if (!record) { record = { id }; media.campaign_records.push(record); }
        // Expense-first for every status: do not prepare statistics for a
        // campaign with proven zero spend. Lifetime spend is only a filter,
        // never the amount attributed to this month; missing proof is unknown.
        if (!record.evidence) {
          record.evidence = mediaCampaignEvidence(await fetchMedia(`https://advert-media-api.wildberries.ru/adv/v1/advert?id=${id}`), id, job.date_from, job.date_to);
        }
        const provedZero = record.evidence.no_spend_in_month === true;
        let amount;
        if (provedZero) amount = '0.00';
        else {
          const response = await fetchMedia('https://advert-media-api.wildberries.ru/adv/v1/stats', [{ id, interval: { begin: job.date_from, end: job.date_to } }]);
          try { amount = mediaIntervalAmount(response, job.date_from, job.date_to); }
          catch (e) {
            media.format_issue = {campaign_id:id,...mediaResponseDiagnostic(response)};
            const {error} = await admin.from('wb_api_preview_jobs').update({summary,updated_at:new Date().toISOString()}).eq('id',job.id).eq('shop_id',job.shop_id);
            if (error) throw new ApiError(500,'Не удалось сохранить диагностику WB Медиа');
            throw e;
          }
        }
        delete media.format_issue;
        if (amount === null) {
          media.pending_count = (media.pending_count || 0) + 1;
          await commit(admin, job, summary);
          if (media.pending_count >= 8) throw new ApiError(400, 'WB Медиа пока не отдаёт статистику. Данные сохранены; попробуйте продолжить загрузку позже');
          return { retry_after: 63 };
        }
        media.pending_count = 0;
        media.partial_amount = rub(cents(media.partial_amount) + cents(amount));
        media.stats_offset = (media.stats_offset || 0) + 1;
        if (media.stats_offset === media.campaign_ids.length) {
          Object.assign(media, { status: 'downloaded', amount: media.partial_amount, fetched_at: new Date().toISOString(), source: 'wb_media_interval_stats' });
          pilot.stage = 'done';
          break;
        }
        if (!provedZero) break;
      }
    }
    // Cursor and totals are committed together: retries cannot duplicate spend.
    await commit(admin, job, summary, pilot.stage === 'done' ? 'complete' : 'loading');
  } else throw new ApiError(400, 'Неизвестный этап загрузки');
  return { retry_after: 63 };
}

// Seller-price buyouts are distinct from WB's retailAmount (realization) and
// forPay (payout). Price is per unit. Service/correction rows are not new sales.
// https://dev.wildberries.ru/docs/openapi/documents-and-accounting#tag/financialReports/operation/postV1SalesReportsDetailed
function buyoutValue(row: any): bigint | null {
  const operation = String(row.sellerOperName || '').trim().toLowerCase();
  if (!['продажа','возврат'].includes(operation)) return 0n;
  const quantity = Number(row.quantity);
  if (row.quantity == null || row.quantity === '' || !Number.isSafeInteger(quantity) || quantity < 0) return null;
  if (quantity === 0) return 0n;
  if (row.retailPriceWithDisc == null || row.retailPriceWithDisc === '') return null;
  try {
    const price = cents(row.retailPriceWithDisc);
    if (price < 0n) return null;
    const document = String(row.docTypeName || operation).trim().toLowerCase();
    if (!['продажа','возврат'].includes(document)) return null;
    return (document === 'возврат' ? -1n : 1n) * BigInt(quantity) * price;
  } catch { return null; }
}

// The durable read model grows with SKU count, never with raw operations.
// Keep upstream financial totals intact; versioned coverage prevents a partial
// new page from inventing seller-price sales for an older compact snapshot.
export function aggregateFinanceRows(rows: any[], cursor = '0') {
  const summarized = summarize(rows).totals;
  const totals = Object.fromEntries(['retailAmount','forPay','deliveryService','paidStorage','paidAcceptance','penalty','deduction','cashbackAmount','cashbackDiscount','cashbackCommissionChange'].map(key=>[key,summarized[key] || '0.00']));
  const products = new Map<string, any>();
  let additional = 0n, advertisingDeductions = 0n, wbMediaDeductions = 0n, mediaDeductionCount = 0, bought = 0;
  let sales: bigint | null = 0n;
  for (const p of rows) {
    const sale = buyoutValue(p);
    sales = sales == null || sale == null ? null : sales + sale;
    additional += cents(p.additionalPayment);
    const label = String(p.bonusTypeName || p.sellerOperName || '').toLowerCase();
    if (/(?:вб|wb)[.\s]*(?:продвижение|медиа|media)|услуги (?:по )?реклам/.test(label)) advertisingDeductions += cents(p.deduction);
    if (cents(p.deduction) !== 0n && isMediaDeduction(label)) { wbMediaDeductions += cents(p.deduction); mediaDeductionCount++; }
    const article = String(p.vendorCode || p.nmId || '');
    if (!article) continue;
    const row = products.get(article) || {article,name:text(p.title),bought_qty:0,for_pay:0n,revenue:0n,sales_revenue:0n};
    if (!row.name) row.name = text(p.title);
    const sign = p.docTypeName === 'Возврат' ? -1 : 1;
    if (['Продажа','Возврат'].includes(p.sellerOperName)) {row.bought_qty += sign*Number(p.quantity || 0);bought += sign*Number(p.quantity || 0);}
    row.for_pay += BigInt(sign)*cents(p.forPay); row.revenue += BigInt(sign)*cents(p.retailAmount);
    row.sales_revenue = row.sales_revenue == null || sale == null ? null : row.sales_revenue + sale;
    products.set(article,row);
  }
  return {version:1,cursor_id:cursor,row_count:rows.length,sales_covered_rows:rows.length,bought_qty:bought,media_deduction_count:mediaDeductionCount,
    totals:{...totals,salesAmount:sales == null ? null : rub(sales),additionalPayment:rub(additional),advertisingDeductions:rub(advertisingDeductions),wbMediaDeductions:rub(wbMediaDeductions)},
    products:[...products.values()].map(p=>({...p,for_pay:rub(p.for_pay),revenue:rub(p.revenue),sales_revenue:p.sales_revenue == null ? null : rub(p.sales_revenue)}))};
}

// The durable state grows with distinct products, not the number of operations.
// Merge in integer kopecks; the first nonempty product title remains stable.
export function mergeFinanceModels(previous: any, page: any) {
  if (!previous) return page;
  const products = new Map(previous.products.map((p: any) => [p.article, {...p}]));
  for (const p of page.products) {
    const old: any = products.get(p.article);
    products.set(p.article, old ? {...old, name:old.name || p.name,
      bought_qty:old.bought_qty + p.bought_qty,
      for_pay:rub(cents(old.for_pay) + cents(p.for_pay)),
      revenue:rub(cents(old.revenue) + cents(p.revenue)),
      sales_revenue:old.sales_revenue == null || p.sales_revenue == null ? null : rub(cents(old.sales_revenue) + cents(p.sales_revenue))} : {...p});
  }
  const keys = new Set([...Object.keys(previous.totals), ...Object.keys(page.totals)]);
  const covered = (previous.sales_covered_rows || 0) + (page.sales_covered_rows || 0);
  const count = previous.row_count + page.row_count;
  const sales = covered === count && previous.totals.salesAmount != null && page.totals.salesAmount != null
    ? rub(cents(previous.totals.salesAmount) + cents(page.totals.salesAmount)) : null;
  return {version:1, cursor_id:page.cursor_id, row_count:count,sales_covered_rows:covered,
    bought_qty:previous.bought_qty + page.bought_qty,
    media_deduction_count:(previous.media_deduction_count || 0) + (page.media_deduction_count || 0),
    totals:{...Object.fromEntries([...keys].filter(key=>key !== 'salesAmount').map(key=>[key,rub(cents(previous.totals[key]) + cents(page.totals[key]))])),salesAmount:sales},
    products:[...products.values()]};
}

export async function readCabinet(admin: any, shopId: string, period: any, completedJobId?: string, catalog?: any) {
  validateShopId(shopId);
  const { data: shop, error: shopError } = catalog ? {data:catalog.shop,error:null} : await admin.from('shops').select('id,name,tax_rate').eq('id', shopId).single();
  if (shopError || !shop || shop.id !== shopId) throw new ApiError(403, 'API-кабинет недоступен');
  const { data: settingsRows, error: settingsError } = catalog ? {data:catalog.settings.filter((s:any)=>s.month===period.dateFrom),error:null} : await admin.from('wb_api_month_settings').select('operational_expenses,external_promotion_expenses').eq('shop_id', shopId).eq('month', period.dateFrom).limit(1);
  if (settingsError) throw new ApiError(500, 'Не удалось прочитать расходы месяца');
  const settings = { operational_expenses: settingsRows?.[0]?.operational_expenses ?? '0.00', external_promotion_expenses: settingsRows?.[0]?.external_promotion_expenses ?? '0.00' };
  let jobQuery = catalog ? null : admin.from('wb_api_preview_jobs').select('id,status,summary,row_count,cursor_id,finance_model,error_message,updated_at,date_from,date_to').eq('shop_id', shopId).eq('date_from', period.dateFrom);
  if (completedJobId && jobQuery) jobQuery = jobQuery.eq('id',completedJobId).eq('status','complete');
  const { data: jobs, error } = catalog ? {data:[catalog.job],error:null} : await jobQuery.order('created_at', { ascending: false }).limit(1);
  if (error) throw new ApiError(500, 'Не удалось прочитать выгрузку');
  const job = jobs?.[0];
  if (!job) return { job: null, shop, settings, products: [], finance: null, sources: {} };
  // A refresh is a separate snapshot, not an append. Keep the last complete
  // snapshot visible while the new one is queued/loading or has failed.
  if (!completedJobId && job.status !== 'complete') {
    const {data: saved, error: savedError} = await admin.from('wb_api_preview_jobs').select('id,date_from,date_to').eq('shop_id',shopId).eq('date_from',period.dateFrom).eq('status','complete').order('created_at',{ascending:false}).limit(1);
    if (savedError) throw new ApiError(500, 'Не удалось прочитать сохранённый месяц');
    if (saved?.[0]) {
      const snapshot = await readCabinet(admin,shopId,{dateFrom:saved[0].date_from,dateTo:saved[0].date_to},saved[0].id);
      if (snapshot.complete) return {...snapshot, refresh_job:{id:job.id,status:job.status,stage:job.summary?.pilot?.stage || 'finance',row_count:job.row_count,error_message:job.error_message,updated_at:job.updated_at}};
    }
  }
  // Sources must be validated against the saved snapshot's end, not today's
  // moving end; otherwise yesterday's valid current-month media becomes unknown.
  period = {dateFrom:job.date_from,dateTo:job.date_to};
  const sources = job.summary?.api_sources || {}, products = new Map<string, any>();
  for (const p of sources.orders?.rows || []) {
    const article = String(p.vendor_code || p.nm_id), old = products.get(article);
    products.set(article, { article, name: text(p.title) || old?.name || '', orders_count: (old?.orders_count || 0) + Number(p.orders_count),
      orders_amount: rub(cents(old?.orders_amount) + cents(p.orders_amount)), bought_qty: 0, for_pay: 0n, revenue: 0n });
  }
  let model = job.finance_model;
  if (model?.version !== 1 || Number(model.row_count) !== Number(job.row_count) || model.cursor_id !== String(job.cursor_id)) {
    const {data,error} = await admin.rpc('wb_api_finance_read_model',{p_job_id:job.id});
    if (error || !data) throw new ApiError(500,'Не удалось прочитать финансовые итоги');
    model = data;
  }
  for (const p of model.products) {
    const row = products.get(p.article) || {article:p.article,name:p.name,orders_count:null,orders_amount:null};
    products.set(p.article,{...row,name:row.name || p.name,bought_qty:p.bought_qty,for_pay:cents(p.for_pay),
      revenue:model.sales_covered_rows === model.row_count && p.sales_revenue != null ? cents(p.sales_revenue) : null});
  }
  const { data: costs, error: costError } = catalog ? {data:catalog.costs,error:null} : await readCostPrices(admin,shopId);
  if (costError) throw new ApiError(500, 'Не удалось прочитать себестоимость');
  const prices = costCatalogue(costs || []);
  const safeProducts = [...products.values()].map(p => ({ ...p, for_pay: rub(p.for_pay), revenue: p.revenue == null ? null : rub(p.revenue), cost_price: prices.get(articleKey(p.article))?.cost_price ?? null }));
  const financialComplete = job.status === 'complete' || !!sources.financial_extended || !!job.summary?.pilot?.finance_complete;
  const media = mediaFinancialSource(job.summary?.deductions, financialComplete, period.dateFrom, period.dateTo, job.updated_at ?? null, model)
    || mediaSource(sources.media, period.dateFrom, period.dateTo);
  const complete = financialComplete && sources.orders?.status === 'downloaded' && sources.internal_ads?.status === 'downloaded' && media.status === 'downloaded';
  const missing = safeProducts.filter(p => p.bought_qty !== 0 && !(Number(p.cost_price) > 0)).map(p => p.article);
  const cogs = financialComplete && !missing.length ? rub(safeProducts.reduce((sum, p) => sum + BigInt(p.bought_qty) * cents(p.cost_price), 0n)) : null;
  const finance = financialComplete ? {...model.totals,salesAmount:model.sales_covered_rows === model.row_count ? model.totals.salesAmount ?? null : null,bought_qty:model.bought_qty} : null;
  const calculated = economy(finance, cogs, settings, media.amount, advertising(sources.internal_ads?.period_totals), shop.tax_rate, sources.orders?.orders_amount, complete, sources.internal_ads?.undated_operations);
  // Return aggregates only, never full upstream advertising rows or private leases.
  return { shop, job: { id: job.id, status: job.status, stage: job.summary?.pilot?.stage || (complete ? 'done' : 'finance'), row_count: model.row_count, updated_at: job.updated_at, error_message: job.error_message },
    complete, period, settings, cogs, finance, products: safeProducts,
    missing_costs: missing,
    sources: { finance: { status: financialComplete ? 'downloaded' : 'loading' },
      orders: { status: sources.orders?.status || 'pending', amount: sources.orders?.orders_amount ?? null, count: sources.orders?.orders_count ?? null },
      ads: { status: sources.internal_ads?.status || 'pending', totals: sources.internal_ads?.period_totals || {}, undated: sources.internal_ads?.undated_operations || 0 },
      media },
    deductions: job.summary?.deductions || [], economy: calculated, net_profit: calculated?.net_profit ?? null, reconciliation_required: false };
}

export function monthSettings(body: any) {
  const amount = (value: unknown) => {
    if (value == null || value === '' || (typeof value !== 'number' && typeof value !== 'string')) throw new ApiError(400, 'Укажите сумму расходов');
    let v;
    try { v = cents(value); } catch { throw new ApiError(400, 'Укажите сумму с точностью до копейки'); }
    if (v < 0n || v > 100000000000n) throw new ApiError(400, 'Расходы должны быть от 0 до 1 млрд ₽');
    return rub(v);
  };
  if (body.media_spend != null && body.media_spend !== '') throw new ApiError(400, 'Расходы WB Медиа загружаются только через API');
  return { operational_expenses: amount(body.operational_expenses), external_promotion_expenses: amount(body.external_promotion_expenses) };
}

// Poll metadata only: no summary/order arrays, finance model or raw operations.
export async function readCabinetStatus(admin: any, shopId: string) {
  validateShopId(shopId);
  const {data,error} = await admin.from('wb_api_preview_jobs')
    .select('id,date_from,date_to,status,row_count,stage:summary->pilot->>stage,sales_covered:finance_model->>sales_covered_rows')
    .eq('shop_id',shopId).gte('date_from',oldestMonth()).order('created_at',{ascending:false});
  if (error) throw new ApiError(500,'Не удалось прочитать статус истории');
  const jobs = (data || []).map((j:any)=>({id:j.id,date_from:j.date_from,date_to:j.date_to,status:j.status,row_count:j.row_count,stage:j.stage}));
  return {history_loading:jobs.some((j:any)=>j.status==='loading'),
    jobs,
    revision:JSON.stringify((data || []).map((j:any)=>[j.id,j.date_from,j.date_to,j.status,j.stage,'seller-sales-v1',j.status === 'complete' ? j.sales_covered ?? null : null])
      .sort((a:any,b:any)=>a[0].localeCompare(b[0])))};
}

export async function readCabinetTrend(admin: any, shopId: string) {
  validateShopId(shopId);
  const { data: jobs, error } = await admin.from('wb_api_preview_jobs').select('id,date_from,date_to,status,pilot:summary->pilot,api_sources:summary->api_sources,row_count,cursor_id,finance_model,updated_at,error_message').eq('shop_id', shopId).eq('status', 'complete').gte('date_from',oldestMonth()).order('created_at', {ascending:false});
  if (error) throw new ApiError(500, 'Не удалось прочитать динамику');
  const [shopResult,settingsResult,costsResult] = await Promise.all([
    admin.from('shops').select('id,name,tax_rate').eq('id',shopId).single(),
    admin.from('wb_api_month_settings').select('month,operational_expenses,external_promotion_expenses').eq('shop_id',shopId),
    readCostPrices(admin,shopId),
  ]);
  if (shopResult.error || settingsResult.error || costsResult.error) throw new ApiError(500,'Не удалось прочитать настройки динамики');
  const byMonth = new Map();
  for (const item of jobs || []) {
    const job={...item,summary:item.summary || {pilot:item.pilot,api_sources:item.api_sources}};
    const month = job.date_from.slice(0,7);
    if (byMonth.has(month)) continue;
    try {
      const period = cabinetPeriod(month);
      const current = new Date(Date.now()+3*3600000).toISOString().slice(0,7);
      if (period.dateFrom !== job.date_from || job.date_to > period.dateTo || (month !== current && job.date_to !== period.dateTo)) continue;
    } catch { continue; }
    const s = job.summary?.api_sources;
    if (s?.orders?.status !== 'downloaded' || s?.internal_ads?.status !== 'downloaded') continue;
    const c = await readCabinet(admin, shopId, {dateFrom:job.date_from,dateTo:job.date_to}, job.id,
      {shop:shopResult.data,settings:settingsResult.data || [],costs:costsResult.data || [],job});
    if (!c.complete) continue;
    byMonth.set(month, { year:Number(month.slice(0,4)), month:Number(month.slice(5)), sales:c.finance?.salesAmount == null ? null : Number(c.finance.salesAmount), orders:Number(s.orders.orders_amount), quantity:c.finance?.bought_qty ?? null, internalAds:Number(c.economy?.internal_ads), externalAds:Number(c.settings.external_promotion_expenses), transfer:Number(c.economy?.payout), profit:c.net_profit == null ? null : Number(c.net_profit), mediaAds:c.sources.media.amount == null ? null : Number(c.sources.media.amount), drrOrders:c.economy?.drr_orders ?? null, drrSales:c.economy?.drr_sales ?? null, promo:Number(c.economy?.promo) });
    if (byMonth.size >= 12) break;
  }
  return [...byMonth.values()].sort((a,b)=>a.year-b.year || a.month-b.month).slice(-12);
}
