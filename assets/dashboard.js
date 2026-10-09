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
  const fmtMoney = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
  const fmtQty = new Intl.NumberFormat("ru-RU");
  const fmtCompact = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
  const fmtShort = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });
  const MONTH_NAMES = ["", "январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"];

  let charts = { pie: null, bar: null, trend: null };
  let skuView = { abc: "all", query: "", sort: "qty" };

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

  async function loadPeriods(shopId, marketplace) {
    const { data, error } = await sb().rpc("get_complete_periods", { p_shop_id: shopId, p_marketplace: marketplace });
    if (error) throw error;
    return data || [];
  }

  async function loadPeriodData(shopId, year, month, marketplace) {
    const reportQuery = sb().from("monthly_reports").select("*").eq("shop_id", shopId).eq("year", year).eq("month", month);
    const salesQuery = sb().from("sku_sales").select("*").eq("shop_id", shopId).eq("year", year).eq("month", month);
    const costsQuery = sb().from("sku_costs").select("*").eq("shop_id", shopId);
    const [{ data: report }, { data: skus }, { data: costs }] = await Promise.all([
      withMarketplace(reportQuery, marketplace).maybeSingle(),
      withMarketplace(salesQuery, marketplace),
      costsQuery,
    ]);
    const costMap = new Map((costs || []).map((c) => [c.article, c.cost_price]));
    const costNameMap = new Map((costs || []).filter((c) => c.name).map((c) => [c.article, c.name]));
    const namedSkus = (skus || []).map((sku) => ({
      ...sku,
      name: sku.name || costNameMap.get(sku.article) || sku.article,
    }));
    return { report, skus: namedSkus, costMap };
  }

  async function loadTrendData(shopId, taxRate, marketplace) {
    const reportsQuery = sb().from("monthly_reports").select("*").eq("shop_id", shopId).order("year", { ascending: false }).order("month", { ascending: false }).limit(12);
    const salesQuery = sb().from("sku_sales").select("*").eq("shop_id", shopId);
    const costsQuery = sb().from("sku_costs").select("*").eq("shop_id", shopId);
    const [{ data: reports, error: reportError }, { data: sales, error: salesError }, { data: costs, error: costsError }] = await Promise.all([
      withMarketplace(reportsQuery, marketplace),
      withMarketplace(salesQuery, marketplace),
      costsQuery,
    ]);
    if (reportError) throw reportError;
    if (salesError) throw salesError;
    if (costsError) throw costsError;
    const costMap = new Map((costs || []).map((c) => [c.article, c.cost_price]));
    return (reports || []).map((report) => {
      const periodSales = (sales || []).filter((row) => row.year === report.year && row.month === report.month);
      const d = computeDerived(report, periodSales, costMap, taxRate);
      const salesAmount = report.sales_amount || 0;
      const ordersAmount = report.orders_amount || 0;
      const ads = report.ads_spend || 0;
      return {
        year: report.year, month: report.month, sales: salesAmount, profit: d.netProfit,
        orders: ordersAmount, ads,
        drrOrders: ordersAmount > 0 ? ads / ordersAmount * 100 : null,
        drrSales: salesAmount > 0 ? ads / salesAmount * 100 : null,
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
      operational_expenses: 0, external_promotion_expenses: 0,
    };
    const commission = (rep.sales_amount || 0) - (rep.transfer_goods || 0);
    const skuRows = skus.map((s) => {
      const cost = costMap.get(s.article) || 0;
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
    const ads = rep.ads_spend || 0;
    const tax = (rep.sales_amount || 0) * ((taxRate || 0) / 100);
    const manualExpenses = (rep.operational_expenses || 0) + (rep.external_promotion_expenses || 0);
    const netProfit = (rep.transfer_total || 0) - ads - cogs - tax - manualExpenses;

    return { rep, commission, skuRows, cogs, ads, tax, manualExpenses, netProfit };
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
    return { rep, commission, skuRows, cogs, ads, tax, manualExpenses, netProfit };
  }

  function combineTrend(lists) {
    const periods = new Map();
    lists.flat().forEach((row) => {
      const key = `${row.year}-${row.month}`;
      const current = periods.get(key) || { year: row.year, month: row.month, sales: 0, profit: 0, orders: 0, ads: 0 };
      current.sales += row.sales || 0;
      current.profit += row.profit || 0;
      current.orders += row.orders || 0;
      current.ads += row.ads || 0;
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
    if (prevValue == null) return "";
    const diff = value - prevValue;
    const rawDir = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
    const icon = rawDir === "up" ? "icon-trend-up" : rawDir === "down" ? "icon-trend-down" : "icon-trend-flat";
    let colorDir = rawDir;
    if (rawDir !== "flat") {
      if (opts.neutral) colorDir = "flat";
      else if (opts.lowerIsBetter) colorDir = rawDir === "up" ? "down" : "up";
    }
    const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
    const absStr = unit === "шт." ? fmtQty.format(Math.abs(Math.round(diff))) : fmtMoney.format(Math.abs(Math.round(diff)));
    const pct = prevValue !== 0 ? (Math.abs(diff) / Math.abs(prevValue)) * 100 : null;
    const pctStr = pct == null ? "" : ` · ${pct.toFixed(1)}%`;
    return `
      <div class="kpi-delta kpi-delta--${colorDir}">
        <svg class="icon icon-sm"><use href="#${icon}"/></svg>
        <span>${sign}${absStr} ${unit}${pctStr}</span>
      </div>`;
  }

  // ДРР — доля рекламных расходов. (з) — от суммы заказов, (в) — от
  // суммы продаж (обе берутся из сводного отчёта). Прочерк, если делить не на что.
  function renderDrrLine(rep) {
    const ads = rep.ads_spend || 0;
    const orders = rep.orders_amount || 0;
    const sales = rep.sales_amount || 0;
    const drrZ = orders > 0 ? `${((ads / orders) * 100).toFixed(1)}%` : "—";
    const drrV = sales > 0 ? `${((ads / sales) * 100).toFixed(1)}%` : "—";
    return `<div class="kpi-extra">ДРР(з) ${drrZ} · ДРР(в) ${drrV}</div>`;
  }

  function animateKpiNumber(element, fromValue, toValue, unit) {
    const format = unit === "шт." ? fmtQty : fmtMoney;
    const target = Number(toValue) || 0;
    const from = Number.isFinite(Number(fromValue)) ? Number(fromValue) : 0;
    element.textContent = format.format(Math.round(target));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || from === target) return;

    const startedAt = performance.now();
    const duration = 720;
    element.classList.add("is-counting");
    const frame = (now) => {
      if (!element.isConnected) return;
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 4);
      element.textContent = format.format(Math.round(from + (target - from) * eased));
      if (progress < 1) requestAnimationFrame(frame);
      else {
        element.textContent = format.format(Math.round(target));
        element.classList.remove("is-counting");
      }
    };
    requestAnimationFrame(frame);
  }

  function renderKPI(container, d, prevD, marketplace) {
    container.innerHTML = "";
    const cards = [
      { label: "Сумма продаж", value: d.rep.sales_amount, prev: prevD ? prevD.rep.sales_amount : null, unit: "₽" },
      { label: "Выкупили", value: d.rep.bought_qty, prev: prevD ? prevD.rep.bought_qty : null, unit: "шт." },
      { label: marketplace === "all" ? "К выплате после удержаний" : marketplace === "ozon" ? "К выплате после удержаний (Ozon)" : "Итого к перечислению (WB)", value: d.rep.transfer_total, prev: prevD ? prevD.rep.transfer_total : null, unit: "₽" },
      { label: "Чистая прибыль", value: d.netProfit, prev: prevD ? prevD.netProfit : null, unit: "₽", hero: true },
      { label: "Расход на рекламу", value: d.rep.ads_spend, prev: prevD ? prevD.rep.ads_spend : null, unit: "₽", lowerIsBetter: true, extra: renderDrrLine(d.rep) },
      { label: "Промобонусы", value: d.rep.ads_promo_spend, prev: prevD ? prevD.rep.ads_promo_spend : null, unit: "₽", neutral: true, hideWhenZero: true },
    ];
    cards.filter((c) => !c.hideWhenZero || Math.abs(c.value || 0) > 0.005).forEach((c) => {
      const heroClass = c.hero ? " kpi--hero" : "";
      const negClass = c.hero && c.value < 0 ? " neg" : "";
      const valStr = c.unit === "шт." ? fmtQty.format(Math.round(c.value)) : fmtMoney.format(Math.round(c.value));
      const card = el(`
        <div class="kpi${heroClass}">
          <div class="kpi-label">${escapeHtml(c.label)}</div>
          <div class="kpi-value${negClass}"><span class="kpi-number">${valStr}</span> <span class="kpi-unit">${c.unit}</span></div>
          ${renderDeltaChip(c.value, c.prev, c.unit, { lowerIsBetter: c.lowerIsBetter, neutral: c.neutral })}
          ${c.extra || ""}
        </div>
      `);
      container.appendChild(card);
      animateKpiNumber(card.querySelector(".kpi-number"), c.prev == null ? 0 : c.prev, c.value, c.unit);
    });
  }

  function expenseItems(d, marketplace) {
    return [
      [marketplace === "all" ? "Комиссии маркетплейсов" : marketplace === "ozon" ? "Комиссия Ozon" : "Комиссия Wildberries", d.commission],
      ["Стоимость доставки", d.rep.delivery_cost],
      ["Стоимость хранения", d.rep.storage_cost],
      ["Штрафы", d.rep.fines],
      ["Операции при приёмке", d.rep.acceptance_ops],
      ["Компенсация ущерба", d.rep.damage_comp],
      ["Добровольная компенсация", d.rep.return_comp],
      ["Прочие доплаты", d.rep.other_fees],
      ["Расход на рекламу", d.ads],
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
    const pct = prevValue !== 0 ? `${fmtCompact.format(Math.abs(diff) / Math.abs(prevValue) * 100)}%` : diff === 0 ? "0%" : "новая статья";
    return `<span class="expense-delta expense-delta--${colorDir}${className ? ` ${className}` : ""}">
      <svg class="icon icon-sm" aria-hidden="true"><use href="#${icon}"/></svg>
      <span>${sign}${fmtMoney.format(Math.abs(Math.round(diff)))} ₽ · ${pct}</span>
    </span>`;
  }

  function renderExpenses(listEl, totalEl, canvas, d, marketplace, prevD) {
    const palette = ["#5e5ce6", "#0a84ff", "#30b0c7", "#34c759", "#ff9f0a", "#ff6b5f", "#bf5af2", "#64d2ff", "#ac8e68", "#ff375f", "#8e8e93", "#af52de", "#00a6a6"];
    const items = expenseItems(d, marketplace);
    const prevItems = prevD ? new Map(expenseItems(prevD, marketplace)) : null;
    const total = items.reduce((s, it) => s + Math.abs(it[1]), 0);
    const prevTotal = prevItems ? [...prevItems.values()].reduce((sum, value) => sum + Math.abs(value), 0) : null;
    const visibleItems = items.map(([label, value]) => ({ label, value }))
      .filter((item) => Math.abs(item.value) > 0.005)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .map((item, index) => ({ ...item, color: palette[index % palette.length] }));
    const chartItems = visibleItems.length > 6
      ? [
          ...visibleItems.slice(0, 5),
          {
            label: "Прочие расходы",
            value: visibleItems.slice(5).reduce((sum, item) => sum + Math.abs(item.value), 0),
            color: "#c7c7cc",
          },
        ]
      : visibleItems;
    const salesShare = (d.rep.sales_amount || 0) > 0 ? (total / d.rep.sales_amount) * 100 : null;
    const totalText = `${fmtMoney.format(Math.round(total))} ₽`;

    const heroTotal = document.getElementById("expHeroTotal");
    const shareEl = document.getElementById("expSalesShare");
    const centerValue = document.getElementById("expCenterValue");
    if (heroTotal) heroTotal.textContent = totalText;
    if (shareEl) shareEl.textContent = salesShare == null ? "—" : `${salesShare.toFixed(1)}%`;
    if (centerValue) centerValue.textContent = fmtShort.format(Math.round(total));
    const heroDelta = document.getElementById("expHeroDelta");
    if (heroDelta) heroDelta.innerHTML = renderExpenseDelta(total, prevTotal, "expense-delta--summary");

    listEl.innerHTML = visibleItems.length ? visibleItems.map(({ label, value, color }) => {
      const pct = total > 0 ? Math.abs(value / total) * 100 : 0;
      return `
        <div class="exp-row">
          <div class="exp-name"><i style="--expense-color:${color}"></i><span>${escapeHtml(label)}</span></div>
          <div class="exp-track"><div class="exp-fill" style="--expense-color:${color};--expense-width:${Math.max(2, pct).toFixed(1)}%"></div></div>
          <div class="exp-meta">
            <strong>${fmtMoney.format(Math.round(value))} ₽</strong>
            <span>${pct.toFixed(1)}%</span>
            ${renderExpenseDelta(Math.abs(value), prevItems ? Math.abs(prevItems.get(label) || 0) : null)}
          </div>
        </div>`;
    }).join("") : `<div class="analytics-empty">Расходов за этот период пока нет</div>`;
    totalEl.textContent = totalText;

    if (charts.pie) charts.pie.destroy();
    charts.pie = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: chartItems.map((i) => i.label),
        datasets: [{
          data: chartItems.map((i) => Math.abs(i.value)),
          backgroundColor: chartItems.map((i) => i.color),
          borderColor: "#ffffff",
          borderWidth: 3,
          hoverBorderWidth: 3,
          spacing: 1,
          hoverOffset: 3,
          borderRadius: 7,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 760, easing: "easeOutQuart" },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${fmtMoney.format(ctx.parsed)} ₽ · ${total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : 0}%` } },
        },
        cutout: "78%",
        radius: "88%",
      },
    });
  }

  function renderTrend(canvas, rows, mode) {
    if (charts.trend) charts.trend.destroy();
    mode = mode === "drr" ? "drr" : "money";
    const inkMute = getComputedStyle(document.body).getPropertyValue("--ink-mute").trim();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isDrr = mode === "drr";
    const datasets = isDrr ? [
      {
        label: "ДРР заказов",
        data: rows.map((r) => r.drrOrders),
        borderColor: "#ff9f0a",
        backgroundColor: "rgba(255,159,10,.10)",
        borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5, pointHitRadius: 14,
        tension: .38, fill: true, spanGaps: true,
      },
      {
        label: "ДРР выкупа",
        data: rows.map((r) => r.drrSales),
        borderColor: "#af52de",
        backgroundColor: "transparent",
        borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5, pointHitRadius: 14,
        tension: .38, spanGaps: true,
      },
    ] : [
      {
        label: "Продажи", data: rows.map((r) => r.sales), borderColor: "#0071e3",
        backgroundColor: "rgba(0,113,227,.09)", borderWidth: 2.5, pointRadius: 0,
        pointHoverRadius: 5, pointHitRadius: 14, tension: .38, fill: true,
      },
      {
        label: "Чистая прибыль", data: rows.map((r) => r.profit), borderColor: "#1d1d1f",
        backgroundColor: "transparent", borderWidth: 2.5, pointRadius: 0,
        pointHoverRadius: 5, pointHitRadius: 14, tension: .38,
      },
    ];
    charts.trend = new Chart(canvas, {
      type: "line",
      data: {
        labels: rows.map((r) => `${MONTH_NAMES[r.month].slice(0, 3)} ${String(r.year).slice(-2)}`),
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        animation: reduceMotion ? false : { duration: 720, easing: "easeOutQuart" },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "rgba(29,29,31,.94)",
            padding: 12,
            cornerRadius: 10,
            displayColors: true,
            callbacks: { label: (ctx) => isDrr
              ? ` ${ctx.dataset.label}: ${fmtCompact.format(ctx.parsed.y)}%`
              : ` ${ctx.dataset.label}: ${fmtMoney.format(Math.round(ctx.parsed.y))} ₽` },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: inkMute, maxRotation: 0 } },
          y: {
            border: { display: false },
            grid: { color: "rgba(127,127,127,.12)" },
            ticks: {
              color: inkMute,
              callback: (v) => isDrr
                ? `${fmtCompact.format(v)}%`
                : Math.abs(v) >= 1000000
                  ? `${fmtCompact.format(v / 1000000)} млн ₽`
                  : `${fmtCompact.format(v / 1000)} тыс. ₽`,
            },
          },
        },
      },
    });
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
    const counts = { A: 0, B: 0, C: 0 };
    const prevRows = prevD ? new Map(prevD.skuRows.map((row) => [row.article, row])) : null;
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
      tbody.innerHTML = `<tr><td colspan="5" class="empty">${message}</td></tr>`;
      tfoot.innerHTML = "";
    } else {
      const maxQty = Math.max(...rows.map((s) => s.bought_qty), 1);
      tbody.innerHTML = rows.map((s, index) => {
        const qtyPct = Math.max(3, Math.round((s.bought_qty / maxQty) * 100));
        const profitClass = s.profit >= 0 ? "profit-pos" : "profit-neg";
        const costCell = hasCost || s.cost_price > 0
          ? fmtMoney.format(Math.round(s.total_cost))
          : `<span class="cost-warn">не заполнено</span>`;
        const abcBadge = `<span class="abc-badge abc-badge--${s.abc}" title="${ABC_TITLE[s.abc]}">${s.abc}</span>`;
        const prev = prevRows ? prevRows.get(s.article) : null;
        const newBadge = prevRows && !prev ? `<span class="sku-new">Новый</span>` : "";
        return `
          <tr style="--row-index:${Math.min(index, 12)}">
            <td>${abcBadge}${newBadge}<span class="sku-name">${escapeHtml(s.name || s.article)}</span><span class="sku-art">${escapeHtml(s.article)}</span></td>
            <td class="num"><div class="sku-metric"><div class="qty-cell"><div class="qty-track"><div class="qty-fill" style="width:${qtyPct}%"></div></div><span class="qty-num">${fmtQty.format(s.bought_qty)}</span></div>${prev ? renderSkuDelta(s.bought_qty, prev.bought_qty, "шт.") : ""}</div></td>
            <td class="num mono"><div class="sku-metric"><strong>${fmtMoney.format(Math.round(s.revenue))}</strong>${prev ? renderSkuDelta(s.revenue, prev.revenue, "₽") : ""}</div></td>
            <td class="num mono">${costCell}</td>
            <td class="num ${profitClass}"><div class="sku-metric"><strong>${fmtMoney.format(Math.round(s.profit))}</strong>${prev ? renderSkuDelta(s.profit, prev.profit, "₽") : ""}</div></td>
          </tr>`;
      }).join("");

      const tot = rows.reduce((a, s) => ({
        qty: a.qty + s.bought_qty, rev: a.rev + s.revenue, cost: a.cost + s.total_cost, profit: a.profit + s.profit,
      }), { qty: 0, rev: 0, cost: 0, profit: 0 });
      tfoot.innerHTML = `
        <tr>
          <td>Итого</td>
          <td class="num mono">${fmtQty.format(tot.qty)}</td>
          <td class="num mono">${fmtMoney.format(Math.round(tot.rev))}</td>
          <td class="num mono">${fmtMoney.format(Math.round(tot.cost))}</td>
          <td class="num mono">${fmtMoney.format(Math.round(tot.profit))}</td>
        </tr>`;
    }

    if (charts.bar) charts.bar.destroy();
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
        animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 680, easing: "easeOutQuart" },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ` ${fmtQty.format(ctx.parsed.x)} шт. · группа ${top[ctx.dataIndex].abc}` } },
        },
        scales: {
          x: { grid: { color: "rgba(127,127,127,.15)" }, ticks: { color: getComputedStyle(document.body).getPropertyValue("--ink-mute") } },
          y: { grid: { display: false }, ticks: { color: getComputedStyle(document.body).getPropertyValue("--ink-soft"), font: { size: 11 } } },
        },
      },
    });
  }

  function pluralArt(n) {
    const n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return "артикул";
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return "артикула";
    return "артикулов";
  }

  function formatPeriod(year, month) {
    return `${MONTH_NAMES[month]} ${year}`;
  }

  window.WBDashboard = { loadPeriods, loadPeriodData, loadTrendData, computeDerived, combineDerived, combineTrend, renderKPI, renderTrend, renderExpenses, renderSkuTable, formatPeriod, lastClosedPeriod, defaultPeriodValue };
})();
