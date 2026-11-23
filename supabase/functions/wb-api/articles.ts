// Costs are shared across marketplaces, but only within the queried shop.
// Keep the original article for display; only the lookup key ignores case.
export const articleKey = (value: unknown) => String(value ?? '').trim().toLowerCase();
// Seeded zeros are placeholders; only an explicitly confirmed zero is a price.
export function hasCostPrice(row:any) {
  const value=row?.cost_price;
  return value!=null && String(value).trim()!=='' && Number.isFinite(Number(value))
    && (Number(value)>0 || Number(value)===0 && row.zero_cost_confirmed===true);
}
export function costCatalogue(rows: any[]) {
  const selected = new Map<string, any>();
  const rank=(row:any)=>Number(row.cost_price)>0?2:hasCostPrice(row)?1:0;
  const ordered = [...rows].sort((a, b) => rank(b) - rank(a)
    || String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
    || (a.article < b.article ? -1 : a.article > b.article ? 1 : 0));
  for (const row of ordered) {
    const key = articleKey(row.article);
    if (!selected.has(key)) selected.set(key, row);
  }
  return selected;
}
