import { createClient } from "jsr:@supabase/supabase-js@2";
import {articleKey,costCatalogue} from '../wb-api/articles.ts';
import {num,calculate,combine,readPages} from './calculations.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function fingerprint(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
    const telegramUsername = String(auth.user.user_metadata?.telegram_username || "").replace(/^@/, "").toLowerCase();
    if (telegramUsername !== "karlshott") return json({ error: "AI-анализ доступен только владельцу платформы" }, 403);

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
    const [reportResult, previousReportResult, sales, previousSales, costRows] = await Promise.all([
      client.from("monthly_reports").select("*").eq("shop_id", shopId).eq("year", year).eq("month", month).in("marketplace", marketplaces),
      client.from("monthly_reports").select("*").eq("shop_id", shopId).eq("year", prev.year).eq("month", prev.month).in("marketplace", marketplaces),
      readPages(()=>client.from("sku_sales").select("marketplace,article,name,bought_qty,revenue").eq("shop_id", shopId).eq("year", year).eq("month", month).in("marketplace", marketplaces).order('marketplace').order('article')),
      readPages(()=>client.from("sku_sales").select("marketplace,article,bought_qty,revenue").eq("shop_id", shopId).eq("year", prev.year).eq("month", prev.month).in("marketplace", marketplaces).order('marketplace').order('article')),
      readPages(()=>client.from("sku_costs").select("article,cost_price,updated_at").eq("shop_id", shopId).order('article')),
    ]);
    if (reportResult.error || previousReportResult.error) throw reportResult.error || previousReportResult.error;
    const reports=reportResult.data, previousReports=previousReportResult.data;
    if (!reports?.length) return json({ error: "За выбранный период нет данных для анализа" }, 404);
    const costs = new Map([...costCatalogue(costRows)].map(([key,row])=>[key,num(row.cost_price)]));
    const current = combine(reports.map((report) => calculate(report, (sales || []).filter((row) => row.marketplace === report.marketplace), costs, num(shop.tax_rate))));
    const previous = previousReports?.length ? combine(previousReports.map((report) => calculate(report, (previousSales || []).filter((row) => row.marketplace === report.marketplace), costs, num(shop.tax_rate)))) : null;
    const topProducts = [...(sales || [])].sort((a, b) => num(b.revenue) - num(a.revenue) || String(a.article).localeCompare(String(b.article))).slice(0, 8).map((row) => ({ marketplace: row.marketplace, article: row.article, name: row.name || row.article, units: num(row.bought_qty), revenue: num(row.revenue), gross_profit: num(row.revenue) - num(costs.get(articleKey(row.article))) * num(row.bought_qty) }));
    const analysisInput = { period: { year, month }, marketplace: scope, current, previous, top_products: topProducts };
    const sourceFingerprint = await fingerprint(analysisInput);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: cached, error: cacheReadError } = await admin.from("ai_analysis_cache").select("analysis").eq("shop_id", shopId).eq("marketplace_scope", scope).eq("year", year).eq("month", month).eq("source_fingerprint", sourceFingerprint).maybeSingle();
    if (cacheReadError) console.error("AI cache read failed", cacheReadError.message);
    if (cached?.analysis) return json({ analysis: cached.analysis, period: { year, month }, marketplace: scope, cached: true });

    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { Authorization: `Bearer ${openAiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_MODEL") || "gpt-5.6-terra", store: false,
        instructions: "Ты финансовый аналитик продавца на маркетплейсах. Отвечай по-русски, кратко и конкретно. Используй только переданные цифры, не выдумывай причины и данные. Сравнивай с прошлым месяцем только когда previous не null. net_profit уже включает себестоимость, налог, рекламу и ручные расходы. Предлагай действия, которые можно проверить по данным.",
        input: JSON.stringify(analysisInput),
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
    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("OpenAI error", aiResponse.status, errorText);
      let message = "Не удалось выполнить AI-анализ. Попробуйте позже";
      if (aiResponse.status === 401) message = "Ключ OpenAI недействителен. Проверьте OPENAI_API_KEY";
      if (aiResponse.status === 429 && /quota|billing|credits/i.test(errorText)) message = "Для OpenAI API нужно пополнить баланс в разделе Billing";
      if (aiResponse.status === 404 || /model.*(not found|does not exist)/i.test(errorText)) message = "Модель AI недоступна для этого проекта OpenAI";
      return json({ error: message }, 502);
    }
    const responseData = await aiResponse.json();
    const outputText = responseData.output?.flatMap((item: { content?: { type?: string; text?: string }[] }) => item.content || []).find((item: { type?: string }) => item.type === "output_text")?.text;
    if (!outputText) return json({ error: "AI не вернул результат анализа" }, 502);
    const analysis = JSON.parse(outputText);
    const { error: cacheWriteError } = await admin.from("ai_analysis_cache").upsert({ shop_id: shopId, marketplace_scope: scope, year, month, source_fingerprint: sourceFingerprint, analysis, updated_at: new Date().toISOString() }, { onConflict: "shop_id,marketplace_scope,year,month" });
    if (cacheWriteError) console.error("AI cache write failed", cacheWriteError.message);
    return json({ analysis, period: { year, month }, marketplace: scope, cached: false });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Ошибка анализа" }, 500);
  }
});
