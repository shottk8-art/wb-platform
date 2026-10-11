import { ApiError, FINANCE_FIELDS, mergeSummaries, pageCursor, sanitizeRows, summarize, validateKey } from './core.ts';
import { aggregateFinanceRows, mergeFinanceModels } from './cabinet.ts';

// One durable page per invocation. Cron, not the browser, owns continuation.
export async function processPage(admin: any, job: any, shopId: string, wbFetch: any) {
  if (job.shop_id !== shopId) throw new ApiError(403,'Загрузка относится к другому магазину');
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
  let previousModel = job.finance_model;
  if (Number(job.cursor_id) > 0 && (previousModel?.version !== 1 || previousModel.cursor_id !== String(job.cursor_id) || Number(previousModel.row_count) !== Number(job.row_count ?? accumulated?.row_count))) {
    // One-time bridge for old snapshots; future pages never persist raw rows.
    const {data,error} = await admin.rpc('wb_api_finance_read_model',{p_job_id:job.id});
    if (error || !data) throw new ApiError(500,'Не удалось прочитать сохранённые финансовые итоги');
    previousModel = data;
  }
  const model = mergeFinanceModels(previousModel, aggregateFinanceRows(freshRows,cursor.toString()));
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
  // Compare-and-swap in a single DB transaction: a crash/retry cannot save
  // only half a page, and a stale lease cannot double-count or rewind totals.
  const { data: committed, error } = await admin.rpc('wb_api_commit_finance_page', {
    p_job_id:job.id, p_shop_id:shopId, p_expected_cursor:String(job.cursor_id),
    p_expected_rows:Number(job.row_count || 0), p_cursor:cursor.toString(),
    p_summary:summary, p_model:model, p_status:rows.length || pilot ? 'loading' : 'complete',
  });
  if (error || committed !== true) throw new ApiError(500, 'Не удалось сохранить прогресс загрузки: он мог измениться');
  return { row_count: summary.row_count, retry_after: rows.length ? 63 : 0 };
}
