import { cents, rub } from './core.ts';

// WB advertising cashback is promotional credit, not money paid by the seller.
// https://dev.wildberries.ru/news/146 and https://cmp.wildberries.ru/cashback
export function advertising(totals: any = {}) {
  let paid = 0n, bonus = 0n;
  const unknown: string[] = [];
  for (const [type, entry] of Object.entries(totals) as [string, any][]) {
    const name = type.trim().toLowerCase().replace(/ё/g, 'е');
    if (['баланс', 'счет'].includes(name)) paid += cents(entry.amount);
    else if (['бонусы', 'промобонусы', 'кэшбэк', 'кешбэк'].includes(name)) bonus += cents(entry.amount);
    else if (cents(entry.amount)) unknown.push(type);
  }
  return { paid: rub(paid), bonus: rub(bonus), unknown };
}

export function economy(finance: any, cogs: string | null, settings: any, media: string | null, ads: any, taxRate: unknown, orders: unknown, complete: boolean, undated = 0) {
  if (!finance) return null;
  const f = (key: string) => cents(finance[key]);
  // forPay already includes commissions/acquiring and sale corrections.
  // Rebill logistics is a WB commission allocation, not another seller expense.
  // Payout formula: official WB "Еженедельные отчёты реализации" instruction.
  const payout = f('forPay') - f('deliveryService') - f('paidStorage') - f('paidAcceptance')
    - f('penalty') - f('deduction') - f('additionalPayment') - f('cashbackAmount') - f('cashbackCommissionChange') + f('cashbackDiscount');
  const advertisingDeductions = f('advertisingDeductions');
  const advertisingTotal = media == null ? null : cents(ads.paid) + cents(media) + cents(settings.external_promotion_expenses);
  // Percent is represented as hundredths of a percent; round tax once to kopecks.
  const rate = cents(taxRate), base = f('retailAmount');
  const taxProduct = base * rate;
  const tax = (taxProduct < 0n ? -1n : 1n) * ((taxProduct < 0n ? -taxProduct : taxProduct) + 5000n) / 10000n;
  const reasons: string[] = [];
  if (!complete) reasons.push('Не все источники загружены');
  if (cogs == null) reasons.push('Не заполнена себестоимость');
  if (media == null) reasons.push('Расходы WB Медиа ещё не получены из API');
  if (ads.unknown.length || undated) reasons.push('Есть неизвестные типы или даты рекламных списаний');
  const profit = reasons.length ? null : rub(payout + advertisingDeductions - cents(cogs) - tax - advertisingTotal! - cents(settings.operational_expenses));
  return { payout: rub(payout), tax: rub(tax), internal_ads: ads.paid, promo: ads.bonus,
    advertising_total: advertisingTotal == null ? null : rub(advertisingTotal),
    advertising_already_withheld: rub(advertisingDeductions), net_profit: profit, missing: reasons,
    drr_orders: complete && !ads.unknown.length && !undated && advertisingTotal != null && cents(orders) > 0n ? Number(advertisingTotal) / Number(cents(orders)) * 100 : null,
    drr_sales: complete && !ads.unknown.length && !undated && advertisingTotal != null && base > 0n ? Number(advertisingTotal) / Number(base) * 100 : null };
}
