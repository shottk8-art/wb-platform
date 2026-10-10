// Read-only browser regression: evaluate against fixture or authenticated settings.
() => {
  const failures = [];
  const visible = e => {
    const details = e.closest('details');
    return e.getClientRects().length > 0 && (!details || details.hasAttribute('open') || e.matches('summary'));
  };
  const sections = [...document.querySelectorAll('.app-view[data-view="settings"]')].filter(visible);
  if (!sections.length) throw new Error('Settings fixture is not visible');
  if (document.documentElement.scrollWidth > innerWidth + 1) failures.push('page overflows viewport');
  let controls = 0, financeRows = 0;
  for (const section of sections) {
    for (const e of section.querySelectorAll('button,input,select,summary,dt,dd')) {
      if (!visible(e)) continue;
      const box = e.getBoundingClientRect();
      const card = e.closest('.card');
      if (card) {
        const bounds = card.getBoundingClientRect();
        if (box.left < bounds.left - 1 || box.right > bounds.right + 1) failures.push((e.id || e.tagName) + ': outside card');
      }
      if (e.matches('input:not([type="checkbox"]),select') && innerWidth <= 600 && getComputedStyle(e).fontSize.replace('px','') * 1 < 16) failures.push(e.id + ': input auto-zoom risk');
      if (e.matches('button')) {
        controls++;
        if (innerWidth <= 600 && box.height < 44) failures.push(e.id + ': small tap target');
      }
      if (e.matches('.api-cabinet-toolbar button,.wb-api-actions button')) {
        const range = document.createRange();
        range.selectNodeContents(e);
        const lines = new Set([...range.getClientRects()].map(r => Math.round(r.top)));
        if (lines.size > 1) failures.push(e.id + ': action label wraps');
        if (innerWidth <= 600 && card && box.width < card.getBoundingClientRect().width - 40) failures.push(e.id + ': mobile action not full width');
      }
      if (e.matches('dt,dd')) {
        const range = document.createRange();
        range.selectNodeContents(e);
        for (const r of range.getClientRects()) if (r.left < box.left - 1 || r.right > box.right + 1) failures.push(e.tagName + ': text escapes cell');
      }
    }
    for (const row of section.querySelectorAll('.api-finance-details > div')) {
      if (!visible(row)) continue;
      financeRows++;
      const label = row.querySelector('dt').getBoundingClientRect();
      const value = row.querySelector('dd').getBoundingClientRect();
      if (label.right > value.left + 1 && label.bottom > value.top + 1 && value.bottom > label.top + 1) failures.push('finance label overlaps amount');
    }
  }
  if (failures.length) throw new Error('Settings FAIL at ' + innerWidth + 'px: ' + failures.join('; '));
  return { verdict: 'PASS', width: innerWidth, controls, financeRows };
}
