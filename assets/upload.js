// Загрузка отчётов WB (клиентский парсинг + запись в Supabase) и ручной ввод.
(function () {
  const sb = () => window.supabaseClient;

  // Записывает загрузку в журнал (assets: не должно ронять основной
  // сценарий загрузки, если по какой-то причине не удалось залогировать).
  async function logUpload(shopId, marketplace, kind, filename, extra) {
    try {
      const { error } = await sb().from("uploads").insert({ shop_id: shopId, marketplace, kind, filename, ...extra });
      if (error) console.warn("Не удалось записать в журнал загрузок:", error.message);
    } catch (e) {
      console.warn("Не удалось записать в журнал загрузок:", e.message);
    }
  }

  async function uploadSummaryReport(shopId, file) {
    const rows = await window.WBParse.parseSummaryReport(file);
    if (!rows.length) throw new Error("В файле не найдено ни одной строки-итога по месяцу.");
    const payload = rows.map((r) => ({ shop_id: shopId, marketplace: "wildberries", ...r }));
    const { error } = await sb().from("monthly_reports").upsert(payload, { onConflict: "shop_id,marketplace,year,month" });
    if (error) throw error;
    await logUpload(shopId, "wildberries", "summary", file.name, {
      periods: rows.map((r) => ({ year: r.year, month: r.month })),
      row_count: rows.length,
    });
    return rows.length;
  }

  async function uploadSalesReport(shopId, file, year, month) {
    const { skus } = await window.WBParse.parseSalesReport(file);
    if (!skus.length) throw new Error("В файле не найдено ни одной строки по артикулам.");

    const salesPayload = skus.map((s) => ({
      shop_id: shopId, marketplace: "wildberries", year, month, article: s.article, name: s.name,
      bought_qty: s.bought_qty, revenue: s.revenue,
    }));
    const { error: e1 } = await sb().from("sku_sales").upsert(salesPayload, { onConflict: "shop_id,marketplace,year,month,article" });
    if (e1) throw e1;

    // заводим карточку себестоимости для новых артикулов, не трогая уже заполненные
    const costsPayload = skus.map((s) => ({ shop_id: shopId, article: s.article, name: s.name, cost_price: 0 }));
    const { error: e2 } = await sb()
      .from("sku_costs")
      .upsert(costsPayload, { onConflict: "shop_id,article", ignoreDuplicates: true });
    if (e2) throw e2;

    await logUpload(shopId, "wildberries", "sales", file.name, { year, month, row_count: skus.length });
    return skus.length;
  }

  // Импорт «Истории затрат» на рекламу. Один файл может охватывать
  // несколько месяцев — расход распределяется по месяцу даты списания.
  // Баланс пишется в ads_spend (уменьшает прибыль), промобонусы — в
  // ads_promo_spend (справочно, в расчёт прибыли не входит).
  async function uploadAdsSpend(shopId, file) {
    const { periods, transactionCount } = await window.WBParse.parseAdsSpendFile(file);
    const payload = periods.map((p) => ({
      shop_id: shopId, marketplace: "wildberries", year: p.year, month: p.month,
      ads_spend: p.balance, ads_promo_spend: p.promo,
    }));
    const { error } = await sb().from("monthly_reports").upsert(payload, { onConflict: "shop_id,marketplace,year,month" });
    if (error) throw error;
    await logUpload(shopId, "wildberries", "ads", file.name, {
      periods: periods.map((p) => ({ year: p.year, month: p.month })),
      row_count: transactionCount,
    });
    return periods.length;
  }

  async function uploadWbMedia(shopId, file) {
    const duplicate = await sb().from("uploads").select("id").eq("shop_id", shopId)
      .eq("kind", "wb_media").eq("filename", file.name).maybeSingle();
    if (duplicate.error) throw duplicate.error;
    if (duplicate.data) throw new Error("Этот отчёт WB Media уже загружен.");
    const { periods, transactionCount } = await window.WBParse.parseWbMedia(file);
    const payload = [];
    for (const p of periods) {
      const { data: current, error: readError } = await sb().from("monthly_reports")
        .select("wb_media_spend,wb_media_orders_amount,ads_promo_spend")
        .eq("shop_id", shopId).eq("marketplace", "wildberries").eq("year", p.year).eq("month", p.month).maybeSingle();
      if (readError) throw readError;
      payload.push({
        shop_id: shopId, marketplace: "wildberries", year: p.year, month: p.month,
        wb_media_spend: (current?.wb_media_spend || 0) + p.amount,
        wb_media_orders_amount: (current?.wb_media_orders_amount || 0) + (p.orders || 0),
        ads_promo_spend: (current?.ads_promo_spend || 0) + (p.promo || 0),
      });
    }
    const { error } = await sb().from("monthly_reports").upsert(payload, { onConflict: "shop_id,marketplace,year,month" });
    if (error) throw error;
    await logUpload(shopId, "wildberries", "wb_media", file.name, {
      periods: periods.map((p) => ({ year: p.year, month: p.month, amount: p.amount, promo: p.promo || 0, orders: p.orders || 0 })),
      row_count: transactionCount,
    });
    return periods.length;
  }

  async function uploadOzonAccruals(shopId, file) {
    const { periods, transactionCount } = await window.WBParse.parseOzonAccruals(file);
    const reports = periods.map((p) => ({ shop_id: shopId, marketplace: "ozon", ...p.report }));
    const { error: reportError } = await sb().from("monthly_reports").upsert(reports, { onConflict: "shop_id,marketplace,year,month" });
    if (reportError) throw reportError;

    const sales = periods.flatMap((p) => p.skus.map((sku) => ({
      shop_id: shopId, marketplace: "ozon", year: p.report.year, month: p.report.month,
      article: sku.article, name: sku.name, bought_qty: sku.bought_qty, revenue: sku.revenue,
    })));
    if (sales.length) {
      const { error: salesError } = await sb().from("sku_sales").upsert(sales, { onConflict: "shop_id,marketplace,year,month,article" });
      if (salesError) throw salesError;
      const costs = sales.map((s) => ({ shop_id: shopId, article: s.article, name: s.name, cost_price: 0 }));
      const { error: costsError } = await sb().from("sku_costs").upsert(costs, { onConflict: "shop_id,article", ignoreDuplicates: true });
      if (costsError) throw costsError;
    }
    await logUpload(shopId, "ozon", "ozon_accruals", file.name, {
      periods: periods.map((p) => ({ year: p.report.year, month: p.report.month })),
      row_count: transactionCount,
    });
    return periods.length;
  }

  async function saveCostPrice(shopId, _marketplace, article, name, cost) {
    const { error } = await sb()
      .from("sku_costs")
      .upsert({ shop_id: shopId, article, name: name || "", cost_price: cost }, { onConflict: "shop_id,article" });
    if (error) throw error;
  }

  async function listCosts(shopId, _marketplace) {
    const { data, error } = await sb().from("sku_costs").select("*").eq("shop_id", shopId).order("article");
    if (error) throw error;
    return data || [];
  }

  // Массовый импорт себестоимости из файла (см. WBParse.parseCostsFile).
  // Название артикула, если в файле его нет, берётся из уже сохранённого —
  // импорт не должен затирать то, что уже подтянулось из отчёта «Продажи».
  async function importCosts(shopId, marketplace, rows, filename) {
    const existing = await listCosts(shopId, marketplace);
    const nameByArticle = new Map(existing.map((c) => [c.article, c.name]));
    const payload = rows.map((r) => ({
      shop_id: shopId,
      article: r.article,
      name: r.name || nameByArticle.get(r.article) || "",
      cost_price: r.cost_price,
    }));
    const { error } = await sb().from("sku_costs").upsert(payload, { onConflict: "shop_id,article" });
    if (error) throw error;
    await logUpload(shopId, marketplace, "costs", filename || "себестоимость.xlsx", {
      articles: rows.map((r) => r.article),
      row_count: payload.length,
    });
    return payload.length;
  }

  // ---- Журнал загрузок ----
  async function listUploads(shopId) {
    const { data, error } = await sb().from("uploads").select("*").eq("shop_id", shopId).order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function saveManualExpenses(shopId, marketplace, year, month, operationalExpenses, externalPromotionExpenses) {
    const payload = {
      shop_id: shopId,
      marketplace,
      year,
      month,
      operational_expenses: Math.max(0, Number(operationalExpenses) || 0),
      external_promotion_expenses: Math.max(0, Number(externalPromotionExpenses) || 0),
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb().from("monthly_reports").upsert(payload, { onConflict: "shop_id,marketplace,year,month" });
    if (error) throw error;
    return payload;
  }

  // Отменяет загрузку: для сводного отчёта обнуляет только поля из файла
  // (расход на рекламу, введённый вручную, не трогаем); для продаж —
  // удаляет строки за период; для себестоимости — обнуляет цену только
  // у затронутых артикулов (сама карточка артикула остаётся).
  async function deleteUpload(shopId, upload) {
    const marketplace = upload.marketplace || (upload.kind === "ozon_accruals" ? "ozon" : "wildberries");
    if (upload.kind === "summary") {
      const zeroed = {
        sales_amount: 0, orders_amount: 0, bought_qty: 0, transfer_total: 0, transfer_goods: 0,
        delivery_cost: 0, storage_cost: 0, fines: 0, acceptance_ops: 0,
        damage_comp: 0, return_comp: 0, other_fees: 0,
      };
      for (const p of upload.periods || []) {
        const { error } = await sb().from("monthly_reports").update(zeroed)
          .eq("shop_id", shopId).eq("marketplace", marketplace).eq("year", p.year).eq("month", p.month);
        if (error) throw error;
      }
    } else if (upload.kind === "sales") {
      const { error } = await sb().from("sku_sales").delete()
        .eq("shop_id", shopId).eq("marketplace", marketplace).eq("year", upload.year).eq("month", upload.month);
      if (error) throw error;
    } else if (upload.kind === "costs") {
      if (upload.articles && upload.articles.length) {
        const { error } = await sb().from("sku_costs").update({ cost_price: 0 })
          .eq("shop_id", shopId).in("article", upload.articles);
        if (error) throw error;
      }
    } else if (upload.kind === "ads") {
      for (const p of upload.periods || []) {
        const { error } = await sb().from("monthly_reports").update({ ads_spend: 0, ads_promo_spend: 0 })
          .eq("shop_id", shopId).eq("marketplace", marketplace).eq("year", p.year).eq("month", p.month);
        if (error) throw error;
      }
    } else if (upload.kind === "wb_financial_details") {
      for (const p of upload.periods || []) {
        const { data: current, error: readError } = await sb().from("monthly_reports")
          .select("loyalty_points_spend,loyalty_program_fee")
          .eq("shop_id", shopId).eq("marketplace", marketplace).eq("year", p.year).eq("month", p.month).maybeSingle();
        if (readError) throw readError;
        const { error } = await sb().from("monthly_reports").update({
          loyalty_points_spend: (current?.loyalty_points_spend || 0) - (p.points || 0),
          loyalty_program_fee: (current?.loyalty_program_fee || 0) - (p.fee || 0),
        })
          .eq("shop_id", shopId).eq("marketplace", marketplace).eq("year", p.year).eq("month", p.month);
        if (error) throw error;
      }
    } else if (upload.kind === "wb_media") {
      for (const p of upload.periods || []) {
        const { data: current, error: readError } = await sb().from("monthly_reports").select("wb_media_spend,wb_media_orders_amount,ads_promo_spend")
          .eq("shop_id", shopId).eq("marketplace", marketplace).eq("year", p.year).eq("month", p.month).maybeSingle();
        if (readError) throw readError;
        const { error } = await sb().from("monthly_reports").update({
          wb_media_spend: Math.max(0, (current?.wb_media_spend || 0) - (p.amount || 0)),
          wb_media_orders_amount: Math.max(0, (current?.wb_media_orders_amount || 0) - (p.orders || 0)),
          ads_promo_spend: Math.max(0, (current?.ads_promo_spend || 0) - (p.promo || 0)),
        })
          .eq("shop_id", shopId).eq("marketplace", marketplace).eq("year", p.year).eq("month", p.month);
        if (error) throw error;
      }
    } else if (upload.kind === "ozon_accruals") {
      const zeroed = {
        sales_amount: 0, orders_amount: 0, bought_qty: 0, transfer_total: 0, transfer_goods: 0,
        delivery_cost: 0, storage_cost: 0, fines: 0, acceptance_ops: 0,
        damage_comp: 0, return_comp: 0, other_fees: 0, ads_spend: 0, ads_promo_spend: 0,
      };
      for (const p of upload.periods || []) {
        const { error: reportError } = await sb().from("monthly_reports").update(zeroed)
          .eq("shop_id", shopId).eq("marketplace", marketplace).eq("year", p.year).eq("month", p.month);
        if (reportError) throw reportError;
        const { error: salesError } = await sb().from("sku_sales").delete()
          .eq("shop_id", shopId).eq("marketplace", marketplace).eq("year", p.year).eq("month", p.month);
        if (salesError) throw salesError;
      }
    }
    const { error } = await sb().from("uploads").delete().eq("id", upload.id);
    if (error) throw error;
  }

  window.WBUpload = {
    uploadSummaryReport, uploadSalesReport, uploadAdsSpend, uploadWbMedia,
    uploadOzonAccruals, saveCostPrice, listCosts, importCosts,
    listUploads, deleteUpload, saveManualExpenses,
  };
})();
