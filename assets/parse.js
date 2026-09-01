// Разбор XLSX-отчётов Wildberries прямо в браузере (SheetJS).
// Формат отчётов иногда чуть отличается по составу столбцов, поэтому
// заголовки ищутся по названию, а не по фиксированной позиции.
(function () {
  function detectHeaderRow(aoa, mustInclude) {
    const limit = Math.min(6, aoa.length);
    for (let i = 0; i < limit; i++) {
      const row = (aoa[i] || []).map((c) => String(c ?? "").trim());
      if (mustInclude.every((req) => row.some((cell) => cell.includes(req)))) return i;
    }
    return -1;
  }

  function colIndex(header, needle) {
    return header.findIndex((h) => String(h ?? "").includes(needle));
  }

  function num(v) {
    if (v == null || v === "") return 0;
    if (typeof v === "number") return v;
    const cleaned = String(v).replace(/\s/g, "").replace(",", ".");
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  }

  async function readWorkbook(file) {
    const buf = await file.arrayBuffer();
    return window.XLSX.read(buf, { type: "array", cellDates: false });
  }

  // ---- «Сводный отчёт по продавцу» -> строки по месяцам ----
  async function parseSummaryReport(file) {
    const wb = await readWorkbook(file);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const aoa = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });

    const headerIdx = detectHeaderRow(aoa, ["Год", "Месяц", "Итого к перечислению"]);
    if (headerIdx === -1) {
      throw new Error("Не удалось распознать «Сводный отчёт по продавцу» — проверьте формат файла.");
    }
    const header = aoa[headerIdx].map((h) => String(h ?? ""));

    const i = {
      year: colIndex(header, "Год"),
      month: colIndex(header, "Месяц"),
      day: colIndex(header, "День"),
      sales: colIndex(header, "Сумма продаж"),
      bought: colIndex(header, "Выкупили"),
      transferGoods: colIndex(header, "К перечислению за товар"),
      delivery: colIndex(header, "Стоимость доставки"),
      storage: colIndex(header, "Стоимость хранения"),
      fines: colIndex(header, "Штрафы"),
      other: colIndex(header, "Доплаты"),
      damage: colIndex(header, "Компенсация ущерба"),
      returnComp: colIndex(header, "Добровольная компенсация"),
      acceptance: colIndex(header, "Операции при при"), // приёмке / приемке
      total: colIndex(header, "Итого к перечислению"),
    };

    const rows = [];
    for (let r = headerIdx + 1; r < aoa.length; r++) {
      const row = aoa[r];
      if (!row) continue;
      const month = row[i.month];
      const day = row[i.day];
      const hasMonth = month != null && String(month).trim() !== "";
      const hasDay = day != null && String(day).trim() !== "";
      if (!hasMonth || hasDay) continue; // нужны только строки-итоги месяца
      const year = parseInt(row[i.year], 10);
      const monthNum = parseInt(month, 10);
      if (!year || !monthNum) continue;
      rows.push({
        year,
        month: monthNum,
        sales_amount: num(row[i.sales]),
        bought_qty: Math.round(num(row[i.bought])),
        transfer_goods: num(row[i.transferGoods]),
        delivery_cost: num(row[i.delivery]),
        storage_cost: num(row[i.storage]),
        fines: num(row[i.fines]),
        other_fees: num(row[i.other]),
        damage_comp: num(row[i.damage]),
        return_comp: num(row[i.returnComp]),
        acceptance_ops: num(row[i.acceptance]),
        transfer_total: num(row[i.total]),
      });
    }
    return rows;
  }

  // ---- «Продажи» -> агрегат по артикулам за один месяц ----
  async function parseSalesReport(file) {
    const wb = await readWorkbook(file);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const aoa = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });

    const headerIdx = detectHeaderRow(aoa, ["Артикул продавца", "Выкупили"]);
    if (headerIdx === -1) {
      throw new Error("Не удалось распознать отчёт «Продажи» — проверьте формат файла.");
    }
    const header = aoa[headerIdx].map((h) => String(h ?? ""));

    // период отчёта обычно указан в заголовке-баннере над таблицей — попробуем его найти
    let period = null;
    for (let r = 0; r < headerIdx; r++) {
      const text = (aoa[r] || []).map((c) => String(c ?? "")).join(" ");
      const m = /с\s+(\d{2})\.(\d{2})\.(\d{4})\s+по\s+(\d{2})\.(\d{2})\.(\d{4})/.exec(text);
      if (m) { period = { year: parseInt(m[3], 10), month: parseInt(m[2], 10) }; break; }
    }

    const i = {
      article: colIndex(header, "Артикул продавца"),
      name: colIndex(header, "Наименование"),
      bought: colIndex(header, "Выкупили"),
      revenue: colIndex(header, "К перечислению за товар"),
    };

    const byArticle = new Map();
    for (let r = headerIdx + 1; r < aoa.length; r++) {
      const row = aoa[r];
      if (!row) continue;
      const article = row[i.article];
      if (article == null || String(article).trim() === "") continue;
      const key = String(article).trim();
      const entry = byArticle.get(key) || { article: key, name: String(row[i.name] ?? ""), bought_qty: 0, revenue: 0 };
      entry.bought_qty += Math.round(num(row[i.bought]));
      entry.revenue += num(row[i.revenue]);
      if (!entry.name && row[i.name]) entry.name = String(row[i.name]);
      byArticle.set(key, entry);
    }
    return { period, skus: Array.from(byArticle.values()) };
  }

  window.WBParse = { parseSummaryReport, parseSalesReport };
})();
