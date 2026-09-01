// Загрузка отчётов WB (клиентский парсинг + запись в Supabase) и ручной ввод.
(function () {
  const sb = () => window.supabaseClient;

  async function uploadSummaryReport(shopId, file) {
    const rows = await window.WBParse.parseSummaryReport(file);
    if (!rows.length) throw new Error("В файле не найдено ни одной строки-итога по месяцу.");
    const payload = rows.map((r) => ({ shop_id: shopId, ...r }));
    const { error } = await sb().from("monthly_reports").upsert(payload, { onConflict: "shop_id,year,month" });
    if (error) throw error;
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

    return skus.length;
  }

  async function saveAdsSpend(shopId, year, month, amount) {
    const { data: existing } = await sb()
      .from("monthly_reports").select("id").eq("shop_id", shopId).eq("year", year).eq("month", month).maybeSingle();
    if (existing) {
      const { error } = await sb().from("monthly_reports").update({ ads_spend: amount }).eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await sb().from("monthly_reports").insert({ shop_id: shopId, year, month, ads_spend: amount });
      if (error) throw error;
    }
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

  window.WBUpload = { uploadSummaryReport, uploadSalesReport, saveAdsSpend, saveCostPrice, listCosts };
})();
