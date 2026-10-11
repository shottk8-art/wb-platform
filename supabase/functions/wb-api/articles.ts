// Costs are shared across marketplaces, but only within the queried shop.
// Keep the original article for display; only the lookup key ignores case.
export const articleKey = (value: unknown) => String(value ?? '').trim().toLowerCase();
export function costCatalogue(rows: any[]) {
  const selected = new Map<string, any>();
  const ordered = [...rows].sort((a, b) => Number(Number(b.cost_price) > 0) - Number(Number(a.cost_price) > 0)
    || String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
    || (a.article < b.article ? -1 : a.article > b.article ? 1 : 0));
  for (const row of ordered) {
    const key = articleKey(row.article);
    if (!selected.has(key)) selected.set(key, row);
  }
  return selected;
}
