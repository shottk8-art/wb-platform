import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

function calculate(report: Record<string, unknown>, sales: Record<string, unknown>[], costs: Map<string, number>, taxRate: number) {
  const cogs = sales.reduce((sum, row) => sum + num(costs.get(String(row.article))) * num(row.bought_qty), 0);
  const salesAmount = num(report.sales_amount);
  const ads = num(report.ads_spend);
  const tax = salesAmount * taxRate / 100;
  const manual = num(report.operational_expenses) + num(report.external_promotion_expenses);
  const netProfit = num(report.transfer_total) - ads - cogs - tax - manual;
  return {
    sales: salesAmount, orders: num(report.orders_amount), bought_qty: num(report.bought_qty),
    transfer: num(report.transfer_total), commission: salesAmount - num(report.transfer_goods),
    delivery: num(report.delivery_cost), storage: num(report.storage_cost), fines: num(report.fines),
    acceptance: num(report.acceptance_ops), other_fees: num(report.other_fees), ads,
    promo_bonuses: num(report.ads_promo_spend), operational_expenses: num(report.operational_expenses),
    external_promotion: num(report.external_promotion_expenses), cogs, tax, net_profit: netProfit,
    margin_percent: salesAmount ? netProfit / salesAmount * 100 : 0,
    ad_share_of_sales: salesAmount ? ads / salesAmount * 100 : 0,
  };
}

function combine(items: ReturnType<typeof calculate>[]) {
  const result: Record<string, number> = {};
  for (const item of items) for (const [key, value] of Object.entries(item)) {
    if (key !== "margin_percent" && key !== "ad_share_of_sales") result[key] = (result[key] || 0) + value;
  }
  result.margin_percent = result.sales ? result.net_profit / result.sales * 100 : 0;
  result.ad_share_of_sales = result.sales ? result.ads / result.sales * 100 : 0;
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Не авторизован" }, 401);
    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openAiKey) return json({ error: "AI-анализ пока не настроен администратором" }, 503);
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user) return json({ error: "Не авторизован" }, 401);

    const body = await req.json();
    const shopId = typeof body.shop_id === "string" ? body.shop_id : "";
    const year = Number(body.year), month = Number(body.month);
    const scope = ["wildberries", "ozon", "all"].includes(body.marketplace) ? body.marketplace : "";
    if (!shopId || !Number.isInteger(year) || year < 2020 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12 || !scope) return json({ error: "Некорректные параметры анализа" }, 400);

    const { data: shop, error: shopError } = await client.from("shops").select("id,tax_rate").eq("id", shopId).maybeSingle();
    if (shopError || !shop) return json({ error: "Магазин не найден или доступ запрещён" }, 403);
    const marketplaces = scope === "all" ? ["wildberries", "ozon"] : [scope];
    const prevDate = new Date(Date.UTC(year, month - 2, 1));
    const prev = { year: prevDate.getUTCFullYear(), month: prevDate.getUTCMonth() + 1 };
    const [{ data: reports, error: e1 }, { data: previousReports, error: e2 }, { data: sales, error: e3 }, { data: previousSales, error: e4 }, { data: costRows, error: e5 }] = await Promise.all([
      client.from("monthly_reports").select("*").eq("shop_id", shopId).eq("year", year).eq("month", month).in("marketplace", marketplaces),
      client.from("monthly_reports").select("*").eq("shop_id", shopId).eq("year", prev.year).eq("month", prev.month).in("marketplace", marketplaces),
      client.from("sku_sales").select("marketplace,article,name,bought_qty,revenue").eq("shop_id", shopId).eq("year", year).eq("month", month).in("marketplace", marketplaces),
      client.from("sku_sales").select("marketplace,article,bought_qty,revenue").eq("shop_id", shopId).eq("year", prev.year).eq("month", prev.month).in("marketplace", marketplaces),
      client.from("sku_costs").select("article,cost_price").eq("shop_id", shopId),
    ]);
    if (e1 || e2 || e3 || e4 || e5) throw e1 || e2 || e3 || e4 || e5;
    if (!reports?.length) return json({ error: "За выбранный период нет данных для анализа" }, 404);
    const costs = new Map((costRows || []).map((row) => [String(row.article), num(row.cost_price)]));
    const current = combine(reports.map((report) => calculate(report, (sales || []).filter((row) => row.marketplace === report.marketplace), costs, num(shop.tax_rate))));
    const previous = previousReports?.length ? combine(previousReports.map((report) => calculate(report, (previousSales || []).filter((row) => row.marketplace === report.marketplace), costs, num(shop.tax_rate)))) : null;
    const topProducts = [...(sales || [])].sort((a, b) => num(b.revenue) - num(a.revenue)).slice(0, 8).map((row) => ({ marketplace: row.marketplace, article: row.article, name: row.name || row.article, units: num(row.bought_qty), revenue: num(row.revenue), gross_profit: num(row.revenue) - num(costs.get(String(row.article))) * num(row.bought_qty) }));

    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { Authorization: `Bearer ${openAiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_MODEL") || "gpt-6-astra", store: false,
        instructions: "Ты финансовый аналитик продавца на маркетплейсах. Отвечай по-русски, кратко и конкретно. Используй только переданные цифры, не выдумывай причины и данные. Сравнивай с прошлым месяцем только когда previous не null. net_profit уже включает себестоимость, налог, рекламу и ручные расходы. Предлагай действия, которые можно проверить по данным.",
        input: JSON.stringify({ period: { year, month }, marketplace: scope, current, previous, top_products: topProducts }),
        text: { format: { type: "json_schema", name: "seller_analysis", strict: true, schema: {
          type: "object", additionalProperties: false,
          properties: {
            summary: { type: "string" }, health: { type: "string", enum: ["positive", "attention", "critical", "neutral"] },
            insights: { type: "array", maxItems: 4, items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, detail: { type: "string" }, tone: { type: "string", enum: ["positive", "warning", "neutral"] } }, required: ["title", "detail", "tone"] } },
            actions: { type: "array", maxItems: 4, items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, detail: { type: "string" }, priority: { type: "string", enum: ["high", "medium", "low"] } }, required: ["title", "detail", "priority"] } },
            caveats: { type: "array", maxItems: 3, items: { type: "string" } },
          }, required: ["summary", "health", "insights", "actions", "caveats"],
        } } },
      }),
    });
    if (!aiResponse.ok) { console.error("OpenAI error", aiResponse.status, await aiResponse.text()); return json({ error: "Не удалось выполнить AI-анализ. Попробуйте позже" }, 502); }
    const responseData = await aiResponse.json();
    const outputText = responseData.output?.flatMap((item: { content?: { type?: string; text?: string }[] }) => item.content || []).find((item: { type?: string }) => item.type === "output_text")?.text;
    if (!outputText) return json({ error: "AI не вернул результат анализа" }, 502);
    return json({ analysis: JSON.parse(outputText), period: { year, month }, marketplace: scope });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Ошибка анализа" }, 500);
  }
});
