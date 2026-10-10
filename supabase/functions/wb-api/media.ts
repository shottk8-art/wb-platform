import { ApiError, cents, rub } from './core.ts';

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

export function mediaSource(source: any, from: string, to: string) {
  if (source?.status === 'downloaded' && source.date_from === from && source.date_to === to && source.amount != null && cents(source.amount) >= 0n) {
    return { status: 'downloaded', amount: rub(cents(source.amount)), date_from: from, date_to: to, fetched_at: source.fetched_at ?? null };
  }
  return { status: source?.status === 'loading' ? 'loading' : 'pending', amount: null, date_from: from, date_to: to };
}
