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
