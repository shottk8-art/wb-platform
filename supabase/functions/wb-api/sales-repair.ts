import { cents } from './core.ts';

// Compatibility projection for authenticating old archives whose saved
// models predate seller-price fields; never discard other financial fields.
export function withoutSalesFields(model: any) {
  const old = structuredClone(model);
  delete old.sales_covered_rows;
  delete old.totals.salesAmount;
  old.products.forEach((p: any) => {delete p.sales_revenue;});
  return old;
}

// Enrich an existing snapshot; never replace its payout, expenses, product
// identity/name or advertising metadata with a fresh upstream report.
export function enrichSalesModel(previous: any, recovered: any) {
  const reject = () => { throw new Error('Financial snapshot changed; sales enrichment refused'); };
  if (previous?.version !== 1 || recovered?.version !== 1 ||
      String(previous.cursor_id) !== String(recovered.cursor_id) ||
      previous.row_count !== recovered.row_count || previous.bought_qty !== recovered.bought_qty ||
      recovered.sales_covered_rows !== recovered.row_count || recovered.totals?.salesAmount == null) reject();
  for (const [key, value] of Object.entries(previous.totals || {})) {
    if (key !== 'salesAmount' && (recovered.totals[key] == null || cents(value) !== cents(recovered.totals[key]))) reject();
  }
  if (previous.sales_covered_rows === previous.row_count && previous.totals.salesAmount != null &&
      cents(previous.totals.salesAmount) !== cents(recovered.totals.salesAmount)) reject();
  const products = new Map(recovered.products.map((p: any) => [p.article,p]));
  if (products.size !== previous.products.length || products.size !== recovered.products.length) reject();
  const next = structuredClone(previous);
  next.products = previous.products.map((p: any) => {
    const r: any = products.get(p.article);
    if (!r || p.bought_qty !== r.bought_qty || r.sales_revenue == null ||
        cents(p.for_pay) !== cents(r.for_pay) || cents(p.revenue) !== cents(r.revenue)) reject();
    if (previous.sales_covered_rows === previous.row_count && p.sales_revenue != null &&
        cents(p.sales_revenue) !== cents(r.sales_revenue)) reject();
    return {...p,sales_revenue:r.sales_revenue};
  });
  next.sales_covered_rows = recovered.row_count;
  next.totals.salesAmount = recovered.totals.salesAmount;
  return next;
}
