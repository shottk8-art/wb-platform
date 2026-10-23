// Логика загрузки данных из Supabase и отрисовки дашборда.
// Используется и в личном кабинете (editable = true), и в публичной
// витрине магазина (editable = false, без панели загрузки/ввода).
(function () {
  if (window.Chart) {
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 12;
    Chart.defaults.color = getComputedStyle(document.body).getPropertyValue("--ink-soft").trim();
  }
  const sb = () => window.supabaseClient;
  const articleKey = value => String(value ?? '').trim().toLowerCase();
  function costCatalogue(rows) {
    const selected = new Map();
    const ordered = [...rows].sort((a, b) => Number(Number(b.cost_price) > 0) - Number(Number(a.cost_price) > 0)
      || String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
      || (a.article < b.article ? -1 : a.article > b.article ? 1 : 0));
    for (const row of ordered) {
      const key = articleKey(row.article);
      if (!selected.has(key)) selected.set(key, row);
    }
    return selected;
  }
  const fmtMoney = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
  const fmtQty = new Intl.NumberFormat("ru-RU");
  const fmtCompact = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
  const fmtRate = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmtShort = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });
  const MONTH_NAMES = ["", "январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"];

  let charts = { pie: null, bar: null, trends: new WeakMap() };
  let skuView = { abc: "all", query: "", sort: "revenue" };

  const TREND_METRICS = {
    orders: { label: "Сумма заказов", unit: "₽", color: "#0071e3" },
    sales: { label: "Сумма продаж", unit: "₽", color: "#0071e3" },
    quantity: { label: "Выкупили", unit: "шт.", color: "#0071e3" },
    transfer: { label: "К выплате после удержаний", unit: "₽", color: "#0071e3" },
    profit: { label: "Чистая прибыль", unit: "₽", color: "#187a32" },
    profitability: { label: "Рентабельность", unit: "%", color: "#187a32" },
    internalAds: { label: "Внутренняя реклама", unit: "₽", color: "#0071e3" },
    mediaAds: { label: "Медийная реклама", unit: "₽", color: "#af52de" },
    drrOrders: { label: "ДРР (заказа)", unit: "%", color: "#ff9f0a" },
    drrSales: { label: "ДРР (выкупа)", unit: "%", color: "#af52de" },
    promo: { label: "Промобонусы", unit: "₽", color: "#0071e3" },
  };

  function getTrendMetric(key, marketplace) {
    const metric = { ...(TREND_METRICS[key] || TREND_METRICS.sales) };
    if(typeof getComputedStyle==='function' && document.body){
      const token=key==='profit'||key==='profitability'?'--good':key==='mediaAds'||key==='drrSales'?'--violet':key==='drrOrders'?'--warm':'--accent';
      metric.color=getComputedStyle(document.body).getPropertyValue(token).trim() || metric.color;
    }
    if (key === "internalAds" && marketplace === "ozon") metric.label = "Продвижение Ozon";
    if (key === "transfer" && marketplace === "wildberries") metric.label = "Итого к перечислению (WB)";
    if (key === "transfer" && marketplace === "ozon") metric.label = "К выплате после удержаний (Ozon)";
    return metric;
  }

  function lastClosedPeriod(referenceDate = new Date()) {
    const date = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 1, 1);
    return { year: date.getFullYear(), month: date.getMonth() + 1 };
  }

  function defaultPeriodValue(periods, referenceDate = new Date()) {
    if (!periods || !periods.length) return "";
    const closed = lastClosedPeriod(referenceDate);
    const closedKey = `${closed.year}-${closed.month}`;
    if (periods.some((period) => `${period.year}-${period.month}` === closedKey)) return closedKey;
    const nearestClosed = periods.find((period) => period.year < closed.year || (period.year === closed.year && period.month < closed.month));
    const selected = nearestClosed || periods[0];
    return `${selected.year}-${selected.month}`;
  }

  function withMarketplace(query, marketplace) {
    return marketplace ? query.eq("marketplace", marketplace) : query;
  }

  // Только денежные расходы: промобонусы справочные и в ДРР не входят.
  function advertisingRatios(rep) {
    const ads = (Number(rep.ads_spend) || 0) + (Number(rep.wb_media_spend) || 0)
      + (Number(rep.external_promotion_expenses) || 0);
    return {
      ads,
      drrOrders: rep.orders_amount > 0 ? ads / rep.orders_amount * 100 : null,
      drrSales: rep.sales_amount > 0 ? ads / rep.sales_amount * 100 : null,
    };
  }

  async function loadPeriods(shopId, marketplace) {
    const { data, error } = await sb().rpc("get_complete_periods", { p_shop_id: shopId, p_marketplace: marketplace });
    if (error) throw error;
    return data || [];
  }

  async function loadPeriodData(shopId, year, month, marketplace) {
    const reportQuery = sb().from("monthly_reports").select("*").eq("shop_id", shopId).eq("year", year).eq("month", month);
    const sales = () => withMarketplace(sb().from("sku_sales").select("*").eq("shop_id", shopId).eq("year", year).eq("month", month),marketplace).order("article");
    const costs = () => sb().from("sku_costs").select("article,name,cost_price,updated_at").eq("shop_id", shopId).order("article");
    const [reportResult, skus, catalogue] = await Promise.all([
      withMarketplace(reportQuery, marketplace).maybeSingle(),
      readPages(sales),
      readPages(costs),
    ]);
    if (reportResult.error) throw reportResult.error;
    const report = reportResult.data;
    const resolved = costCatalogue(catalogue);
    const costMap = new Map([...resolved].map(([key, c]) => [key, c.cost_price]));
    const costNameMap = new Map(catalogue.filter((c) => c.name).map((c) => [articleKey(c.article), c.name]));
    const namedSkus = (skus || []).map((sku) => ({
      ...sku,
      name: sku.name || costNameMap.get(articleKey(sku.article)) || sku.article,
    }));
    return { report, skus: namedSkus, costMap };
  }

  async function readPages(makeQuery) {
    const rows = [];
    for(let offset=0;;offset+=1000) {
      const {data,error}=await makeQuery().range(offset,offset+999);
      if(error) throw error;
      rows.push(...(data || []));
      if(!data || data.length<1000) return rows;
    }
  }

  // One catalogue and paginated, shop-scoped reads for the whole comparison
  // window, rather than loading the same catalogue once for every month.
  async function loadPeriodRange(shopId, periods, marketplace) {
    const months = periods.map(p => ({year:Number(p.year),month:Number(p.month)}));
    if (!months.length || months.some(p=>!Number.isInteger(p.year)||p.year<2000||p.year>2100||!Number.isInteger(p.month)||p.month<1||p.month>12)) throw new Error('Некорректный период');
    const filter = months.map(p=>`and(year.eq.${p.year},month.eq.${p.month})`).join(',');
    const scoped = table => withMarketplace(sb().from(table).select('*').eq('shop_id',shopId),marketplace).or(filter).order('year').order('month');
    const [reports,skus,catalogue,ready] = await Promise.all([
      readPages(()=>scoped('monthly_reports')),
      readPages(()=>scoped('sku_sales').order('article').order('id')),
      readPages(()=>sb().from('sku_costs').select('article,name,cost_price,updated_at').eq('shop_id',shopId).order('article')),
      loadPeriods(shopId,marketplace),
    ]);
    const prices=costCatalogue(catalogue),costMap=new Map([...prices].map(([key,row])=>[key,row.cost_price]));
    const names=new Map(catalogue.filter(row=>row.name).map(row=>[articleKey(row.article),row.name]));
    const key=p=>`${p.year}-${p.month}`, available=new Set(ready.map(key)), result=new Map(months.map(p=>[key(p),{available:available.has(key(p)),report:null,skus:[],costMap}]));
    reports.forEach(report=>{const entry=result.get(key(report));if(entry)entry.report=report;});
    skus.forEach(row=>{const entry=result.get(key(row));if(entry)entry.skus.push({...row,name:row.name || names.get(articleKey(row.article)) || row.article});});
    return result;
  }

  async function loadTrendData(shopId, taxRate, marketplace) {
    const {data,error}=await sb().rpc('get_file_trend',{p_shop_id:shopId,p_marketplace:marketplace});
    if(error) throw error;
    return (data || []).map(({report,cogs}) => {
      // Keep the established file-report profit formula; the only server-side
      // aggregation is quantity × live cost price, for the exact shop/period.
      const d = computeDerived(report, [], new Map(), taxRate);
      const salesAmount = report.sales_amount || 0;
      const ordersAmount = report.orders_amount || 0;
      return {
        year: report.year, month: report.month, sales: salesAmount, profit: d.netProfit-Number(cogs),
        orders: marketplace === 'ozon' ? null : ordersAmount,
        quantity: report.bought_qty || 0,
        transfer: report.transfer_total || 0,
        internalAds: report.ads_spend || 0,
        mediaAds: report.wb_media_spend || 0,
        promo: report.ads_promo_spend || 0,
        ...advertisingRatios(report),
      };
    }).reverse();
  }

  // taxRate — ставка налога в % от суммы продаж (свойство магазина, не
  // привязана к периоду — как и себестоимость).
  function computeDerived(report, skus, costMap, taxRate) {
    const rep = report || {
      sales_amount: 0, orders_amount: 0, bought_qty: 0, transfer_total: 0, transfer_goods: 0,
      delivery_cost: 0, storage_cost: 0, fines: 0, acceptance_ops: 0,
      damage_comp: 0, return_comp: 0, other_fees: 0, ads_spend: 0, ads_promo_spend: 0,
      wb_media_spend: 0, wb_media_orders_amount: 0, loyalty_points_spend: 0, loyalty_program_fee: 0,
      operational_expenses: 0, external_promotion_expenses: 0,
    };
    const commission = (rep.sales_amount || 0) - (rep.transfer_goods || 0);
    const prices = costCatalogue([...costMap].map(([article, cost_price]) => ({article, cost_price})));
    const skuRows = skus.map((s) => {
      const cost = prices.get(articleKey(s.article))?.cost_price || 0;
      const totalCost = cost * s.bought_qty;
      return { ...s, cost_price: cost, total_cost: totalCost, profit: s.revenue - totalCost };
    }).sort((a, b) => b.bought_qty - a.bought_qty);

    // ABC-анализ по выручке (Парето): группа определяется накопленной
    // долей выручки ДО артикула (не включая его) — иначе один артикул,
    // дающий почти всю выручку, ошибочно попал бы в C вместо A.
    // A — до 80% накопленного итога, B — до 95%, C — остальное.
    const totalRevenue = skuRows.reduce((s, r) => s + Math.max(r.revenue, 0), 0);
    const abcByArticle = new Map();
    let cum = 0;
    [...skuRows].sort((a, b) => b.revenue - a.revenue).forEach((r) => {
      const cumBefore = totalRevenue > 0 ? cum / totalRevenue : 0;
      cum += Math.max(r.revenue, 0);
      abcByArticle.set(r.article, cumBefore < 0.8 ? "A" : cumBefore < 0.95 ? "B" : "C");
    });
    skuRows.forEach((r) => { r.abc = abcByArticle.get(r.article) || "C"; });

    const cogs = skuRows.reduce((sum, s) => sum + s.total_cost, 0);
    const ads = (rep.ads_spend || 0) + (rep.wb_media_spend || 0);
    const tax = (rep.sales_amount || 0) * ((taxRate || 0) / 100);
    const manualExpenses = (rep.operational_expenses || 0) + (rep.external_promotion_expenses || 0);
    const netProfit = (rep.transfer_total || 0) - ads - cogs - tax - manualExpenses;

    // Accruals describe sales, not every placed order (including unredeemed).
    const ordersSummary = report && rep.marketplace !== 'ozon'
      ? { amount: rep.orders_amount ?? null, qty: rep.orders_qty ?? null }
      : { amount: null, qty: null };
    return { rep, commission, skuRows, cogs, ads, tax, manualExpenses, netProfit, ordersSummary };
  }

  function assignAbc(rows) {
    const totalRevenue = rows.reduce((sum, row) => sum + Math.max(row.revenue || 0, 0), 0);
    let cumulative = 0;
    [...rows].sort((a, b) => (b.revenue || 0) - (a.revenue || 0)).forEach((row) => {
      const before = totalRevenue > 0 ? cumulative / totalRevenue : 0;
      cumulative += Math.max(row.revenue || 0, 0);
      row.abc = before < 0.8 ? "A" : before < 0.95 ? "B" : "C";
    });
  }

  // Display adapter only: private API results are never written to public reports.
  // Keep the server's kopeck-rounded profit, tax and advertising ratios authoritative.
  function fromApiCabinet(cabinet) {
    const c = cabinet || {}, f = c.finance || {}, e = c.economy || {}, s = c.sources || {};
    const n = value => value == null || value === '' ? null : Number(value);
    const rep = {
      sales_amount:n(f.retailAmount), orders_amount:n(s.orders?.amount), orders_qty:n(s.orders?.count), bought_qty:n(f.bought_qty),
      transfer_total:n(e.payout), transfer_goods:n(f.forPay),
      delivery_cost:n(f.deliveryService), storage_cost:n(f.paidStorage), fines:n(f.penalty), acceptance_ops:n(f.paidAcceptance),
      other_fees:n(f.deduction), damage_comp:0, return_comp:0,
      ads_spend:s.ads?.status === 'downloaded' ? n(e.internal_ads) : null, ads_promo_spend:s.ads?.status === 'downloaded' ? n(e.promo) : null, wb_media_spend:n(s.media?.amount),
      operational_expenses:n(c.settings?.operational_expenses), external_promotion_expenses:n(c.settings?.external_promotion_expenses),
    };
    const skuRows = (c.finance ? c.products || [] : []).map(p => {
      const quantity = n(p.bought_qty) || 0, cost = n(p.cost_price), revenue = n(p.revenue);
      const totalCost = quantity === 0 ? 0 : cost > 0 ? Math.round(quantity*cost*100)/100 : null;
      return {article:p.article,name:p.name,bought_qty:quantity,revenue,cost_price:cost,total_cost:totalCost,profit:revenue==null || totalCost==null ? null : Math.round((revenue-totalCost)*100)/100};
    }).sort((a,b)=>b.bought_qty-a.bought_qty);
    assignAbc(skuRows);
    const commission = rep.sales_amount == null || rep.transfer_goods == null ? null : Math.round((rep.sales_amount-rep.transfer_goods)*100)/100;
    const tax = n(e.tax), cogs = n(c.cogs);
    const expenses = [
      ['Комиссия Wildberries',commission],['Стоимость доставки',rep.delivery_cost],['Стоимость хранения',rep.storage_cost],
      ['Штрафы',rep.fines],['Операции при приёмке',rep.acceptance_ops],['Прочие удержания',rep.other_fees],
      ['Корректировка вознаграждения WB',n(f.additionalPayment)],['Баллы за отзывы и лояльность',n(f.cashbackAmount)],
      ['Комиссия лояльности',n(f.cashbackCommissionChange)],['Компенсация скидки лояльности',f.cashbackDiscount == null ? null : -n(f.cashbackDiscount)],
      ['Реклама уже в удержаниях',n(e.advertising_already_withheld)==null ? c.finance ? -(n(f.advertisingDeductions) || 0) : null : -n(e.advertising_already_withheld)],
      ['WB Продвижение',rep.ads_spend],['WB Media',rep.wb_media_spend],['Операционные расходы',rep.operational_expenses],
      ['Внешнее продвижение',rep.external_promotion_expenses],['Налог',tax],['Себестоимость товара',cogs],
    ];
    return {rep,commission,skuRows,cogs,tax,netProfit:n(c.net_profit),ads:e.advertising_total == null ? null : n(e.internal_ads)+n(s.media?.amount),
      manualExpenses:(rep.operational_expenses || 0)+(rep.external_promotion_expenses || 0),expenses,
      ordersSummary: s.orders?.status === 'downloaded' ? {amount:rep.orders_amount,qty:rep.orders_qty} : {amount:null,qty:null},
      rates:{drrOrders:e.drr_orders ?? null,drrSales:e.drr_sales ?? null},isApi:true,missing:e.missing || [],missingCosts:c.missing_costs || []};
  }

  function combineDerived(entries) {
    if (!entries.length) return computeDerived(null, [], new Map(), 0);
    const rep = {};
    let commission = 0, cogs = 0, ads = 0, tax = 0, manualExpenses = 0, netProfit = 0;
    const skuRows = [];
    entries.forEach(({ derived, shop }) => {
      Object.entries(derived.rep || {}).forEach(([key, value]) => {
        if (typeof value === "number") rep[key] = (rep[key] || 0) + value;
      });
      commission += derived.commission || 0;
      cogs += derived.cogs || 0;
      ads += derived.ads || 0;
      tax += derived.tax || 0;
      manualExpenses += derived.manualExpenses || 0;
      netProfit += derived.netProfit || 0;
      derived.skuRows.forEach((row) => skuRows.push(entries.length > 1 ? {
        ...row,
        article: `${shop.marketplace === "ozon" ? "Ozon" : "WB"} · ${row.article}`,
        name: `${row.name || row.article} · ${shop.name}`,
      } : { ...row }));
    });
    skuRows.sort((a, b) => b.bought_qty - a.bought_qty);
    assignAbc(skuRows);
    const ordersSummary = {};
    for (const field of ['amount', 'qty']) {
      const values = entries.map(({derived,shop}) => shop?.marketplace === 'ozon' ? null : derived.ordersSummary?.[field]);
      ordersSummary[field] = values.every(value => Number.isFinite(value)) ? values.reduce((sum,value) => sum+value,0) : null;
    }
    return { rep, commission, skuRows, cogs, ads, tax, manualExpenses, netProfit, ordersSummary,
      missing:[...new Set(entries.flatMap(({derived})=>derived.missing || []))],missingCosts:entries.flatMap(({derived})=>derived.missingCosts || []) };
  }

  function combineTrend(lists, ordersComplete = true) {
    const periods = new Map();
    lists.flat().forEach((row) => {
      const key = `${row.year}-${row.month}`;
      const current = periods.get(key) || { year: row.year, month: row.month };
      ["sales", "profit", "orders", "ads", "quantity", "transfer", "internalAds", "mediaAds", "promo"].forEach((field) => {
        current[field] = field === 'orders' && (!ordersComplete || row[field] == null || current[field] === null) ? null : (current[field] || 0) + (row[field] || 0);
      });
      periods.set(key, current);
    });
    return [...periods.values()].map((row) => ({
      ...row,
      drrOrders: row.orders > 0 ? row.ads / row.orders * 100 : null,
      drrSales: row.sales > 0 ? row.ads / row.sales * 100 : null,
    })).sort((a, b) => a.year - b.year || a.month - b.month).slice(-12);
  }

  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // prevD — тот же объект, что вернул computeDerived(), но для предыдущего
  // календарного месяца; null, если данных за него нет (тогда сравнение не рисуем).
  // opts.lowerIsBetter — цвет стрелки инвертирован (рост траты = красный);
  // opts.neutral — цвет всегда нейтральный (для чисто справочных величин).
  // Иконка при этом всегда показывает фактическое направление изменения.
  function renderDeltaChip(value, prevValue, unit, opts) {
    opts = opts || {};
    if (value == null || prevValue == null) return "";
    // Для долей сравниваем процентные пункты, а не рубли или относительный рост.
    const diff = unit === "%" ? Math.round((value - prevValue) * 10) / 10 : value - prevValue;
    const rawDir = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
    const icon = rawDir === "up" ? "icon-trend-up" : rawDir === "down" ? "icon-trend-down" : "icon-trend-flat";
    let colorDir = rawDir;
    if (rawDir !== "flat") {
      if (opts.neutral) colorDir = "flat";
      else if (opts.lowerIsBetter) colorDir = rawDir === "up" ? "down" : "up";
    }
    const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
    const absStr = unit === "%" ? fmtRate.format(Math.abs(diff)) : unit === "шт." ? fmtQty.format(Math.abs(Math.round(diff))) : fmtMoney.format(Math.abs(Math.round(diff)));
    const pct = prevValue !== 0 ? (Math.abs(diff) / Math.abs(prevValue)) * 100 : null;
    const pctStr = unit === "%" || pct == null ? "" : ` · ${pct.toFixed(1)}%`;
    return `
      <div class="kpi-delta kpi-delta--${colorDir}">
        <svg class="icon icon-sm"><use href="#${icon}"/></svg>
        <span>${sign}${absStr} ${unit === "%" ? "п.п." : unit}${pctStr}</span>
      </div>`;
  }

  function animateKpiNumber(element, fromValue, toValue, unit) {
    const format = unit === "%" ? fmtRate : unit === "шт." ? fmtQty : fmtMoney;
    const rounded = (value) => unit === "%" ? value : Math.round(value);
    const target = Number(toValue) || 0;
    const from = Number.isFinite(Number(fromValue)) ? Number(fromValue) : 0;
    element.textContent = format.format(rounded(target));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || from === target) return;

    const startedAt = performance.now();
    const duration = 1200;
    element.classList.add("is-counting");
    const frame = (now) => {
      if (!element.isConnected) return;
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      element.textContent = format.format(rounded(from + (target - from) * eased));
      if (progress < 1) requestAnimationFrame(frame);
      else {
        element.textContent = format.format(rounded(target));
        element.classList.remove("is-counting");
      }
    };
    requestAnimationFrame(frame);
  }

  function renderKPI(container, d, prevD, marketplace, interaction) {
    const secondary = container.id === 'kpiRow' ? document.getElementById?.('secondaryKpiRow') : null;
    const focusedMetric = container.contains?.(document.activeElement) || secondary?.contains?.(document.activeElement) ? document.activeElement?.dataset?.trendMetric : null;
    container.innerHTML = "";
    if (secondary) secondary.innerHTML = '';
    renderProfitability(d, prevD);
    const rates = d.rates || advertisingRatios(d.rep);
    const prevRates = prevD ? prevD.rates || advertisingRatios(prevD.rep) : null;
    const advertisingHint = marketplace === "ozon" ? "Продвижение Ozon + внешняя реклама" : "Внутренняя + медийная + внешняя реклама";
    const cards = [
      { metric: "sales", label: "Сумма продаж", value: d.rep.sales_amount, prev: prevD ? prevD.rep.sales_amount : null, unit: "₽", className: " kpi--summary" },
      { metric: "quantity", label: "Выкупили", value: d.rep.bought_qty, prev: prevD ? prevD.rep.bought_qty : null, unit: "шт.", className: " kpi--summary" },
      { metric: "transfer", label: marketplace === "all" ? "К выплате после удержаний" : marketplace === "ozon" ? "К выплате после удержаний (Ozon)" : "Итого к перечислению (WB)", value: d.rep.transfer_total, prev: prevD ? prevD.rep.transfer_total : null, unit: "₽", className: " kpi--summary" },
      { metric: "profit", label: "Чистая прибыль", value: d.netProfit, prev: prevD ? prevD.netProfit : null, unit: "₽", hero: true },
      {
        metric: "internalAds",
        label: marketplace === "ozon" ? "Продвижение Ozon" : "Внутренняя реклама",
        value: d.isApi ? d.rep.ads_spend : d.rep.ads_spend || 0,
        prev: prevD ? prevD.isApi ? prevD.rep.ads_spend : prevD.rep.ads_spend || 0 : null,
        unit: "₽", lowerIsBetter: true,
        className: marketplace === "ozon" ? " kpi--advertising-wide" : " kpi--advertising",
      },
      {
        metric: "mediaAds",
        label: "Медийная реклама",
        value: d.isApi ? d.rep.wb_media_spend : d.rep.wb_media_spend || 0,
        prev: prevD ? prevD.isApi ? prevD.rep.wb_media_spend : prevD.rep.wb_media_spend || 0 : null,
        unit: "₽", lowerIsBetter: true, hideForOzon: true, className: " kpi--advertising",
      },
      { metric: "drrOrders", label: "ДРР (заказа)", value: rates.drrOrders, prev: prevRates ? prevRates.drrOrders : null,
        unit: "%", lowerIsBetter: true, className: " kpi--rate kpi--rate-first",
        extra: `<div class="kpi-extra">${advertisingHint}<br>от суммы заказов</div>` },
      { metric: "drrSales", label: "ДРР (выкупа)", value: rates.drrSales, prev: prevRates ? prevRates.drrSales : null,
        unit: "%", lowerIsBetter: true, className: " kpi--rate",
        extra: `<div class="kpi-extra">${advertisingHint}<br>от суммы продаж</div>` },
      { metric: "promo", label: "Промобонусы", value: d.rep.ads_promo_spend, prev: prevD ? prevD.rep.ads_promo_spend : null, unit: "₽", neutral: true, hideWhenZero: true },
    ];
    const visibleCards = cards.filter((c) => (!c.hideWhenZero || Math.abs(c.value || 0) > 0.005) && !(c.hideForOzon && marketplace === "ozon"));
    const interactive = interaction && typeof interaction.onSelect === "function";
    const activeMetric = interaction?.activeMetric === 'profitability' || visibleCards.some((c) => c.metric === (interaction && interaction.activeMetric)) ? interaction.activeMetric : "sales";
    visibleCards.forEach((c, index) => {
      const unavailable = c.metric === 'profit' ? window.WBProfitNotice?.describe(d) : null;
      const heroClass = c.hero ? " kpi--hero" : "";
      const negClass = c.hero && c.value < 0 ? " neg" : "";
      const valStr = c.value == null ? "—" : c.unit === "%" ? fmtRate.format(c.value) : c.unit === "шт." ? fmtQty.format(Math.round(c.value)) : fmtMoney.format(Math.round(c.value));
      const tag = interactive ? "button" : "div";
      const block = interactive ? "span" : "div";
      const asContent = (html) => interactive ? html.replace(/<div\b/g, "<span").replace(/<\/div>/g, "</span>") : html;
      const card = el(`
        <${tag} class="kpi${heroClass}${c.className || ""}${interactive ? " kpi--interactive" + (c.metric === activeMetric ? " is-selected" : "") : ""}"
          ${interactive ? `title="Показать на графике: ${escapeHtml(c.label)}"` : ""}
          ${interactive ? `type="button" data-trend-metric="${c.metric}" aria-pressed="${c.metric === activeMetric}" aria-controls="trendChart"` : ""}>
          <${block} class="kpi-label">${escapeHtml(c.label)}</${block}>
          <${block} class="kpi-reading"><${block} class="kpi-value${negClass}"><span class="kpi-number">${valStr}</span> <span class="kpi-unit">${c.value == null ? "" : c.unit}</span></${block}></${block}>
          <${block} class="kpi-comparison"><${block} class="kpi-comparison-copy">${asContent(renderDeltaChip(c.value, c.prev, c.unit, { lowerIsBetter: c.lowerIsBetter, neutral: c.neutral }))}<span class="kpi-comparison-label">${unavailable ? escapeHtml(unavailable.short) : c.value != null && c.prev != null ? escapeHtml(interaction?.comparisonLabel || 'к предыдущему месяцу') : 'Нет данных для сравнения'}</span></${block}><span class="kpi-mini" data-kpi-mini="${c.metric}" aria-hidden="true"></span></${block}>
          ${asContent(c.extra || "")}
          ${interactive ? '<span class="kpi-action"><span>Смотреть динамику</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg></span>' : ''}
        </${tag}>
      `);
      if (interactive) card.addEventListener("click", () => interaction.onSelect(c.metric));
      (secondary && index >= 4 ? secondary : container).appendChild(card);
      if (focusedMetric === c.metric) card.focus?.({preventScroll:true});
      if (c.value != null) animateKpiNumber(card.querySelector(".kpi-number"), c.prev == null ? 0 : c.prev, c.value, c.unit);
    });
    return activeMetric;
  }

  function profitMargin(derived) {
    const sales = derived?.rep?.sales_amount, profit = derived?.netProfit;
    return typeof sales === 'number' && Number.isFinite(sales) && sales > 0 && typeof profit === 'number' && Number.isFinite(profit) ? profit / sales * 100 : null;
  }
  // Derive rates from the same loaded profit and sales for API, files and
  // combined marketplaces; never turn an unavailable profit into zero.
  function trendMetricValue(row, metric) {
    const numeric = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) ? Number(value) : null;
    return metric === 'profitability'
      ? profitMargin({ netProfit: numeric(row?.profit), rep: { sales_amount: numeric(row?.sales) } })
      : numeric(row?.[metric]);
  }
  function renderProfitability(derived, previous) {
    const output = document.getElementById?.('profitabilityValue');
    if (!output) return;
    const margin = profitMargin(derived), before = profitMargin(previous);
    output.textContent = margin == null ? '—' : fmtRate.format(margin);
    const arc = document.getElementById('profitabilityArc'), marker = document.getElementById('profitabilityMarker');
    const drawn = Math.max(0, Math.min(100, margin || 0));
    arc.style.strokeDashoffset = String(100 - drawn);
    const angle = Math.PI - drawn / 100 * Math.PI;
    marker.setAttribute('cx',String(160+120*Math.cos(angle))); marker.setAttribute('cy',String(154-120*Math.sin(angle)));
    marker.setAttribute('visibility', margin == null ? 'hidden' : 'visible');
    document.querySelectorAll?.('[data-gauge-tick]').forEach(tick=>tick.classList.toggle('is-filled',Number(tick.dataset.gaugeTick)<=drawn/100*40));
    document.getElementById('profitabilityGauge').setAttribute('aria-label', margin == null ? 'Рентабельность: недостаточно данных' : `Рентабельность: ${fmtRate.format(margin)}% чистой прибыли от продаж`);
    document.getElementById('profitabilityCaption').textContent = margin == null ? 'Заполните недостающие данные' : margin < 0 ? 'Магазин работает в убыток' : 'Прибыль на каждый рубль продаж';
    document.getElementById('profitabilityNote').textContent = margin == null ? 'Для расчёта нужны продажи и чистая прибыль.' : `${fmtRate.format(margin)} коп. чистой прибыли с 1 ₽ продаж.`;
    const delta = document.getElementById('profitabilityDelta');
    delta.textContent = margin == null || before == null ? '' : `${margin >= before ? '+' : '−'}${fmtRate.format(Math.abs(margin-before))} п.п.`;
    delta.classList.toggle('is-negative', margin != null && before != null && margin < before);
  }

  // Actual loaded months only. Nulls split the line; no invented sparkline data.
  function kpiSparkline(rows, metric) {
    const values = rows.slice(-12).map(row => {
      const value = row[metric];
      return !['number', 'string'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
    });
    const valid = values.filter(value => value != null);
    if (valid.length < 2) return '';
    if (['quantity', 'transfer', 'internalAds', 'mediaAds', 'promo'].includes(metric)) {
      const low = Math.min(0, ...valid), high = Math.max(0, ...valid), extent = high - low || 1;
      const zero = 36 - (0 - low) / extent * 28, step = 72 / values.length;
      const bars = values.map((value, i) => {
        if (value == null) return '';
        const y = 36 - (value - low) / extent * 28;
        return `<rect x="${(4 + i * step).toFixed(2)}" y="${Math.min(y, zero).toFixed(2)}" width="${Math.max(2, step - 2).toFixed(2)}" height="${Math.max(1, Math.abs(y - zero)).toFixed(2)}" rx="1.2" opacity="${i === values.length - 1 ? 1 : .28 + i / values.length * .45}"/>`;
      }).join('');
      return `<svg class="kpi-mini-bars" viewBox="0 0 80 44" aria-hidden="true">${bars}</svg>`;
    }
    const min = Math.min(...valid), max = Math.max(...valid), range = max - min || 1;
    let path = '', connected = false;
    values.forEach((value, i) => {
      if (value == null) { connected = false; return; }
      const x = 4 + i / Math.max(1, values.length - 1) * 72, y = max === min ? 22 : 36 - (value - min) / range * 28;
      path += `${connected ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)} `; connected = true;
    });
    return `<svg viewBox="0 0 80 44" fill="none" aria-hidden="true"><path class="kpi-mini-line" d="${path}" pathLength="100"/></svg>`;
  }
  function renderKpiSparklines(container, rows) {
    container?.querySelectorAll?.('[data-kpi-mini]').forEach(node => {
      node.innerHTML = kpiSparkline(rows, node.dataset.kpiMini);
      node.hidden = !node.innerHTML;
    });
  }

  function expenseItems(d, marketplace) {
    if (d.expenses) return d.expenses;
    return [
      [marketplace === "all" ? "Комиссии маркетплейсов" : marketplace === "ozon" ? "Комиссия Ozon" : "Комиссия Wildberries", d.commission],
      ["Стоимость доставки", d.rep.delivery_cost],
      ["Стоимость хранения", d.rep.storage_cost],
      ["Штрафы", d.rep.fines],
      ["Операции при приёмке", d.rep.acceptance_ops],
      ["Компенсация ущерба", d.rep.damage_comp],
      ["Добровольная компенсация", d.rep.return_comp],
      ["Прочие доплаты", d.rep.other_fees],
      [marketplace === "ozon" ? "Продвижение Ozon" : marketplace === "all" ? "Продвижение внутри площадок" : "WB Продвижение", d.rep.ads_spend || 0],
      ["WB Media", d.rep.wb_media_spend || 0],
      ["Операционные расходы", d.rep.operational_expenses || 0],
      ["Внешнее продвижение", d.rep.external_promotion_expenses || 0],
      ["Налог", d.tax],
      ["Себестоимость товара", d.cogs],
    ];
  }

  function renderExpenseDelta(value, prevValue, className) {
    if (prevValue == null) return "";
    const diff = value - prevValue;
    const rawDir = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
    const colorDir = rawDir === "up" ? "down" : rawDir === "down" ? "up" : "flat";
    const icon = rawDir === "up" ? "icon-trend-up" : rawDir === "down" ? "icon-trend-down" : "icon-trend-flat";
    const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
    const pct = prevValue !== 0 ? `${fmtCompact.format(Math.abs(diff) / Math.abs(prevValue) * 100)}%` : diff === 0 ? "0%" : "ранее 0 ₽";
    return `<span class="expense-delta expense-delta--${colorDir}${className ? ` ${className}` : ""}">
      <svg class="icon icon-sm" aria-hidden="true"><use href="#${icon}"/></svg>
      <span>${sign}${fmtMoney.format(Math.abs(Math.round(diff)))} ₽ · ${pct}</span>
    </span>`;
  }

  function renderExpenses(listEl, totalEl, canvas, d, marketplace, prevD) {
    const paletteForTheme = () => document.documentElement?.dataset.theme === 'dark'
      ? ["#7088f0", "#b1bdf5", "#5cc0a6", "#b39bd6", "#e4bd75", "#f08c78", "#a3b2e4", "#79bdc7", "#d4b68d", "#d3a0bf", "#b2bad3", "#bfabe0", "#65caca"]
      : ["#2a45cc", "#93a3ec", "#3f9c86", "#7a5aa6", "#c98a1e", "#c86e5d", "#7587bf", "#4f94a0", "#ac8e68", "#b06f91", "#8e94a9", "#9781bf", "#00a6a6"];
    const palette = paletteForTheme();
    const items = expenseItems(d, marketplace);
    const prevItems = prevD ? new Map(expenseItems(prevD, marketplace)) : null;
    const chartTotal = items.reduce((s,it)=>s+Math.abs(it[1] || 0),0);
    const total = d.isApi ? items.some(([,value])=>value==null) ? null : items.reduce((sum,[,value])=>sum+value,0) : chartTotal;
    const prevTotal = prevItems ? prevD.isApi ? [...prevItems.values()].some(value=>value==null) ? null : [...prevItems.values()].reduce((sum,value)=>sum+value,0) : [...prevItems.values()].reduce((sum,value)=>sum+Math.abs(value),0) : null;
    const visibleItems = items.map(([label, value]) => ({ label, value }))
      .filter((item) => Math.abs(item.value) > 0.005)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .map((item, index) => ({ ...item, color: palette[index % palette.length] }));
    // Each row has its own segment: corrections keep their signed amounts in
    // the legend; the ring compares magnitudes, never a second expense total.
    const chartItems = visibleItems;
    const unknownItems = items.filter(([,value]) => value == null);
    const salesShare = total != null && (d.rep.sales_amount || 0) > 0 ? (total / d.rep.sales_amount) * 100 : null;
    const totalText = total == null ? '—' : `${fmtMoney.format(Math.round(total))} ₽`;

    const heroTotal = document.getElementById("expHeroTotal");
    const shareEl = document.getElementById("expSalesShare");
    const centerValue = document.getElementById("expCenterValue");
    const centerLabel = document.getElementById("expCenterLabel");
    if (heroTotal) heroTotal.textContent = totalText;
    if (shareEl) shareEl.textContent = salesShare == null ? "—" : `${salesShare.toFixed(1).replace('.', ',')}%`;
    const heroDelta = document.getElementById("expHeroDelta");
    const comparison = window.WBRange?.active ? 'к предыдущему периоду' : 'к прошлому месяцу';
    if (heroDelta) heroDelta.innerHTML = total == null || prevTotal == null ? '' : `<span class="exp-comparison-label">${comparison}</span>${renderExpenseDelta(total, prevTotal, "expense-delta--summary")}`;

    listEl.innerHTML = visibleItems.map(({ label, value, color }, index) => {
      const pct = chartTotal > 0 ? Math.abs(value / chartTotal) * 100 : 0;
      const prior = prevItems ? prevItems.has(label) ? prevItems.get(label) : 0 : null;
      return `
        <div role="listitem">
          <button type="button" class="exp-row" data-expense-index="${index}" aria-label="${escapeHtml(label)}: ${fmtMoney.format(Math.round(value))} ₽; ${pct.toFixed(1)}% ${unknownItems.length ? 'от известных сумм по модулю' : 'от суммы статей по модулю'}" aria-pressed="false">
            <span class="exp-name"><i style="--expense-color:${color}"></i><span>${escapeHtml(label)}</span></span>
            <strong class="exp-pct">${pct > 0 && pct < .1 ? '&lt;0,1' : fmtCompact.format(pct)}%</strong>
            <span class="exp-meta"><strong>${fmtMoney.format(Math.round(value))} ₽</strong>${renderExpenseDelta(value, prior)}</span>
          </button>
        </div>`;
    }).join("") + unknownItems.map(([label]) => `<div role="listitem" class="exp-row exp-row--unknown"><span class="exp-name"><i></i><span>${escapeHtml(label)}</span></span><span class="exp-meta"><strong>—</strong><span>Нет данных</span></span></div>`).join('');
    if (!visibleItems.length && !unknownItems.length) listEl.innerHTML = `<div class="analytics-empty">Расходов за этот период пока нет</div>`;
    totalEl.textContent = totalText;

    const shareBasis = unknownItems.length ? 'Доли известных статей по модулю' : 'Доли статей по модулю';
    const basisEl = document.getElementById('expBasis');
    if (basisEl) { basisEl.hidden = !unknownItems.length && !visibleItems.some(item=>item.value<0); basisEl.textContent = unknownItems.length ? 'Доли известных сумм' : 'Доли по модулю'; basisEl.title = 'На кольце сравниваются абсолютные значения статей. Возвраты и компенсации уменьшают итог из API и показаны в списке со знаком минус.'; }
    canvas.setAttribute('aria-label', `Структура расходов. ${shareBasis}: сумма абсолютных значений ${fmtMoney.format(Math.round(chartTotal))} ₽. Возвраты и компенсации показаны со знаком минус в списке. Выберите статью в списке, чтобы увидеть её долю.`);
    if (window.WBExpenseTraffic) {
      if (charts.pie) { charts.pie.destroy(); charts.pie = null; }
      if (window.WBExpenseTraffic.render({ canvas, listEl, items:chartItems, chartTotal, total, totalText, unknownItems, centerValue, centerLabel, paletteForTheme })) return;
    }

    if (charts.pie) charts.pie.destroy();
    let activeIndex = -1;
    let pie;
    let interacted = false;
    const buttons = [...listEl.querySelectorAll('[data-expense-index]')];
    const selectExpense = (index) => {
      if (activeIndex === index) return;
      activeIndex = index;
      const item = chartItems[index];
      if (centerValue) centerValue.textContent = item ? `${(Math.abs(item.value) / chartTotal * 100).toFixed(1).replace('.', ',')}%` : '—';
      if (centerLabel) { centerLabel.textContent = item ? item.label : unknownItems.length ? 'нет данных' : 'нет расходов'; centerLabel.title = centerLabel.textContent; }
      buttons.forEach((button,i) => button.setAttribute('aria-pressed', String(i === index)));
      if (!pie) return;
      interacted = true;
      pie.data.datasets[0].backgroundColor = chartItems.map((row,i) => i === index ? row.color : `${row.color}80`);
      pie.setActiveElements(item ? [{ datasetIndex: 0, index }] : []);
      pie.update('active');
    };
    const rowIndex = event => { const row = event.target.closest?.('[data-expense-index]'); return row && listEl.contains(row) ? Number(row.dataset.expenseIndex) : null; };
    listEl.onpointerover = listEl.onfocusin = listEl.onclick = event => { const index = rowIndex(event); if (index != null) selectExpense(index); };
    const resetExpense = () => { const focused = buttons.indexOf(document.activeElement); selectExpense(focused >= 0 ? focused : chartItems.length ? 0 : -2); };
    listEl.onpointerleave = resetExpense;
    listEl.onfocusout = event => { if (!listEl.contains(event.relatedTarget)) selectExpense(chartItems.length ? 0 : -2); };
    listEl.onkeydown = event => {
      if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
      const index = rowIndex(event); if (index == null) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length-1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    };
    canvas.onpointerleave = resetExpense;
    selectExpense(chartItems.length ? 0 : -2);
    pie = charts.pie = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: chartItems.map((i) => i.label),
        datasets: [{
          data: chartItems.length ? chartItems.map((i) => Math.abs(i.value)) : [1],
          backgroundColor: chartItems.length ? chartItems.map((i) => i.color) : [getComputedStyle(document.body).getPropertyValue('--surface-2').trim() || '#eeeef1'],
          borderColor: getComputedStyle(document.body).getPropertyValue('--surface').trim() || '#ffffff',
          borderWidth: 2,
          hoverBorderWidth: 2,
          spacing: 0,
          hoverOffset: 2,
          borderRadius: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 1200, easing: "easeOutCubic" },
        transitions: { active: { animation: { duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 280, easing: 'easeOutCubic' } } },
        onHover: (_event, elements) => { if (elements.length && chartItems[elements[0].index]) selectExpense(elements[0].index); },
        onClick: (_event, elements) => { const index=elements[0]?.index; if (index != null) { selectExpense(index); buttons[index]?.focus(); } },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: !!chartItems.length, callbacks: { label: (ctx) => ` ${ctx.label}: ${fmtMoney.format(chartItems[ctx.dataIndex].value)} ₽ · ${chartTotal > 0 ? ((ctx.parsed / chartTotal) * 100).toFixed(1) : 0}% по модулю` } },
        },
        cutout: "72%",
        radius: "91%",
      },
    });
    // Appearance-only repaint: preserve the selected category without fetching
    // or recalculating any financial data when the user changes theme.
    pie.sellerExpenseTheme = () => {
      const colors = paletteForTheme();
      chartItems.forEach((item,i) => {
        item.color = colors[i % colors.length];
        buttons[i]?.querySelector?.('i')?.style.setProperty('--expense-color',item.color);
      });
      pie.data.datasets[0].backgroundColor = chartItems.length
        ? chartItems.map((item,i)=>!interacted || i===activeIndex ? item.color : `${item.color}80`)
        : [getComputedStyle(document.body).getPropertyValue('--surface-2').trim()];
    };
  }

  function trendBarColors(canvas, rows, color) {
    const context = canvas.getContext?.('2d');
    let inactive = `${color}35`;
    if (context?.createPattern) {
      const tile = document.createElement('canvas'); tile.width = tile.height = 8;
      const pen = tile.getContext?.('2d');
      if (pen) { pen.fillStyle=`${color}0d`;pen.fillRect(0,0,8,8);pen.strokeStyle=`${color}45`;pen.lineWidth=1.2;pen.beginPath();pen.moveTo(-2,6);pen.lineTo(6,-2);pen.moveTo(2,10);pen.lineTo(10,2);pen.stroke();inactive=context.createPattern(tile,'repeat') || inactive; }
    }
    const selected = document.getElementById?.('periodSelect')?.value;
    const match = rows.findIndex(row=>`${row.year}-${row.month}`===selected);
    const active = match >= 0 ? match : rows.length - 1;
    const range = new Set(window.WBRange?.selectedMonths?.() || []);
    return rows.map((row,i)=>window.WBTrend ? inactive : (range.size ? range.has(`${row.year}-${row.month}`) : i===active)?color:inactive);
  }
  function renderTrend(canvas, rows, metricKey, marketplace) {
    renderKpiSparklines(document.getElementById?.('kpiRow'), rows);
    renderKpiSparklines(document.getElementById?.('secondaryKpiRow'), rows);
    metricKey = TREND_METRICS[metricKey] ? metricKey : "sales";
    const metric = getTrendMetric(metricKey, marketplace);
    const inkMute = getComputedStyle(document.body).getPropertyValue("--ink-mute").trim();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const values = rows.map(row => trendMetricValue(row, metricKey));
    const singlePoint = values.length === 1 && values[0] != null;
    const formatValue = (value, compact) => {
      if (value == null) return "нет данных";
      if (metric.unit === "%") return `${fmtRate.format(value)}%`;
      if (metric.unit === "шт.") return `${fmtQty.format(Math.round(value))} шт.`;
      if (compact && Math.abs(value) >= 1000000) return `${fmtCompact.format(value / 1000000)} млн ₽`;
      if (compact && Math.abs(value) >= 1000) return `${fmtCompact.format(value / 1000)} тыс. ₽`;
      return `${fmtMoney.format(Math.round(value))} ₽`;
    };
    const periodDescription=window.WBRange?.active ? window.WBRange.label(rows) || 'выбранный диапазон' : 'последние 12 месяцев';
    canvas.setAttribute("aria-label", `${metric.label}: динамика за ${periodDescription}`);
    const config = {
      type: window.WBShell?.chartStyle === 'bar' ? 'bar' : 'line',
      plugins: window.WBTrend ? [window.WBTrend.plugin] : [],
      data: {
        labels: rows.map((r) => `${MONTH_NAMES[r.month].slice(0, 3)} ${String(r.year).slice(-2)}`),
        datasets: [{
          label: metric.label, data: values, sellerMetric: metricKey,
          borderColor: metric.color, backgroundColor: window.WBShell?.chartStyle === 'bar' ? trendBarColors(canvas,rows,metric.color) : `${metric.color}14`,
          sellerRows: rows, sellerMarketplace: marketplace,
          borderWidth: window.WBShell?.chartStyle === 'bar' ? 0 : 2.5,
          pointRadius: singlePoint ? 5 : values.map((value, index) => value != null
            && values[index - 1] == null && values[index + 1] == null ? 4 : 0),
          pointStyle: 'circle', pointBorderWidth: 2, pointBorderColor: metric.color,
          pointBackgroundColor: metric.color,
          pointHoverRadius: 5, pointHitRadius: 14, tension: .38,
          fill: true, spanGaps: false, borderRadius:window.WBTrend?99:7, borderSkipped:false, maxBarThickness:30, barPercentage:.66, categoryPercentage:1,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        events: window.WBTrend ? [] : ['mousemove','mouseout','click','touchstart','touchmove'],
        animation: reduceMotion ? false : { duration: 1200, easing: "easeOutCubic", delay: ctx => ctx.type === 'data' && ctx.mode === 'default' ? Math.min(ctx.dataIndex * 35, 385) : 0 },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: !window.WBTrend,
            backgroundColor: "rgba(29,29,31,.94)",
            padding: 12,
            cornerRadius: 10,
            displayColors: true,
            callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${formatValue(ctx.parsed.y, false)}` },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: window.WBTrend ? 'transparent' : inkMute, maxRotation: 0 } },
          y: {
            beginAtZero: window.WBShell?.chartStyle === 'bar' || metric.unit === "шт.",
            grid: { color: "rgba(127,127,127,.12)", tickLength:0 },
            border: { display: false, dash: [3,3] },
            ticks: {
              color: inkMute,
              precision: metric.unit === "шт." ? 0 : undefined,
              callback: (v) => formatValue(v, true),
            },
          },
        },
      },
    };
    const trendChart = charts.trends.get(canvas);
    if (trendChart) {
      if(trendChart.config)trendChart.config.type = config.type;
      trendChart.data = config.data;
      trendChart.options = config.options;
      trendChart.update(reduceMotion ? "none" : undefined);
    } else {
      charts.trends.set(canvas, new Chart(canvas, config));
    }
  }

  const ABC_TITLE = {
    A: "Группа A — вносит вклад в первые 80% выручки",
    B: "Группа B — вносит вклад в следующие 80–95% выручки",
    C: "Группа C — оставшиеся ~5% выручки",
  };

  function renderSkuDelta(value, prevValue, unit) {
    if (prevValue == null) return "";
    const diff = value - prevValue;
    const dir = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
    const icon = dir === "up" ? "icon-trend-up" : dir === "down" ? "icon-trend-down" : "icon-trend-flat";
    const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
    const exact = unit === "шт." ? fmtQty.format(Math.abs(Math.round(diff))) : fmtMoney.format(Math.abs(Math.round(diff)));
    const absolute = fmtShort.format(Math.abs(Math.round(diff)));
    const pct = prevValue !== 0 ? `${fmtCompact.format(Math.abs(diff) / Math.abs(prevValue) * 100)}%` : diff === 0 ? "0%" : "новое";
    return `<span class="sku-delta sku-delta--${dir}" title="${sign}${exact} ${unit} · ${pct}" aria-label="Изменение: ${sign}${exact} ${unit}, ${pct}">
      <svg class="icon" aria-hidden="true"><use href="#${icon}"/></svg>
      <span class="sku-delta-copy"><span>${sign}${absolute}</span><span>${pct}</span></span>
    </span>`;
  }

  function renderSkuTable(tbody, tfoot, hint, canvas, d, prevD) {
    const productCard = tbody.closest?.('.sku-card');
    if (productCard) productCard.classList.add('is-products');
    const counts = { A: 0, B: 0, C: 0 };
    const prevRows = prevD ? new Map(prevD.skuRows.map((row) => [articleKey(row.article), row])) : null;
    d.skuRows.forEach((s) => { counts[s.abc] = (counts[s.abc] || 0) + 1; });
    const search = document.getElementById("skuSearch");
    const sort = document.getElementById("skuSort");
    const filters = document.getElementById("skuAbcFilters");
    if (search) {
      search.value = skuView.query;
      search.oninput = () => { skuView.query = search.value; renderSkuTable(tbody, tfoot, hint, canvas, d, prevD); };
    }
    if (sort) {
      sort.value = skuView.sort;
      sort.onchange = () => { skuView.sort = sort.value; renderSkuTable(tbody, tfoot, hint, canvas, d, prevD); };
    }
    if (filters) {
      filters.querySelectorAll("[data-abc]").forEach((button) => {
        const active = button.dataset.abc === skuView.abc;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
        button.onclick = () => { skuView.abc = button.dataset.abc; renderSkuTable(tbody, tfoot, hint, canvas, d, prevD); };
      });
    }

    const query = skuView.query.trim().toLowerCase();
    const rows = d.skuRows.filter((row) => {
      const matchesAbc = skuView.abc === "all" || row.abc === skuView.abc;
      const matchesQuery = !query || `${row.article} ${row.name || ""}`.toLowerCase().includes(query);
      return matchesAbc && matchesQuery;
    }).sort((a, b) => {
      if (skuView.sort === "revenue") return b.revenue - a.revenue;
      if (skuView.sort === "profit") return b.profit - a.profit;
      return b.bought_qty - a.bought_qty;
    });

    hint.textContent = d.skuRows.length
      ? `${rows.length === d.skuRows.length ? d.skuRows.length : `${rows.length} из ${d.skuRows.length}`} ${pluralArt(d.skuRows.length)} · A ${counts.A} · B ${counts.B} · C ${counts.C}`
      : "";
    const hasCost = d.skuRows.some((s) => s.cost_price > 0);

    if (!rows.length) {
      const message = d.skuRows.length ? "По выбранному фильтру товары не найдены" : "Нет данных по артикулам за выбранный период";
      tbody.innerHTML = `<tr><td colspan="${productCard ? 7 : 5}" class="empty">${message}</td></tr>`;
      tfoot.innerHTML = "";
    } else {
      const maxQty = Math.max(...rows.map((s) => s.bought_qty), 1);
      const maxRevenue = rows.reduce((max,row)=>row.revenue == null ? max : Math.max(max,Number(row.revenue)||0),0);
      tbody.innerHTML = rows.map((s, index) => {
        const qtyPct = Math.max(3, Math.round((s.bought_qty / maxQty) * 100));
        const profitClass = s.profit >= 0 ? "profit-pos" : "profit-neg";
        const costCell = s.total_cost == null ? `<span class="cost-warn">не заполнено</span>` : hasCost || s.cost_price > 0
          ? fmtMoney.format(Math.round(s.total_cost))
          : `<span class="cost-warn">не заполнено</span>`;
        const abcBadge = `<span class="abc-badge abc-badge--${s.abc}" title="${ABC_TITLE[s.abc]}">${s.abc}</span>`;
        const prev = prevRows ? prevRows.get(articleKey(s.article)) : null;
        const newBadge = prevRows && !prev ? `<span class="sku-new">Новый</span>` : "";
        const initials = String(s.name || s.article || '').trim().split(/\s+/).slice(0,2).map(word=>Array.from(word)[0] || '').join('').toLocaleUpperCase('ru-RU');
        const hue = Array.from(articleKey(s.article)).reduce((hash,char)=>(hash*31+char.codePointAt(0))%360,0);
        const share = s.revenue == null || maxRevenue <= 0 ? 0 : Math.max(0,Number(s.revenue)/maxRevenue);
        const identity = productCard
          ? `<div class="sku-product"><span class="sku-thumb" style="--sku-hue:${hue}" aria-hidden="true">${escapeHtml(initials)}</span><div class="sku-identity"><span class="sku-name">${escapeHtml(s.name || s.article)}</span><span class="sku-subline">${abcBadge}${newBadge}<span class="sku-art">${escapeHtml(s.article)}</span></span></div></div>`
          : `${abcBadge}${newBadge}<span class="sku-name">${escapeHtml(s.name || s.article)}</span><span class="sku-art">${escapeHtml(s.article)}</span>`;
        return `
          <tr style="--row-index:${Math.min(index, 12)}">
            ${productCard ? `<td class="sku-rank">${index+1}</td>` : ''}
            <td class="sku-product-cell">${identity}</td>
            <td class="num sku-units" data-label="Выкупили, шт."><div class="sku-metric"><div class="qty-cell">${productCard ? '' : `<div class="qty-track" aria-hidden="true"><div class="qty-fill" style="width:${qtyPct}%"></div></div>`}<span class="qty-num">${s.bought_qty == null ? '—' : fmtQty.format(s.bought_qty)}</span></div>${prev && s.bought_qty != null ? renderSkuDelta(s.bought_qty, prev.bought_qty, "шт.") : ""}</div></td>
            <td class="num mono" data-label="Выручка, ₽"><div class="sku-metric"><strong>${s.revenue == null ? '—' : fmtMoney.format(Math.round(s.revenue))}</strong>${prev && s.revenue != null ? renderSkuDelta(s.revenue, prev.revenue, "₽") : ""}</div></td>
            <td class="num mono sku-detail" data-label="Себестоимость, ₽">${costCell}</td>
            <td class="num sku-detail ${profitClass}" data-label="Валовая прибыль, ₽"><div class="sku-metric"><strong>${s.profit == null ? '—' : fmtMoney.format(Math.round(s.profit))}</strong>${prev && s.profit != null ? renderSkuDelta(s.profit, prev.profit, "₽") : ""}</div></td>
            ${productCard ? `<td class="sku-revenue-bar" title="${s.revenue == null ? 'Нет данных по выручке' : s.revenue < 0 ? 'Отрицательная выручка' : `${share > 0 && share < .001 ? 'менее 0,1' : fmtCompact.format(share*100)}% от максимальной выручки товара`}"><span class="sku-sales-track" aria-hidden="true"><span class="sku-sales-fill" style="--sku-share:${share}"></span></span></td>` : ''}
          </tr>`;
      }).join("");

      const tot = rows.reduce((a, s) => ({
        qty: a.qty + s.bought_qty, rev: a.rev == null || s.revenue == null ? null : a.rev + s.revenue, cost: a.cost == null || s.total_cost == null ? null : a.cost + s.total_cost, profit: a.profit == null || s.profit == null ? null : a.profit + s.profit,
      }), { qty: 0, rev: 0, cost: 0, profit: 0 });
      tfoot.innerHTML = `
        <tr>
          ${productCard ? '<td class="sku-rank"></td>' : ''}
          <td>Итого</td>
          <td class="num mono" data-label="Выкупили, шт.">${fmtQty.format(tot.qty)}</td>
          <td class="num mono" data-label="Выручка, ₽">${tot.rev == null ? '—' : fmtMoney.format(Math.round(tot.rev))}</td>
          <td class="num mono sku-detail" data-label="Себестоимость, ₽">${tot.cost == null ? '—' : fmtMoney.format(Math.round(tot.cost))}</td>
          <td class="num mono sku-detail" data-label="Валовая прибыль, ₽">${tot.profit == null ? '—' : fmtMoney.format(Math.round(tot.profit))}</td>
          ${productCard ? '<td class="sku-revenue-bar"></td>' : ''}
        </tr>`;
    }

    if (charts.bar) charts.bar.destroy();
    if (productCard) {
      charts.bar = null;
      const oldChart = canvas.closest?.('.skubar');
      if (oldChart) oldChart.hidden = true;
      window.WBSkuProducts?.enhance(productCard);
      return;
    }
    const top = rows.slice(0, 10);
    const abcColors = {
      A: getComputedStyle(document.body).getPropertyValue("--good").trim(),
      B: getComputedStyle(document.body).getPropertyValue("--accent").trim(),
      C: getComputedStyle(document.body).getPropertyValue("--ink-mute").trim(),
    };
    charts.bar = new Chart(canvas, {
      type: "bar",
      data: {
        labels: top.map((s) => s.article),
        datasets: [{
          data: top.map((s) => s.bought_qty),
          backgroundColor: top.map((s) => abcColors[s.abc] || abcColors.C),
          borderRadius: 4, maxBarThickness: 34,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 900, easing: "easeOutCubic", delay: ctx => ctx.type === 'data' && ctx.mode === 'default' ? Math.min(ctx.dataIndex * 50, 350) : 0 },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ` ${fmtQty.format(ctx.parsed.x)} шт. · группа ${top[ctx.dataIndex].abc}` } },
        },
        scales: {
          x: { grid: { color: "rgba(127,127,127,.15)" }, ticks: { color: getComputedStyle(document.body).getPropertyValue("--ink-mute") } },
          y: { grid: { display: false }, ticks: { color: getComputedStyle(document.body).getPropertyValue("--ink-soft"), font: { size: 11 }, callback: function(value) { const label = this.getLabelForValue(value); const limit = canvas.clientWidth < 480 ? 17 : 30; return label.length > limit ? label.slice(0, limit - 1) + '…' : label; } } },
        },
      },
    });
  }

  // Repaint existing canvases only; switching appearance never reads the DB.
  function refreshChartTheme(){
    if(!window.Chart || typeof getComputedStyle!=='function')return;
    const css=getComputedStyle(document.body),muted=css.getPropertyValue('--ink-mute').trim(),grid=css.getPropertyValue('--chart-grid').trim();
    Chart.defaults.color=muted;Chart.defaults.font.family=css.fontFamily;
    for(const chart of Object.values(Chart.instances || {})){
      for(const [name,axis] of Object.entries(chart.options.scales || {})){
        if(axis.ticks)axis.ticks.color=window.WBTrend && chart.data.datasets.some(ds=>ds.sellerMetric) && name==='x'?'transparent':muted;
        if(axis.grid && grid)axis.grid.color=grid;
      }
      if(chart.config.type==='doughnut'){
        chart.data.datasets.forEach(ds=>ds.borderColor=css.getPropertyValue('--surface').trim());
        chart.sellerExpenseTheme?.();
      }
      chart.data.datasets.forEach(ds=>{
        if(ds.sellerMetric){
          const color=getTrendMetric(ds.sellerMetric).color;
          ds.borderColor=color;ds.backgroundColor=chart.config.type==='bar'?trendBarColors(chart.canvas,ds.sellerRows || [],color):`${color}14`;ds.pointBorderColor=color;ds.pointBackgroundColor=color;
        }
      });
      chart.update('none');
    }
  }
  window.addEventListener?.('seller:themechange',refreshChartTheme);
  if(window.Chart)document.fonts?.ready?.then(refreshChartTheme);

  function pluralArt(n) {
    const n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return "артикул";
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return "артикула";
    return "артикулов";
  }

  function formatPeriod(year, month) {
    return `${MONTH_NAMES[month]} ${year}`;
  }

  window.WBDashboard = { articleKey, costCatalogue, loadPeriods, loadPeriodData, loadPeriodRange, loadTrendData, computeDerived, fromApiCabinet, combineDerived, combineTrend, getTrendMetric, trendMetricValue, renderKPI, renderTrend, renderExpenses, renderSkuTable, formatPeriod, lastClosedPeriod, defaultPeriodValue, kpiSparkline, profitMargin, renderProfitability, expenseItems };
})();
