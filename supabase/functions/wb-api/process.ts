import { ApiError, FINANCE_FIELDS, mergeSummaries, pageCursor, sanitizeRows, summarize, validateKey } from './core.ts';

// One durable page per invocation. Cron, not the browser, owns continuation.
export async function processPage(admin: any, job: any, shopId: string, wbFetch: any) {
  const { data: wait, error: claimError } = await admin.rpc('wb_api_claim_request', { p_shop_id: shopId, p_kind: 'finance' });
  if (claimError) throw new ApiError(500, 'Не удалось начать запрос к WB');
  if (Number(wait) > 0) return { retry_after: Number(wait) };
  const { data: token, error: keyError } = await admin.rpc('wb_api_read_key', { p_shop_id: shopId });
  if (keyError || !token) throw new ApiError(400, 'Сначала подключите API магазина');
  const personal = validateKey(String(token));
  const response = await wbFetch(personal.token, 'https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed', {
    dateFrom: job.date_from, dateTo: `${job.date_to}T23:59:59`, limit: 50000,
    rrdId: Number(job.cursor_id), period: job.summary?.pilot?.finance_period || 'weekly', fields: FINANCE_FIELDS,
  });
  const rows = sanitizeRows(response || []);
  // Check the raw sequence: deduplication must not hide an out-of-order last row.
  const cursor = pageCursor(response || [], String(job.cursor_id));
  const freshRows = rows.filter((row) => BigInt(String(row.rrdId)) > BigInt(job.cursor_id));
  let accumulated = job.summary;
  // Upgrade an existing pilot job without discarding its already saved rows.
  if (!accumulated && Number(job.cursor_id) > 0) {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await admin.from('wb_api_preview_rows').select('payload').eq('job_id', job.id).lte('rrd_id', job.cursor_id).order('rrd_id').range(offset, offset + 999);
      if (error) throw new ApiError(500, 'Не удалось прочитать сохранённый прогресс');
      accumulated = mergeSummaries(accumulated, summarize((data || []).map((row: any) => row.payload)));
      if (!data || data.length < 1000) break;
    }
  }
  for (let offset = 0; offset < freshRows.length; offset += 500) {
    const { error } = await admin.from('wb_api_preview_rows').upsert(freshRows.slice(offset, offset + 500).map((row) => ({ job_id: job.id, rrd_id: row.rrdId, payload: row })), { onConflict: 'job_id,rrd_id' });
    if (error) throw new ApiError(500, 'Не удалось сохранить финансовые операции');
  }
  if (job.summary?.pilot) {
    const cards = new Map();
    for (const row of freshRows) if (row.vendorCode) cards.set(String(row.vendorCode), { shop_id: shopId, article: String(row.vendorCode), name: String(row.title || '').slice(0, 300), cost_price: 0 });
    if (cards.size) {
      const { error } = await admin.from('sku_costs').upsert([...cards.values()], { onConflict: 'shop_id,article', ignoreDuplicates: true });
      if (error) throw new ApiError(500, 'Не удалось подготовить карточки себестоимости');
    }
  }
  const summary = { ...accumulated, ...mergeSummaries(accumulated, summarize(freshRows)) };
  const pilot = summary.pilot;
  if (!rows.length && pilot) {
    pilot.finance_complete = true;
    pilot.stage = 'orders';
  }
  const { error } = await admin.from('wb_api_preview_jobs').update({
    cursor_id: cursor.toString(), status: rows.length || pilot ? 'loading' : 'complete', summary,
    row_count: summary.row_count, failure_count: 0, error_message: null, updated_at: new Date().toISOString(),
  }).eq('id', job.id).eq('shop_id', shopId);
  if (error) throw new ApiError(500, 'Не удалось сохранить прогресс загрузки');
  return { row_count: summary.row_count, retry_after: rows.length ? 63 : 0 };
}
