import { ApiError, PILOT_SHOP_ID, PILOT_USER_ID, cents, rub, summarize, validateKey, validatePeriod } from './core.ts';

export function cabinetPeriod(value: unknown, now = new Date()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) throw new ApiError(400, 'Выберите месяц');
  if (Number(value.slice(5)) < 1 || Number(value.slice(5)) > 12) throw new ApiError(400, 'Некорректный месяц');
  const start = `${value}-01`, d = new Date(start + 'T00:00:00Z');
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const period = validatePeriod(start, end);
  const oldest = new Date(now.getTime() - 365 * 86400000).toISOString().slice(0, 10);
  if (start < oldest || end >= now.toISOString().slice(0, 7) + '-01') throw new ApiError(400, 'В тесте доступны закрытые месяцы за последний год');
  return period;
}
const text = (value: unknown) => String(value || '').slice(0, 300);
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
    undated_operations: undated, classification_pending: Object.keys(totals).filter(t => !['Баланс','Бонусы','Промобонусы'].includes(t)), applied_to_dashboard: false };
}

async function commit(admin: any, job: any, summary: any, status = 'loading') {
  const { error } = await admin.from('wb_api_preview_jobs').update({ summary, status, failure_count: 0, error_message: null, updated_at: new Date().toISOString() }).eq('id', job.id).eq('shop_id', job.shop_id);
  if (error) throw new ApiError(500, 'Не удалось сохранить загрузку источника');
}
// A durable, bounded request per cron tick; no browser-owned continuation.
export async function processCabinetSource(admin: any, job: any, wbFetch: any) {
  if (job.shop_id !== PILOT_SHOP_ID) throw new ApiError(400, 'API-кабинет доступен только для GREEN FLOW');
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
    // Unknown media is not zero. An explicit month-specific owner confirmation survives refresh.
    summary.api_sources.media ||= { status: 'needs_confirmation', date_from: job.date_from, date_to: job.date_to, amount: null };
    pilot.stage = 'done';
    await commit(admin, job, summary, 'complete');
  } else throw new ApiError(400, 'Неизвестный этап загрузки');
  return { retry_after: 63 };
}

export async function readCabinet(admin: any, shopId: string, period: any) {
  const { data: shop, error: shopError } = await admin.from('shops').select('id,name,tax_rate').eq('id', shopId).eq('owner_id', PILOT_USER_ID).single();
  if (shopError || !shop || shopId !== PILOT_SHOP_ID) throw new ApiError(403, 'API-кабинет недоступен');
  const { data: jobs, error } = await admin.from('wb_api_preview_jobs').select('id,status,summary,row_count,error_message,updated_at,date_from,date_to').eq('shop_id', shopId).eq('date_from', period.dateFrom).eq('date_to', period.dateTo).order('created_at', { ascending: false }).limit(1);
  if (error) throw new ApiError(500, 'Не удалось прочитать выгрузку');
  const job = jobs?.[0];
  if (!job) return { job: null, shop, products: [], finance: null, sources: {} };
  const sources = job.summary?.api_sources || {}, products = new Map<string, any>();
  for (const p of sources.orders?.rows || []) {
    const article = String(p.vendor_code || p.nm_id), old = products.get(article);
    products.set(article, { article, name: text(p.title) || old?.name || '', orders_count: (old?.orders_count || 0) + Number(p.orders_count),
      orders_amount: rub(cents(old?.orders_amount) + cents(p.orders_amount)), bought_qty: 0, for_pay: 0n });
  }
  let bought = 0, rowsCount = 0;
  for (let offset = 0; ; offset += 1000) {
    const { data: rows, error } = await admin.from('wb_api_preview_rows').select('payload').eq('job_id', job.id).order('rrd_id').range(offset, offset + 999);
    if (error) throw new ApiError(500, 'Не удалось прочитать товары');
    rowsCount += rows.length;
    for (const { payload: p } of rows) {
      const article = String(p.vendorCode || p.nmId || '');
      if (!article) continue;
      const row = products.get(article) || { article, name: text(p.title), orders_count: null, orders_amount: null, bought_qty: 0, for_pay: 0n };
      if (!row.name) row.name = text(p.title);
      const sign = p.docTypeName === 'Возврат' ? -1 : 1;
      // Corrections can have quantity=1 without a new sale: never double count them.
      if (['Продажа','Возврат'].includes(p.sellerOperName)) { row.bought_qty += sign * Number(p.quantity || 0); bought += sign * Number(p.quantity || 0); }
      row.for_pay += BigInt(sign) * cents(p.forPay);
      products.set(article, row);
    }
    if (rows.length < 1000) break;
  }
  const { data: costs, error: costError } = await admin.from('sku_costs').select('article,cost_price').eq('shop_id', shopId);
  if (costError) throw new ApiError(500, 'Не удалось прочитать себестоимость');
  const prices = new Map((costs || []).map((c: any) => [c.article, c.cost_price]));
  const safeProducts = [...products.values()].map(p => ({ ...p, for_pay: rub(p.for_pay), cost_price: prices.get(p.article) ?? null }));
  const financialComplete = job.status === 'complete' || !!sources.financial_extended || !!job.summary?.pilot?.finance_complete;
  const complete = financialComplete && sources.orders?.status === 'downloaded' && sources.internal_ads?.status === 'downloaded';
  // Return aggregates only, never full upstream advertising rows or private leases.
  return { shop, job: { id: job.id, status: job.status, stage: job.summary?.pilot?.stage || (complete ? 'done' : 'finance'), row_count: rowsCount, updated_at: job.updated_at, error_message: job.error_message },
    complete, finance: financialComplete ? { ...job.summary?.totals, bought_qty: bought } : null, products: safeProducts,
    missing_costs: safeProducts.filter(p => p.bought_qty > 0 && !(Number(p.cost_price) > 0)).map(p => p.article),
    sources: { finance: { status: financialComplete ? 'downloaded' : 'loading' },
      orders: { status: sources.orders?.status || 'pending', amount: sources.orders?.orders_amount ?? null, count: sources.orders?.orders_count ?? null },
      ads: { status: sources.internal_ads?.status || 'pending', totals: sources.internal_ads?.period_totals || {}, undated: sources.internal_ads?.undated_operations || 0 },
      media: { status: sources.media?.status || 'needs_confirmation', amount: sources.media?.amount ?? null } },
    deductions: job.summary?.deductions || [], net_profit: null, reconciliation_required: true };
}
