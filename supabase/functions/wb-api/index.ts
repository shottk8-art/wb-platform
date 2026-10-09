import { createClient } from "jsr:@supabase/supabase-js@2";
import { ApiError, FINANCE_FIELDS, PILOT_USER_ID, sanitizeRows, summarize, upstreamError, validateKey, validatePeriod, validateShopId } from "./core.ts";

const CONNECTION_COLUMNS = "seller_id,seller_name,expires_at,checked_at,next_request_at";
const JOB_COLUMNS = "id,date_from,date_to,cursor_id,status,summary,error_message,updated_at";
const PAGE_SIZE = 10000;
const allowedOrigins = new Set(["https://wb-platform.netlify.app", "http://127.0.0.1:3000", "http://localhost:3000"]);

async function wbFetch(token: string, url: string, body?: unknown) {
  let response: Response;
  try {
    response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(25000), redirect: "error",
    });
  } catch { throw new ApiError(502, "Не удалось связаться с WB. Попробуйте позже"); }
  if (!response.ok) {
    // Never return or log upstream bodies: they can contain credentials / PII.
    const retry = Number(response.headers.get("X-Ratelimit-Retry") || response.headers.get("Retry-After")) || 63;
    await response.body?.cancel();
    throw upstreamError(response.status, retry);
  }
  if (response.status === 204) return null;
  try { return await response.json(); } catch { throw new ApiError(502, "Не удалось прочитать ответ WB"); }
}
async function verifyConnection(token: string) {
  const seller = await wbFetch(token, "https://common-api.wildberries.ru/api/v1/seller-info");
  if (!seller || typeof seller.sid !== "string" || typeof seller.name !== "string") throw new ApiError(502, "WB не вернул данные продавца");
  await wbFetch(token, "https://finance-api.wildberries.ru/ping");
  return { seller_id: seller.sid, seller_name: String(seller.tradeMark || seller.name).slice(0, 300) };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const cors = {
    ...(origin && allowedOrigins.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin",
    "Cache-Control": "no-store", "Content-Type": "application/json",
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
  if (origin && !allowedOrigins.has(origin)) return json({ error: "Доступ запрещён" }, 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Метод не поддерживается" }, 405);
  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!/^Bearer\s+\S+$/i.test(authHeader)) throw new ApiError(401, "Войдите в платформу");
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await userClient.auth.getUser();
    if (authError || !auth.user) throw new ApiError(401, "Сессия истекла. Войдите заново");
    if (auth.user.id !== PILOT_USER_ID) throw new ApiError(403, "Тест API доступен только владельцу платформы");
    const requestText = await req.text();
    if (requestText.length > 16000) throw new ApiError(400, "Слишком большой запрос");
    let body;
    try { body = JSON.parse(requestText); } catch { throw new ApiError(400, "Некорректный запрос"); }
    if (!body || typeof body !== "object") throw new ApiError(400, "Некорректный запрос");
    const shopId = validateShopId(body.shop_id);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: shop, error: shopError } = await admin.from("shops").select("id,owner_id").eq("id", shopId).eq("owner_id", auth.user.id).maybeSingle();
    if (shopError || !shop) throw new ApiError(403, "Магазин не найден или вы не его владелец");

    const readConnection = async () => {
      const { data, error } = await admin.from("wb_api_connections").select(CONNECTION_COLUMNS).eq("shop_id", shopId).maybeSingle();
      if (error) throw new ApiError(500, "Не удалось прочитать настройки API");
      return data;
    };
    const readJob = async (jobId: string) => {
      const { data, error } = await admin.from("wb_api_preview_jobs").select(JOB_COLUMNS).eq("id", jobId).eq("shop_id", shopId).maybeSingle();
      if (error || !data) throw new ApiError(404, "Тестовый отчёт не найден в этом магазине");
      return data;
    };
    const claim = async (kind: string) => {
      const { data, error } = await admin.rpc("wb_api_claim_request", { p_shop_id: shopId, p_kind: kind });
      if (error) throw new ApiError(500, "Не удалось начать запрос к WB");
      return Number(data) || 0;
    };
    const key = async () => {
      const { data, error } = await admin.rpc("wb_api_read_key", { p_shop_id: shopId });
      if (error || !data) throw new ApiError(400, "Сначала подключите API магазина");
      return String(data);
    };
    const connection = await readConnection();
    if (body.action === "status") {
      const { data: jobs, error } = await admin.from("wb_api_preview_jobs").select(JOB_COLUMNS).eq("shop_id", shopId).order("created_at", { ascending: false }).limit(1);
      if (error) throw new ApiError(500, "Не удалось прочитать статус загрузки");
      return json({ connection, job: jobs?.[0] || null });
    }
    if (body.action === "connect") {
      const { token, expiresAt } = validateKey(body.api_key);
      if (connection) {
        const wait = await claim("check");
        if (wait) throw new ApiError(429, "Повторите проверку чуть позже", wait);
      }
      const seller = await verifyConnection(token);
      if (connection && connection.seller_id !== seller.seller_id) throw new ApiError(409, "Это ключ другого продавца. Сначала отключите текущее подключение");
      const { error } = await admin.rpc("wb_api_save_key", { p_shop_id: shopId, p_key: token, p_seller_id: seller.seller_id, p_seller_name: seller.seller_name, p_expires_at: expiresAt });
      if (error) throw new ApiError(error.code === "23505" ? 409 : 500, error.code === "23505" ? "Этот продавец WB уже подключён к другому магазину платформы" : "Не удалось сохранить ключ");
      return json({ connection: await readConnection() });
    }
    if (!connection) throw new ApiError(400, "Сначала подключите API магазина");
    if (body.action === "check") {
      const wait = await claim("check");
      if (wait) throw new ApiError(429, "Повторите проверку чуть позже", wait);
      const seller = await verifyConnection(await key());
      if (seller.seller_id !== connection.seller_id) throw new ApiError(409, "Продавец WB изменился. Подключите ключ заново");
      const { error } = await admin.from("wb_api_connections").update({ checked_at: new Date().toISOString(), seller_name: seller.seller_name }).eq("shop_id", shopId);
      if (error) throw new ApiError(500, "Не удалось сохранить статус проверки");
      return json({ connection: await readConnection() });
    }
    if (body.action === "disconnect") {
      const { error } = await admin.from("wb_api_connections").delete().eq("shop_id", shopId);
      if (error) throw new ApiError(500, "Не удалось отключить API");
      return json({ connection: null, job: null });
    }
    if (body.action === "preview_start") {
      const period = validatePeriod(body.date_from, body.date_to);
      const { data: existing, error: existingError } = await admin.from("wb_api_preview_jobs").select(JOB_COLUMNS)
        .eq("shop_id", shopId).eq("date_from", period.dateFrom).eq("date_to", period.dateTo).order("created_at", { ascending: false }).limit(1);
      if (existingError) throw new ApiError(500, "Не удалось проверить прошлую загрузку");
      if (existing?.[0] && !(body.refresh === true && existing[0].status === "complete")) return json({ job: existing[0], cached: existing[0].status === "complete" });
      const { data, error } = await admin.from("wb_api_preview_jobs").insert({ shop_id: shopId, date_from: period.dateFrom, date_to: period.dateTo }).select(JOB_COLUMNS).single();
      if (error) throw new ApiError(500, "Не удалось создать тестовую загрузку");
      return json({ job: data });
    }
    if (body.action !== "preview_step") throw new ApiError(400, "Неизвестное действие");
    const jobId = validateShopId(body.job_id);
    const job = await readJob(jobId);
    if (job.status === "complete") return json({ job, cached: true });
    const wait = await claim("finance");
    if (wait) return json({ job, retry_after: wait });
    try {
      const response = await wbFetch(await key(), "https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed", {
        dateFrom: job.date_from, dateTo: `${job.date_to}T23:59:59`, limit: PAGE_SIZE,
        rrdId: Number(job.cursor_id), period: "weekly", fields: FINANCE_FIELDS,
      });
      const rows = sanitizeRows(response || []);
      let cursor = BigInt(job.cursor_id);
      for (const row of rows) if (BigInt(String(row.rrdId)) > cursor) cursor = BigInt(String(row.rrdId));
      if (rows.length && cursor <= BigInt(job.cursor_id)) throw new ApiError(502, "WB не продвинул страницу отчёта. Повторите загрузку позже");
      for (let offset = 0; offset < rows.length; offset += 500) {
        const { error } = await admin.from("wb_api_preview_rows").upsert(rows.slice(offset, offset + 500).map((row) => ({ job_id: jobId, rrd_id: row.rrdId, payload: row })), { onConflict: "job_id,rrd_id" });
        if (error) throw new ApiError(500, "Не удалось сохранить страницу тестового отчёта");
      }
      const { count, error: countError } = await admin.from("wb_api_preview_rows").select("rrd_id", { count: "exact", head: true }).eq("job_id", jobId);
      if (countError) throw new ApiError(500, "Не удалось проверить объём отчёта");
      if ((count || 0) > 300000) throw new ApiError(400, "Для теста слишком много операций. Выберите более короткий период");
      // Only 204/empty completes a report. A short page is not proof of completeness.
      let summary = null;
      if (!rows.length) {
        const allRows = [];
        for (let offset = 0; offset < (count || 0); offset += 1000) {
          const { data, error } = await admin.from("wb_api_preview_rows").select("payload").eq("job_id", jobId).order("rrd_id").range(offset, offset + 999);
          if (error) throw new ApiError(500, "Не удалось прочитать тестовый отчёт");
          allRows.push(...(data || []).map((item) => item.payload));
        }
        summary = summarize(allRows);
      }
      const { error } = await admin.from("wb_api_preview_jobs").update({
        cursor_id: cursor.toString(), status: rows.length ? "loading" : "complete", summary,
        error_message: null, updated_at: new Date().toISOString(),
      }).eq("id", jobId).eq("shop_id", shopId);
      if (error) throw new ApiError(500, "Не удалось сохранить прогресс загрузки");
      return json({ job: await readJob(jobId), row_count: count || 0, retry_after: rows.length ? 63 : 0 });
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Ошибка тестовой загрузки";
      if (e instanceof ApiError && e.status === 429) {
        await admin.from("wb_api_connections").update({ next_request_at: new Date(Date.now() + e.retryAfter * 1000).toISOString() }).eq("shop_id", shopId);
        return json({ job: await readJob(jobId), retry_after: e.retryAfter });
      }
      await admin.from("wb_api_preview_jobs").update({ status: "error", error_message: message, updated_at: new Date().toISOString() }).eq("id", jobId).eq("shop_id", shopId);
      throw e;
    }
  } catch (e) {
    // No error objects / request bodies in logs: this endpoint handles credentials.
    return json({ error: e instanceof ApiError ? e.message : "Ошибка подключения API. Попробуйте позже", retry_after: e instanceof ApiError ? e.retryAfter : 0 }, e instanceof ApiError ? e.status : 500);
  }
});
