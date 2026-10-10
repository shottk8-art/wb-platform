// Read-only browser regression: pass this function to tab.playwright.evaluate.
() => {
  const failures = [];
  const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
  const inside = (a, b) => a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
  document.querySelectorAll('#skuBody td, #skuFoot td').forEach(td => {
    if (!visible(td)) return;
    const bounds = td.getBoundingClientRect();
    td.querySelectorAll('.sku-delta, .qty-cell, .sku-art, .sku-metric strong').forEach(e => {
      if (!inside(e.getBoundingClientRect(), bounds)) failures.push(`${e.className}: outside cell`);
      const range = document.createRange();
      range.selectNodeContents(e);
      for (const rect of range.getClientRects()) {
        if (!inside(rect, bounds)) { failures.push(`${e.className}: text outside cell`); break; }
      }
    });
  });
  if (document.documentElement.scrollWidth > innerWidth + 1) failures.push('page horizontal overflow');
  if (innerWidth <= 600) document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="file"]),select,textarea').forEach(e => {
    if (visible(e) && getComputedStyle(e).fontSize.replace('px','') * 1 < 16) failures.push(`${e.id || e.className}: input text below 16px`);
  });
  if (failures.length) throw new Error(`Mobile layout FAIL at ${innerWidth}px: ${failures.join('; ')}`);
  return { verdict: 'PASS', width: innerWidth, rows: document.querySelectorAll('#skuBody tr').length };
}
