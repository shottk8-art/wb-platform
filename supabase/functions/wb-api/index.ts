import { createClient } from "jsr:@supabase/supabase-js@2";
import { ApiError, PILOT_USER_ID, PILOT_SHOP_ID, keyInfo, upstreamError, validateKey, validatePeriod, validateShopId } from "./core.ts";
import { processPage } from './process.ts';
import { cabinetPeriod, processCabinetSource, readCabinet, readCabinetTrend, monthSettings } from './cabinet.ts';

const CONNECTION_COLUMNS = "seller_id,seller_name,expires_at,checked_at,next_request_at";
const JOB_COLUMNS = "id,date_from,date_to,cursor_id,status,summary,row_count,error_message,updated_at";
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
    // One-use, expiring capability issued only by private DB scheduler. Never
    // expose it to a browser or accept a public/anon key as worker authorization.
    if (req.headers.has('X-WB-Worker-Lease')) {
      if (origin) throw new ApiError(403, 'Доступ запрещён');
      const lease = validateShopId(req.headers.get('X-WB-Worker-Lease'));
      const text = await req.text();
      if (text.length > 1000) throw new ApiError(400, 'Некорректный запрос');
      let body;
      try { body = JSON.parse(text); } catch { throw new ApiError(400, 'Некорректный запрос'); }
      const jobId = validateShopId(body?.job_id);
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
      const { data: jobs, error } = await admin.rpc('wb_api_accept_lease', { p_job_id: jobId, p_lease: lease });
      if (error || !jobs?.[0]) throw new ApiError(403, 'Доступ запрещён');
      const job = jobs[0];
      try {
        const result = job.summary?.pilot && job.summary.pilot.stage !== 'finance'
          ? await processCabinetSource(admin, job, wbFetch)
          : await processPage(admin, job, job.shop_id, wbFetch);
        return json({ processed: true, ...result });
      } catch (e) {
        const message = e instanceof ApiError ? e.message : 'Ошибка фоновой загрузки';
        const limited = e instanceof ApiError && e.status === 429;
        const failures = Number(job.failure_count || 0) + (limited ? 0 : 1);
        const retryable = limited || (!(e instanceof ApiError && e.status === 400) && failures < 5);
        const seconds = limited ? e.retryAfter : Math.min(3600, 120 * 2 ** failures);
        await admin.from('wb_api_connections').update({ next_request_at: new Date(Date.now() + seconds * 1000).toISOString() }).eq('shop_id', job.shop_id);
        await admin.from('wb_api_preview_jobs').update({ status: retryable ? 'loading' : 'error', failure_count: failures, error_message: message, updated_at: new Date().toISOString() }).eq('id', jobId).eq('lease_token', lease);
        return json({ processed: false, retry_after: retryable ? seconds : 0 });
      } finally {
        await admin.from('wb_api_preview_jobs').update({ lease_token: null, lease_until: null, lease_used_at: null }).eq('id', jobId).eq('lease_token', lease);
      }
    }
    const authHeader = req.headers.get("Authorization") || "";
    if (!/^Bearer\s+\S+$/i.test(authHeader)) throw new ApiError(401, "Войдите в платформу");
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await userClient.auth.getUser();
    if (authError || !auth.user) throw new ApiError(401, "Сессия истекла. Войдите заново");
    if (auth.user.id !== PILOT_USER_ID) throw new ApiError(403, "API доступен только владельцу платформы");
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
      if (!data) return null;
      const { data: storedKey, error: keyError } = await admin.rpc("wb_api_read_key", { p_shop_id: shopId });
      if (keyError || !storedKey) throw new ApiError(500, "Не удалось прочитать тип подключения API");
      return { ...data, ...keyInfo(String(storedKey)) };
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
    if (body.action === 'cabinet_trend') {
      return json({ trend: await readCabinetTrend(admin, shopId) });
    }
    if (body.action === 'cabinet_settings') {
      if (shopId !== PILOT_SHOP_ID) throw new ApiError(403, 'API-кабинет доступен только для GREEN FLOW');
      const period = cabinetPeriod(body.month), settings = monthSettings(body);
      const { error } = await admin.from('wb_api_month_settings').upsert({shop_id:shopId,month:period.dateFrom,...settings,updated_at:new Date().toISOString()}, {onConflict:'shop_id,month'});
      if (error) throw new ApiError(500, 'Не удалось сохранить расходы месяца');
      return json({ cabinet: await readCabinet(admin, shopId, period) });
    }
    if (body.action === 'cabinet' || body.action === 'cabinet_start') {
      if (shopId !== PILOT_SHOP_ID) throw new ApiError(403, 'API-кабинет доступен только для GREEN FLOW');
      const period = cabinetPeriod(body.month);
      if (body.action === 'cabinet') return json({ cabinet: await readCabinet(admin, shopId, period) });
      if (!connection) throw new ApiError(400, 'Сначала подключите персональный ключ в настройках');
      const cabinet = await readCabinet(admin, shopId, period);
      if (cabinet.job?.status === 'loading' || (cabinet.complete && body.refresh !== true)) return json({ cabinet, cached: cabinet.complete });
      if (cabinet.job?.status === 'complete' && cabinet.finance && cabinet.sources.orders?.status === 'downloaded' && cabinet.sources.ads?.status === 'downloaded' && cabinet.sources.media?.status !== 'downloaded' && body.refresh !== true) {
        // Upgrade a saved month without downloading finance/orders/ads again.
        const { data: oldJob, error: readError } = await admin.from('wb_api_preview_jobs').select('summary').eq('id', cabinet.job.id).eq('shop_id', shopId).single();
        if (readError) throw new ApiError(500, 'Не удалось продолжить загрузку месяца');
        const summary = structuredClone(oldJob.summary);
        summary.pilot = { ...summary.pilot, stage: 'media_list', finance_complete: true };
        summary.api_sources = { ...summary.api_sources, media: { status: 'loading', date_from: period.dateFrom, date_to: period.dateTo, amount: null, campaign_ids: [], list_offset: 0 } };
        const { error } = await admin.from('wb_api_preview_jobs').update({summary,status:'loading',failure_count:0,error_message:null,updated_at:new Date().toISOString()}).eq('id',cabinet.job.id).eq('shop_id',shopId).eq('status','complete');
        if (error) throw new ApiError(500, 'Не удалось начать загрузку WB Медиа');
      } else if (cabinet.job?.status === 'error' && body.refresh !== true && cabinet.job.stage !== 'done') {
        const { error } = await admin.from('wb_api_preview_jobs').update({ status: 'loading', failure_count: 0, error_message: null }).eq('id', cabinet.job.id).eq('shop_id', shopId);
        if (error) throw new ApiError(500, 'Не удалось возобновить загрузку');
      } else {
        const { error } = await admin.from('wb_api_preview_jobs').insert({ shop_id: shopId, date_from: period.dateFrom, date_to: period.dateTo,
          summary: { pilot: { version: 2, stage: 'finance', orders_offset: 0 }, api_sources: {} } });
        if (error && error.code !== '23505') throw new ApiError(500, 'Не удалось начать загрузку');
      }
      return json({ cabinet: await readCabinet(admin, shopId, period), background: true });
    }
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
      if (existing?.[0] && !(body.refresh === true && existing[0].status === "complete")) {
        if (existing[0].status === 'error') {
          await admin.from('wb_api_preview_jobs').update({ status: 'loading', failure_count: 0, error_message: null }).eq('id', existing[0].id).eq('shop_id', shopId);
          return json({ job: await readJob(existing[0].id) });
        }
        return json({ job: existing[0], cached: existing[0].status === "complete" });
      }
      const { data, error } = await admin.from("wb_api_preview_jobs").insert({ shop_id: shopId, date_from: period.dateFrom, date_to: period.dateTo }).select(JOB_COLUMNS).single();
      if (error?.code === '23505') {
        const { data: active } = await admin.from('wb_api_preview_jobs').select(JOB_COLUMNS).eq('shop_id', shopId).eq('date_from', period.dateFrom).eq('date_to', period.dateTo).eq('status', 'loading').limit(1);
        if (active?.[0]) return json({ job: active[0] });
      }
      if (error) throw new ApiError(500, "Не удалось создать тестовую загрузку");
      return json({ job: data });
    }
    if (body.action !== "preview_step") throw new ApiError(400, "Неизвестное действие");
    const jobId = validateShopId(body.job_id);
    const job = await readJob(jobId);
    if (job.status === "complete") return json({ job, cached: true });
    // Compatibility for an already open old frontend: status only. It must not
    // compete with the server worker for the seller's quota or advance a cursor.
    return json({ job, background: true, retry_after: Math.max(15, Math.ceil((Date.parse(connection.next_request_at) - Date.now()) / 1000)) });
  } catch (e) {
    // No error objects / request bodies in logs: this endpoint handles credentials.
    return json({ error: e instanceof ApiError ? e.message : "Ошибка подключения API. Попробуйте позже", retry_after: e instanceof ApiError ? e.retryAfter : 0 }, e instanceof ApiError ? e.status : 500);
  }
});
