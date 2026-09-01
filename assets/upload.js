// Загрузка отчётов WB (клиентский парсинг + запись в Supabase) и ручной ввод.
(function () {
  const sb = () => window.supabaseClient;

  // Записывает загрузку в журнал (assets: не должно ронять основной
  // сценарий загрузки, если по какой-то причине не удалось залогировать).
  async function logUpload(shopId, kind, filename, extra) {
    try {
      const { error } = await sb().from("uploads").insert({ shop_id: shopId, kind, filename, ...extra });
      if (error) console.warn("Не удалось записать в журнал загрузок:", error.message);
    } catch (e) {
      console.warn("Не удалось записать в журнал загрузок:", e.message);
    }
  }

  async function uploadSummaryReport(shopId, file) {
    const rows = await window.WBParse.parseSummaryReport(file);
    if (!rows.length) throw new Error("В файле не найдено ни одной строки-итога по месяцу.");
    const payload = rows.map((r) => ({ shop_id: shopId, ...r }));
    const { error } = await sb().from("monthly_reports").upsert(payload, { onConflict: "shop_id,year,month" });
    if (error) throw error;
    await logUpload(shopId, "summary", file.name, {
      periods: rows.map((r) => ({ year: r.year, month: r.month })),
      row_count: rows.length,
    });
    return rows.length;
  }

  async function uploadSalesReport(shopId, file, year, month) {
    const { skus } = await window.WBParse.parseSalesReport(file);
    if (!skus.length) throw new Error("В файле не найдено ни одной строки по артикулам.");

    const salesPayload = skus.map((s) => ({
      shop_id: shopId, year, month, article: s.article, name: s.name,
      bought_qty: s.bought_qty, revenue: s.revenue,
    }));
    const { error: e1 } = await sb().from("sku_sales").upsert(salesPayload, { onConflict: "shop_id,year,month,article" });
    if (e1) throw e1;

    // заводим карточку себестоимости для новых артикулов, не трогая уже заполненные
    const costsPayload = skus.map((s) => ({ shop_id: shopId, article: s.article, name: s.name, cost_price: 0 }));
    const { error: e2 } = await sb()
      .from("sku_costs")
      .upsert(costsPayload, { onConflict: "shop_id,article", ignoreDuplicates: true });
    if (e2) throw e2;

    await logUpload(shopId, "sales", file.name, { year, month, row_count: skus.length });
    return skus.length;
  }

  // Импорт «Истории затрат» на рекламу. Один файл может охватывать
  // несколько месяцев — расход распределяется по месяцу даты списания.
  // Баланс пишется в ads_spend (уменьшает прибыль), промобонусы — в
  // ads_promo_spend (справочно, в расчёт прибыли не входит).
  async function uploadAdsSpend(shopId, file) {
    const { periods, transactionCount } = await window.WBParse.parseAdsSpendFile(file);
    const payload = periods.map((p) => ({
      shop_id: shopId, year: p.year, month: p.month,
      ads_spend: p.balance, ads_promo_spend: p.promo,
    }));
    const { error } = await sb().from("monthly_reports").upsert(payload, { onConflict: "shop_id,year,month" });
    if (error) throw error;
    await logUpload(shopId, "ads", file.name, {
      periods: periods.map((p) => ({ year: p.year, month: p.month })),
      row_count: transactionCount,
    });
    return periods.length;
  }

  async function saveCostPrice(shopId, article, name, cost) {
    const { error } = await sb()
      .from("sku_costs")
      .upsert({ shop_id: shopId, article, name: name || "", cost_price: cost }, { onConflict: "shop_id,article" });
    if (error) throw error;
  }

  async function listCosts(shopId) {
    const { data, error } = await sb().from("sku_costs").select("*").eq("shop_id", shopId).order("article");
    if (error) throw error;
    return data || [];
  }

  // Массовый импорт себестоимости из файла (см. WBParse.parseCostsFile).
  // Название артикула, если в файле его нет, берётся из уже сохранённого —
  // импорт не должен затирать то, что уже подтянулось из отчёта «Продажи».
  async function importCosts(shopId, rows, filename) {
    const existing = await listCosts(shopId);
    const nameByArticle = new Map(existing.map((c) => [c.article, c.name]));
    const payload = rows.map((r) => ({
      shop_id: shopId,
      article: r.article,
      name: r.name || nameByArticle.get(r.article) || "",
      cost_price: r.cost_price,
    }));
    const { error } = await sb().from("sku_costs").upsert(payload, { onConflict: "shop_id,article" });
    if (error) throw error;
    await logUpload(shopId, "costs", filename || "себестоимость.xlsx", {
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

  // Отменяет загрузку: для сводного отчёта обнуляет только поля из файла
  // (расход на рекламу, введённый вручную, не трогаем); для продаж —
  // удаляет строки за период; для себестоимости — обнуляет цену только
  // у затронутых артикулов (сама карточка артикула остаётся).
  async function deleteUpload(shopId, upload) {
    if (upload.kind === "summary") {
      const zeroed = {
        sales_amount: 0, bought_qty: 0, transfer_total: 0, transfer_goods: 0,
        delivery_cost: 0, storage_cost: 0, fines: 0, acceptance_ops: 0,
        damage_comp: 0, return_comp: 0, other_fees: 0,
      };
      for (const p of upload.periods || []) {
        const { error } = await sb().from("monthly_reports").update(zeroed)
          .eq("shop_id", shopId).eq("year", p.year).eq("month", p.month);
        if (error) throw error;
      }
    } else if (upload.kind === "sales") {
      const { error } = await sb().from("sku_sales").delete()
        .eq("shop_id", shopId).eq("year", upload.year).eq("month", upload.month);
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
          .eq("shop_id", shopId).eq("year", p.year).eq("month", p.month);
        if (error) throw error;
      }
    }
    const { error } = await sb().from("uploads").delete().eq("id", upload.id);
    if (error) throw error;
  }

  window.WBUpload = {
    uploadSummaryReport, uploadSalesReport, uploadAdsSpend, saveCostPrice, listCosts, importCosts,
    listUploads, deleteUpload,
  };
})();
