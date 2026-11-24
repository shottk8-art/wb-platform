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

  // Unknown markers are not zero. Used for order metrics, not legacy fees.
  function optionalNum(value) {
    if (value == null || String(value).trim() === '') return null;
    const number = Number(typeof value === 'number' ? value : String(value).replace(/\s/g,'').replace(',','.'));
    return Number.isFinite(number) ? number : null;
  }

  const libraries = new Map();
  function loadLibrary(globalName,url) {
    if(window[globalName]) return Promise.resolve();
    if(!libraries.has(globalName)) libraries.set(globalName,new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src=url; script.async=true;
      script.onload=()=>window[globalName] ? resolve() : fail();
      const fail=()=>{libraries.delete(globalName);script.remove();reject(new Error('Не удалось загрузить обработчик отчётов. Проверьте интернет и повторите загрузку.'));};
      script.onerror=fail;
      document.head.append(script);
    }));
    return libraries.get(globalName);
  }

  async function readWorkbook(file, options = {}) {
    await loadLibrary('XLSX','https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
    const buf = await file.arrayBuffer();
    return window.XLSX.read(buf, { type: "array", cellDates: false, ...options });
  }

  // Ozon формирует XLSX с текстом в ячейках t="str" и XML-сущностями.
  // SheetJS 0.18.5 ошибочно повторно декодирует кириллицу как UTF-8.
  // Эта функция воспроизводит его преобразование, чтобы узнавать как
  // нормальный, так и повреждённый вариант служебных значений без тяжёлого
  // повторного разбора XML-файла на сотни мегабайт.
  function sheetJsLegacyText(text) {
    let out = "", i = 0;
    while (i < text.length) {
      const c = text.charCodeAt(i++);
      if (c < 128) { out += String.fromCharCode(c); continue; }
      const d = text.charCodeAt(i++);
      if (c > 191 && c < 224) {
        out += String.fromCharCode(((c & 31) << 6) | (d & 63));
        continue;
      }
      const e = text.charCodeAt(i++);
      if (c < 240) {
        out += String.fromCharCode(((c & 15) << 12) | ((d & 63) << 6) | (e & 63));
        continue;
      }
      const f = text.charCodeAt(i++);
      const w = (((c & 7) << 18) | ((d & 63) << 12) | ((e & 63) << 6) | (f & 63)) - 65536;
      out += String.fromCharCode(0xD800 + ((w >>> 10) & 1023), 0xDC00 + (w & 1023));
    }
    return out;
  }

  function ozonTextEquals(value, expected) {
    const text = String(value ?? "").trim();
    return text === expected || text === sheetJsLegacyText(expected);
  }

  function ozonColIndex(header, expected) {
    return header.findIndex((cell) => ozonTextEquals(cell, expected));
  }

  function normalizeOzonText(value, knownValues) {
    const text = String(value ?? "").trim();
    return knownValues.find((known) => text === known || text === sheetJsLegacyText(known)) || text;
  }

  function ozonProductName(value) { return String(value ?? '').trim(); }

  function ozonXmlText(value) {
    const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
    return String(value).replace(/&(amp|lt|gt|quot|apos);|&#(x[\da-f]+|\d+);/gi,(_match,named,code)=>{
      if(named)return entities[named.toLowerCase()];
      const n=code[0].toLowerCase()==='x'?parseInt(code.slice(1),16):Number(code);
      return n>0&&n<=0x10ffff?String.fromCodePoint(n):'\ufffd';
    }).replace(/_x([\da-f]{4})_/gi,(_match,code)=>String.fromCharCode(parseInt(code,16)));
  }

  // Recover text from the actual cells, before grouping by article. The old
  // name-only fallback could not match a Cyrillic article already damaged by
  // SheetJS's t="str" decoder. Financial numeric cells are never rewritten.
  async function restoreOzonText(file, workbook, sheetName) {
    await loadLibrary('fflate','https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js');
    const files=window.fflate.unzipSync(new Uint8Array(await file.arrayBuffer()),{
      filter:entry=>/^xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml)$/.test(entry.name),
    });
    const xml=path=>files[path]?new TextDecoder('utf-8',{fatal:true}).decode(files[path]):'';
    const attr=(text,key)=>new RegExp('(?:^|\\s)'+key+'=["\']([^"\']*)["\']').exec(text)?.[1];
    const sheetTag=[...xml('xl/workbook.xml').matchAll(/<sheet\b([^>]*)\/?\s*>/g)].find(m=>ozonXmlText(attr(m[1],'name')||'')===sheetName);
    const relation=sheetTag&&[...xml('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*)\/?\s*>/g)].find(m=>attr(m[1],'Id')===attr(sheetTag[1],'r:id'));
    let path;
    if(relation){
      const target=ozonXmlText(attr(relation[1],'Target')||''),parts=[];
      for(const part of (target.startsWith('/')?target.slice(1):'xl/'+target).split('/')){if(part==='..')parts.pop();else if(part&&part!=='.')parts.push(part);}
      path=parts.join('/');
    }else{
      const sheets=Object.keys(files).filter(p=>p.startsWith('xl/worksheets/'));
      if(sheets.length===1)path=sheets[0];
    }
    if(!path||!files[path])throw Error('Не удалось прочитать текст листа Ozon. Скачайте исходный XLSX и повторите загрузку.');
    const sheet=workbook.Sheets[sheetName],source=xml(path),rows=/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
    let rowIndex=-1,row;
    while((row=rows.exec(source))){
      rowIndex=attr(row[1],'r')?Number(attr(row[1],'r'))-1:rowIndex+1;
      const cells=/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;let column=-1,cell;
      while((cell=cells.exec(row[2]||''))){
        const reference=attr(cell[1],'r');column=reference?window.XLSX.utils.decode_cell(reference).c:column+1;
        if(attr(cell[1],'t')!=='str')continue;
        const value=/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(cell[2]||'');if(!value)continue;
        const address=reference||window.XLSX.utils.encode_cell({r:rowIndex,c:column});
        const target=sheet[address];if(!target)continue;
        target.v=ozonXmlText(value[1]);target.t='s';delete target.w;
      }
    }
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
      orders: colIndex(header, "Сумма заказов"),
      orderedQty: colIndex(header, "Заказано, шт."),
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
    if (i.orders < 0) throw new Error('В сводном отчёте отсутствует колонка «Сумма заказов». Скачайте полный отчёт Wildberries.');
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
      const ordersAmount = optionalNum(row[i.orders]);
      if (ordersAmount == null) throw new Error(`В сводном отчёте нет суммы заказов за ${monthNum}.${year}. Скачайте полную выгрузку Wildberries.`);
      const orderedQty = i.orderedQty < 0 ? null : optionalNum(row[i.orderedQty]);
      rows.push({
        year,
        month: monthNum,
        sales_amount: num(row[i.sales]),
        orders_amount: ordersAmount,
        orders_qty: Number.isSafeInteger(orderedQty) && orderedQty >= 0 ? orderedQty : null,
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

  // ---- Файл себестоимости -> [{article, name, cost_price}] ----
  // Ожидаются столбцы «Артикул» и «Себестоимость» (порядок и остальные
  // столбцы не важны), «Наименование» — опционально.
  async function parseCostsFile(file) {
    const wb = await readWorkbook(file);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const aoa = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });

    const headerIdx = detectHeaderRow(aoa, ["Артикул", "Себестоимость"]);
    if (headerIdx === -1) {
      throw new Error("Не удалось распознать файл — нужны столбцы «Артикул» и «Себестоимость».");
    }
    const header = aoa[headerIdx].map((h) => String(h ?? ""));
    const i = {
      article: colIndex(header, "Артикул"),
      name: colIndex(header, "Наименование"),
      cost: colIndex(header, "Себестоимость"),
    };

    const rows = [];
    for (let r = headerIdx + 1; r < aoa.length; r++) {
      const row = aoa[r];
      if (!row) continue;
      const article = row[i.article];
      if (article == null || String(article).trim() === "") continue;
      rows.push({
        article: String(article).trim(),
        name: i.name >= 0 && row[i.name] != null ? String(row[i.name]).trim() : "",
        cost_price: num(row[i.cost]),
      });
    }
    if (!rows.length) throw new Error("В файле не найдено ни одной строки с артикулом.");
    return rows;
  }

  // ---- «История затрат» на рекламу -> расход по месяцам, отдельно
  // баланс (уменьшает прибыль) и промобонусы (справочно). Период файла
  // может быть произвольным и охватывать несколько месяцев — месяц
  // берётся из даты списания каждой строки, а не из имени файла.
  async function parseAdsSpendFile(file) {
    const wb = await readWorkbook(file);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const aoa = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });

    const headerIdx = detectHeaderRow(aoa, ["Дата списания", "Источник списания", "Сумма"]);
    if (headerIdx === -1) {
      throw new Error("Не удалось распознать файл истории затрат на рекламу — проверьте формат.");
    }
    const header = aoa[headerIdx].map((h) => String(h ?? ""));
    const i = {
      date: colIndex(header, "Дата списания"),
      source: colIndex(header, "Источник списания"),
      sum: colIndex(header, "Сумма"),
    };

    const byMonth = new Map();
    const details = new Map();
    let transactionCount = 0;
    for (let r = headerIdx + 1; r < aoa.length; r++) {
      const row = aoa[r];
      if (!row) continue;
      const rawDate = row[i.date];
      if (rawDate == null || String(rawDate).trim() === "") continue;
      const datePart = String(rawDate).trim().split(" ")[0]; // "2026-08-31 23:59" -> "2026-08-31"
      const [year, month] = datePart.split("-").map((x) => parseInt(x, 10));
      if (!year || !month) continue;

      const key = `${year}-${month}`;
      if (!byMonth.has(key)) byMonth.set(key, { year, month, balance: 0, promo: 0 });
      const entry = byMonth.get(key);
      const amount = num(row[i.sum]);
      // Сравниваем по вхождению, а не точным совпадением — формулировка
      // источника в реальных выгрузках WB встречается с вариациями
      // ("Промобонусы", "промо бонусы" и т.п.), точное сравнение такое
      // пропускало и всё уходило в баланс.
      const source = String(row[i.source] ?? "").trim().toLowerCase();
      if (source.includes("промо")) entry.promo += amount;
      else entry.balance += amount; // "Баланс" и любой другой источник — считаем как реальный расход

      transactionCount++;
    }

    const periods = Array.from(byMonth.values()).sort((a, b) => a.year - b.year || a.month - b.month);
    if (!periods.length) throw new Error("В файле не найдено ни одной строки со списанием.");
    return { periods, transactionCount };
  }

  function normalizedHeader(value) {
    return String(value ?? "").trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
  }

  function findHeaderByAliases(header, aliases) {
    const normalized = header.map(normalizedHeader);
    return normalized.findIndex((cell) => aliases.some((alias) => cell === alias || cell.includes(alias)));
  }

  // ---- WB Media / расширенная статистика ----
  // Формат выгрузок менялся, поэтому узнаём распространённые названия
  // колонок. Период определяется по дате каждой операции.
  async function parseWbMedia(file) {
    const wb = await readWorkbook(file);
    const dateAliases = ["дата", "день", "период"];
    const spendAliases = ["затраты, ₽", "затраты, руб", "затраты (руб", "расходы, ₽", "расходы, руб", "расход, ₽", "потрачено", "сумма затрат"];
    const orderAliases = ["заказы, ₽", "заказы, руб", "сумма заказов", "заказов на сумму"];
    const byMonth = new Map();
    let transactionCount = 0;
    let recognized = false;

    for (const sheetName of wb.SheetNames) {
      const aoa = window.XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null, raw: true });
      const transactionHeaderIdx = detectHeaderRow(aoa, ["Дата списания", "Источник списания", "Сумма"]);
      if (transactionHeaderIdx >= 0) {
        recognized = true;
        const header = aoa[transactionHeaderIdx].map((value) => String(value ?? ""));
        const dateIdx = colIndex(header, "Дата списания");
        const sourceIdx = colIndex(header, "Источник списания");
        const amountIdx = colIndex(header, "Сумма");
        for (let r = transactionHeaderIdx + 1; r < aoa.length; r++) {
          const row = aoa[r];
          const date = row && parseSheetDate(row[dateIdx]);
          if (!date) continue;
          const amount = Math.abs(num(row[amountIdx]));
          if (amount < 0.00001) continue;
          const year = date.getFullYear(), month = date.getMonth() + 1;
          const key = `${year}-${month}`;
          if (!byMonth.has(key)) byMonth.set(key, { year, month, amount: 0, promo: 0, orders: 0 });
          const source = String(row[sourceIdx] ?? "").trim().toLowerCase();
          if (source.includes("промо")) byMonth.get(key).promo += amount;
          else byMonth.get(key).amount += amount;
          transactionCount++;
        }
        continue;
      }
      let headerIdx = -1, dateIdx = -1, spendIdx = -1, ordersIdx = -1;
      for (let r = 0; r < Math.min(15, aoa.length); r++) {
        const header = aoa[r] || [];
        const candidateSpend = findHeaderByAliases(header, spendAliases);
        if (candidateSpend >= 0) {
          headerIdx = r;
          spendIdx = candidateSpend;
          dateIdx = findHeaderByAliases(header, dateAliases);
          ordersIdx = findHeaderByAliases(header, orderAliases);
          break;
        }
      }
      if (headerIdx < 0) continue;
      recognized = true;
      for (let r = headerIdx + 1; r < aoa.length; r++) {
        const row = aoa[r];
        if (!row) continue;
        const amount = num(row[spendIdx]);
        if (Math.abs(amount) < 0.00001) continue;
        const date = dateIdx >= 0 ? parseSheetDate(row[dateIdx]) : null;
        const year = date ? date.getFullYear() : 0;
        const month = date ? date.getMonth() + 1 : 0;
        if (!year || !month) continue;
        const key = `${year}-${month}`;
        if (!byMonth.has(key)) byMonth.set(key, { year, month, amount: 0, promo: 0, orders: 0 });
        byMonth.get(key).amount += Math.abs(amount);
        if (ordersIdx >= 0) byMonth.get(key).orders += Math.abs(num(row[ordersIdx]));
        transactionCount++;
      }
    }
    if (!recognized) throw new Error("Не удалось найти колонку «Затраты» в выгрузке WB Media.");
    const periods = [...byMonth.values()].sort((a, b) => a.year - b.year || a.month - b.month);
    if (!periods.length) throw new Error("В файле WB Media не найдено расходов с корректной датой списания.");
    return { periods, transactionCount };
  }

  function parseSheetDate(value) {
    if (value instanceof Date && !isNaN(value)) return value;
    if (typeof value === "number") {
      const d = window.XLSX.SSF.parse_date_code(value);
      return d ? new Date(d.y, d.m - 1, d.d) : null;
    }
    const text = String(value ?? "").trim();
    const ru = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(text);
    if (ru) return new Date(Number(ru[3]), Number(ru[2]) - 1, Number(ru[1]));
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const parsed = new Date(text);
    return isNaN(parsed) ? null : parsed;
  }

  // ---- Ozon «Отчёт по начислениям» ----
  // Один файл содержит финансовый результат, рекламу и товарный разрез.
  // Периоды определяются по «Дате начисления», поэтому файл может включать
  // произвольный диапазон и одновременно операции FBO и FBS.
  async function parseOzonAccruals(file) {
    const wb = await readWorkbook(file);
    const sheetName = wb.SheetNames.find((name) => name.toLowerCase().includes("начислен")) || wb.SheetNames[0];
    await restoreOzonText(file, wb, sheetName);
    const sheet = wb.Sheets[sheetName];
    const aoa = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
    const requiredHeaders = ["Дата начисления", "Группа услуг", "Тип начисления", "Сумма итого, руб."];
    const headerIdx = aoa.slice(0, 6).findIndex((row) => requiredHeaders.every((expected) => (row || []).some((cell) => ozonTextEquals(cell, expected))));
    if (headerIdx === -1) throw new Error("Не удалось распознать Ozon «Отчёт по начислениям». Скачайте исходный XLSX из раздела «Финансы → Начисления».");
    const header = aoa[headerIdx].map((h) => String(h ?? "").trim());
    const i = {
      date: ozonColIndex(header, "Дата начисления"), group: ozonColIndex(header, "Группа услуг"),
      type: ozonColIndex(header, "Тип начисления"), article: ozonColIndex(header, "Артикул"),
      sku: ozonColIndex(header, "SKU"), name: ozonColIndex(header, "Название товара"),
      qty: ozonColIndex(header, "Количество"), sellerPrice: ozonColIndex(header, "Цена продавца"),
      total: ozonColIndex(header, "Сумма итого, руб."),
    };
    const knownGroups = ["Продажи", "Возвраты", "Вознаграждение Ozon", "Продвижение и реклама", "Услуги партнёров", "Компенсации и декомпенсации", "Услуги доставки", "Услуги FBO", "Другие услуги и штрафы", "Прочие начисления"];
    const knownTypes = ["Выручка", "Возврат выручки"];
    const byMonth = new Map();
    const details = new Map();
    let transactionCount = 0;
    for (let r = headerIdx + 1; r < aoa.length; r++) {
      const row = aoa[r];
      const date = row && parseSheetDate(row[i.date]);
      if (!date) continue;
      const year = date.getFullYear(), month = date.getMonth() + 1, key = `${year}-${month}`;
      if (!byMonth.has(key)) byMonth.set(key, { year, month, totalNet: 0, groups: new Map(), orders: 0, qty: 0, skus: new Map() });
      const period = byMonth.get(key);
      const group = normalizeOzonText(row[i.group], knownGroups);
      const type = normalizeOzonText(row[i.type], knownTypes);
      const amount = num(row[i.total]);
      if(window.WBOzonModel){
        if(!details.has(key))details.set(key,window.WBOzonModel.create(null));
        const day=`${year}-${String(month).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
        window.WBOzonModel.add(details.get(key),{date:day,group,type,amount:row[i.total],article:String(row[i.article]??row[i.sku]??'').trim(),name:ozonProductName(row[i.name]),quantity:num(row[i.qty])});
      }
      period.totalNet += amount;
      period.groups.set(group, (period.groups.get(group) || 0) + amount);

      const isSale = group === "Продажи";
      const isReturn = group === "Возвраты";
      if (isSale && type === "Выручка") {
        period.qty += Math.round(num(row[i.qty]));
        period.orders += Math.abs(num(row[i.sellerPrice]));
      } else if (isReturn && type === "Возврат выручки") {
        period.qty -= Math.round(Math.abs(num(row[i.qty])));
      }
      if (isSale || isReturn) {
        const article = String(row[i.article] ?? row[i.sku] ?? "").trim();
        if (article) {
          const sku = period.skus.get(article) || { article, name: ozonProductName(row[i.name]), bought_qty: 0, revenue: 0 };
          sku.revenue += amount;
          if (type === "Выручка") sku.bought_qty += Math.round(num(row[i.qty]));
          if (type === "Возврат выручки") sku.bought_qty -= Math.round(Math.abs(num(row[i.qty])));
          if (!sku.name && row[i.name]) sku.name = ozonProductName(row[i.name]);
          period.skus.set(article, sku);
        }
      }
      transactionCount++;
    }
    const periods = Array.from(byMonth.values()).map((p) => {
      const g = (name) => p.groups.get(name) || 0;
      const sales = g("Продажи") + g("Возвраты");
      const commission = Math.max(0, -g("Вознаграждение Ozon"));
      const ads = Math.max(0, -g("Продвижение и реклама"));
      const partnerAndOther = g("Услуги партнёров") + g("Компенсации и декомпенсации") + g("Прочие начисления");
      return {
        report: {
          year: p.year, month: p.month, sales_amount: sales, orders_amount: p.orders,
          bought_qty: p.qty, transfer_goods: sales - commission,
          transfer_total: p.totalNet + ads,
          delivery_cost: Math.max(0, -g("Услуги доставки")),
          storage_cost: Math.max(0, -g("Услуги FBO")),
          fines: Math.max(0, -g("Другие услуги и штрафы")),
          acceptance_ops: 0, damage_comp: 0, return_comp: 0,
          other_fees: Math.max(0, -partnerAndOther),
          ads_spend: ads, ads_promo_spend: 0,
        },
        skus: Array.from(p.skus.values()),
      };
    }).sort((a, b) => a.report.year - b.report.year || a.report.month - b.report.month);
    if(window.WBOzonModel)for(const p of periods){
      const detail=details.get(`${p.report.year}-${p.report.month}`),dates=[...detail.days.keys()].sort();
      detail.coverage=window.WBOzonModel.coverage(aoa.slice(0,headerIdx),p.report.year,p.report.month,dates);
      p.analytics=window.WBOzonModel.finish(detail);
    }
    if (!periods.length) throw new Error("В отчёте Ozon не найдено ни одной операции с датой начисления.");
    return { periods, transactionCount };
  }

  window.WBParse = {
    parseSummaryReport, parseSalesReport, parseCostsFile, parseAdsSpendFile,
    parseWbMedia, parseOzonAccruals,
  };
})();
