// Логика загрузки данных из Supabase и отрисовки дашборда.
// Используется и в личном кабинете (editable = true), и в публичной
// витрине магазина (editable = false, без панели загрузки/ввода).
(function () {
  const sb = () => window.supabaseClient;
  const fmtMoney = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
  const fmtQty = new Intl.NumberFormat("ru-RU");
  const MONTH_NAMES = ["", "январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"];

  let charts = { pie: null, bar: null };

  async function loadPeriods(shopId) {
    const { data, error } = await sb()
      .from("monthly_reports")
      .select("year,month")
      .eq("shop_id", shopId)
      .order("year", { ascending: false })
      .order("month", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function loadPeriodData(shopId, year, month) {
    const [{ data: report }, { data: skus }, { data: costs }] = await Promise.all([
      sb().from("monthly_reports").select("*").eq("shop_id", shopId).eq("year", year).eq("month", month).maybeSingle(),
      sb().from("sku_sales").select("*").eq("shop_id", shopId).eq("year", year).eq("month", month),
      sb().from("sku_costs").select("*").eq("shop_id", shopId),
    ]);
    const costMap = new Map((costs || []).map((c) => [c.article, c.cost_price]));
    return { report, skus: skus || [], costMap };
  }

  // taxRate — ставка налога в % от суммы продаж (свойство магазина, не
  // привязана к периоду — как и себестоимость).
  function computeDerived(report, skus, costMap, taxRate) {
    const rep = report || {
      sales_amount: 0, bought_qty: 0, transfer_total: 0, transfer_goods: 0,
      delivery_cost: 0, storage_cost: 0, fines: 0, acceptance_ops: 0,
      damage_comp: 0, return_comp: 0, other_fees: 0, ads_spend: 0, ads_promo_spend: 0,
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
    const netProfit = (rep.transfer_total || 0) - ads - cogs - tax;

    return { rep, commission, skuRows, cogs, ads, tax, netProfit };
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

  function renderKPI(container, d, prevD) {
    container.innerHTML = "";
    const cards = [
      { label: "Сумма продаж", value: d.rep.sales_amount, prev: prevD ? prevD.rep.sales_amount : null, unit: "₽" },
      { label: "Выкупили", value: d.rep.bought_qty, prev: prevD ? prevD.rep.bought_qty : null, unit: "шт." },
      { label: "Итого к перечислению (WB)", value: d.rep.transfer_total, prev: prevD ? prevD.rep.transfer_total : null, unit: "₽" },
      { label: "Чистая прибыль", value: d.netProfit, prev: prevD ? prevD.netProfit : null, unit: "₽", hero: true },
      { label: "Расход на рекламу", value: d.rep.ads_spend, prev: prevD ? prevD.rep.ads_spend : null, unit: "₽", lowerIsBetter: true },
      { label: "Промобонусы", value: d.rep.ads_promo_spend, prev: prevD ? prevD.rep.ads_promo_spend : null, unit: "₽", neutral: true },
    ];
    cards.forEach((c) => {
      const heroClass = c.hero ? " kpi--hero" : "";
      const negClass = c.hero && c.value < 0 ? " neg" : "";
      const valStr = c.unit === "шт." ? fmtQty.format(Math.round(c.value)) : fmtMoney.format(Math.round(c.value));
      container.appendChild(el(`
        <div class="kpi${heroClass}">
          <div class="kpi-label">${escapeHtml(c.label)}</div>
          <div class="kpi-value${negClass}">${valStr} <span class="kpi-unit">${c.unit}</span></div>
          ${renderDeltaChip(c.value, c.prev, c.unit, { lowerIsBetter: c.lowerIsBetter, neutral: c.neutral })}
        </div>
      `));
    });
  }

  function renderExpenses(listEl, totalEl, canvas, d) {
    const items = [
      ["Комиссия Wildberries", d.commission],
      ["Стоимость доставки", d.rep.delivery_cost],
      ["Стоимость хранения", d.rep.storage_cost],
      ["Штрафы", d.rep.fines],
      ["Операции при приёмке", d.rep.acceptance_ops],
      ["Компенсация ущерба", d.rep.damage_comp],
      ["Добровольная компенсация", d.rep.return_comp],
      ["Прочие доплаты", d.rep.other_fees],
      ["Расход на рекламу", d.ads],
      ["Налог", d.tax],
      ["Себестоимость товара", d.cogs],
    ];
    const total = items.reduce((s, it) => s + it[1], 0);
    const maxVal = Math.max(...items.map((it) => Math.abs(it[1])), 1);

    listEl.innerHTML = items.map(([label, val]) => {
      const pct = Math.max(2, Math.round((Math.abs(val) / maxVal) * 100));
      return `
        <div class="exp-row">
          <div class="exp-name">${escapeHtml(label)}</div>
          <div class="exp-track"><div class="exp-fill" style="width:${pct}%"></div></div>
          <div class="exp-val">${fmtMoney.format(Math.round(val))}</div>
        </div>`;
    }).join("");
    totalEl.textContent = fmtMoney.format(Math.round(total)) + " ₽";

    if (charts.pie) charts.pie.destroy();
    const nonZero = items.filter((it) => it[1] > 0);
    charts.pie = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: nonZero.map((i) => i[0]),
        datasets: [{
          data: nonZero.map((i) => i[1]),
          backgroundColor: ["#1f2a44","#2a78d6","#2e7d6b","#7a6fd1","#d98c3d","#c2554a","#8b8fa3","#4f6d3a","#b08a2e","#5b9be5"],
          borderColor: "var(--surface)",
          borderWidth: 2,
        }],
      },
      options: {
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 }, color: getComputedStyle(document.body).getPropertyValue("--ink-soft") } },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${fmtMoney.format(ctx.parsed)} ₽` } },
        },
        cutout: "62%",
      },
    });
  }

  const ABC_TITLE = {
    A: "Группа A — вносит вклад в первые 80% выручки",
    B: "Группа B — вносит вклад в следующие 80–95% выручки",
    C: "Группа C — оставшиеся ~5% выручки",
  };

  function renderSkuTable(tbody, tfoot, hint, canvas, d) {
    const counts = { A: 0, B: 0, C: 0 };
    d.skuRows.forEach((s) => { counts[s.abc] = (counts[s.abc] || 0) + 1; });
    hint.textContent = d.skuRows.length
      ? `${d.skuRows.length} ${pluralArt(d.skuRows.length)} · A ${counts.A} · B ${counts.B} · C ${counts.C}`
      : "";
    const hasCost = d.skuRows.some((s) => s.cost_price > 0);

    if (!d.skuRows.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty">Нет данных по артикулам за выбранный период</td></tr>`;
      tfoot.innerHTML = "";
    } else {
      const maxQty = Math.max(...d.skuRows.map((s) => s.bought_qty), 1);
      tbody.innerHTML = d.skuRows.map((s) => {
        const qtyPct = Math.max(3, Math.round((s.bought_qty / maxQty) * 100));
        const profitClass = s.profit >= 0 ? "profit-pos" : "profit-neg";
        const costCell = hasCost || s.cost_price > 0
          ? fmtMoney.format(Math.round(s.total_cost))
          : `<span class="cost-warn">не заполнено</span>`;
        const abcBadge = `<span class="abc-badge abc-badge--${s.abc}" title="${ABC_TITLE[s.abc]}">${s.abc}</span>`;
        return `
          <tr>
            <td>${abcBadge}<span class="sku-name">${escapeHtml(s.name || s.article)}</span><span class="sku-art">${escapeHtml(s.article)}</span></td>
            <td class="num"><div class="qty-cell"><div class="qty-track"><div class="qty-fill" style="width:${qtyPct}%"></div></div><span class="qty-num">${fmtQty.format(s.bought_qty)}</span></div></td>
            <td class="num mono">${fmtMoney.format(Math.round(s.revenue))}</td>
            <td class="num mono">${costCell}</td>
            <td class="num ${profitClass}">${fmtMoney.format(Math.round(s.profit))}</td>
          </tr>`;
      }).join("");

      const tot = d.skuRows.reduce((a, s) => ({
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
    const top = d.skuRows.slice(0, 10);
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

  window.WBDashboard = { loadPeriods, loadPeriodData, computeDerived, renderKPI, renderExpenses, renderSkuTable, formatPeriod };
})();
