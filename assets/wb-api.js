(function () {
  const el = (id) => document.getElementById(id);
  let context = null;
  let generation = 0;
  let connection = null;
  let job = null;
  let busy = false;
  let timer = null;
  const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (value) => Number(value || 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";
  const date = (value) => value ? new Date(value).toLocaleString("ru-RU") : "—";

  async function request(action, payload, ctx) {
    const session = await window.WBAuth.getSession();
    if (!session) throw new Error("Сессия истекла. Войдите заново");
    let response;
    try {
      response = await fetch(window.WB_CONFIG.SUPABASE_URL + "/functions/v1/wb-api", {
        method: "POST", cache: "no-store",
        headers: { Authorization: "Bearer " + session.access_token, apikey: window.WB_CONFIG.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ action, shop_id: ctx.shopId, ...payload }), signal: AbortSignal.timeout(55000),
      });
    } catch { throw new Error("Не удалось связаться с сервером. Проверьте интернет и попробуйте ещё раз"); }
    let data;
    try { data = await response.json(); } catch { throw new Error("Сервер не вернул результат проверки"); }
    if (!response.ok) {
      const error = new Error(data.error || "Не удалось выполнить запрос");
      error.retryAfter = Number(data.retry_after) || 0;
      throw error;
    }
    return data;
  }
  function message(text, error = false) {
    el("wbApiMessage").textContent = text;
    el("wbApiMessage").dataset.tone = error ? "error" : "neutral";
  }
  function render() {
    const samePeriod = job && job.date_from === el("wbApiDateFrom").value && job.date_to === el("wbApiDateTo").value;
    el("wbApiConnectBtn").disabled = busy || !el("wbApiKey").value.trim();
    el("wbApiCheckBtn").disabled = busy || !connection;
    el("wbApiDisconnectBtn").disabled = busy || !connection;
    el("wbApiPreviewBtn").disabled = busy || !connection;
    el("wbApiKey").disabled = busy;
    el("wbApiDateFrom").disabled = busy;
    el("wbApiDateTo").disabled = busy;
    el("wbApiCheckBtn").hidden = !connection;
    el("wbApiDisconnectBtn").hidden = !connection;
    el("wbApiConnectBtn").textContent = connection ? "Заменить ключ и проверить" : "Сохранить и проверить";
    const status = el("wbApiConnectionStatus");
    status.textContent = connection
      ? `Подключён продавец WB: ${connection.seller_name}. Проверено: ${date(connection.checked_at)}${connection.expires_at ? `. Ключ действует до ${date(connection.expires_at)}` : ""}`
      : "API ещё не подключён к этому магазину";
    status.dataset.connected = connection ? "true" : "false";
    el("wbApiPreviewResult").hidden = !(samePeriod && job.status === "complete");
    el("wbApiPreviewBtn").textContent = samePeriod && job.status !== "complete" ? "Продолжить загрузку" : "Загрузить тестовый отчёт";
    if (job?.status === "complete") {
      const summary = job.summary || { row_count: 0, totals: {}, deductions: [] };
      el("wbApiPreviewCaption").textContent = `${job.date_from} — ${job.date_to} · ${Number(summary.row_count).toLocaleString("ru-RU")} операций · ${date(job.updated_at)}`;
      const fields = [
        ["retailAmount", "Продажи по финансовому отчёту"], ["forPay", "К перечислению за товар"],
        ["deliveryService", "Логистика"], ["paidStorage", "Хранение"], ["paidAcceptance", "Приёмка"],
        ["penalty", "Штрафы"], ["cashbackAmount", "Баллы / кешбэк по API"],
        ["cashbackCommissionChange", "Комиссия программы лояльности"],
        ["cashbackDiscount", "Компенсация скидки по лояльности"], ["deduction", "Прочие удержания, включая рекламу"],
      ];
      el("wbApiPreviewTotals").innerHTML = fields.map(([key, label]) => `<div class="wb-api-total"><span>${label}</span><strong>${esc(money(summary.totals[key]))}</strong></div>`).join("");
      el("wbApiDeductions").innerHTML = summary.deductions.length
        ? summary.deductions.map((item) => `<li><span>${esc(item.label)}</span><strong>${esc(money(item.amount))}</strong></li>`).join("")
        : '<li><span>В ответе API нет строк прочих удержаний</span></li>';
    }
  }
  async function step(ctx, epoch) {
    if (epoch !== generation || !job || job.status === "complete") return;
    busy = true;
    render();
    message("Получаем финансовые операции из WB…");
    try {
      const result = await request("preview_step", { job_id: job.id }, ctx);
      if (epoch !== generation) return;
      job = result.job;
      if (job.status === "complete") {
        message(job.summary?.row_count ? "Тестовый отчёт получен. Данные дашборда не изменены." : "WB не вернул операции за выбранный период. Данные дашборда не изменены.");
      } else {
        const seconds = Math.max(1, Number(result.retry_after) || 63);
        const count = result.row_count;
        message(`${count !== undefined ? `Получено ${Number(count).toLocaleString("ru-RU")} операций. ` : ""}Следующий запрос через ${seconds} сек. — соблюдаем лимит WB. Не закрывайте страницу для продолжения.`);
        timer = setTimeout(() => step(ctx, epoch), seconds * 1000);
      }
    } catch (error) {
      if (epoch === generation) message(error.message, true);
    } finally {
      if (epoch === generation) { busy = false; render(); }
    }
  }
  async function run(action, payload = {}) {
    if (busy || !context?.allowed) return;
    clearTimeout(timer);
    const epoch = ++generation, ctx = { ...context };
    busy = true;
    render();
    message(action === "connect" || action === "check" ? "Проверяем ключ и доступ к финансовым отчётам WB…" : "Загружаем…");
    try {
      const result = await request(action, payload, ctx);
      if (epoch !== generation) return;
      if ("connection" in result) connection = result.connection;
      if ("job" in result) job = result.job;
      message(action === "disconnect" ? "API отключён. Загруженные вручную данные не изменены." : action === "preview_start" && result.cached ? "Показан ранее полученный тестовый отчёт. Новый запрос в WB не выполнялся." : "Ключ проверен, доступ к финансам подтверждён.");
      if (action === "preview_start" && job?.status !== "complete") {
        busy = false;
        await step(ctx, epoch);
      }
    } catch (error) {
      if (epoch === generation) message(error.message + (error.retryAfter ? ` Повторите через ${error.retryAfter} сек.` : ""), true);
    } finally {
      if (epoch === generation) { busy = false; render(); }
    }
  }
  async function setContext(next) {
    if (context?.shopId === next.shopId && context?.allowed === next.allowed) return;
    context = { ...next };
    const epoch = ++generation;
    clearTimeout(timer);
    connection = null;
    job = null;
    busy = false;
    el("wbApiKey").value = "";
    el("secWbApi").hidden = !next.allowed;
    el("wbApiShopName").textContent = next.name;
    message("");
    render();
    if (!next.allowed) return;
    busy = true;
    render();
    try {
      const result = await request("status", {}, next);
      if (epoch !== generation) return;
      connection = result.connection;
      job = result.job;
      if (job && job.status !== "complete") {
        el("wbApiDateFrom").value = job.date_from;
        el("wbApiDateTo").value = job.date_to;
      }
      if (job?.status === "loading") message("Есть незавершённая тестовая загрузка. Нажмите «Продолжить загрузку».");
      if (job?.status === "error") message(job.error_message || "Прошлая загрузка прервалась. Можно продолжить.", true);
    } catch (error) { if (epoch === generation) message(error.message, true); }
    finally { if (epoch === generation) { busy = false; render(); } }
  }

  el("wbApiKey").addEventListener("input", render);
  el("wbApiDateFrom").addEventListener("change", render);
  el("wbApiDateTo").addEventListener("change", render);
  el("wbApiConnectBtn").addEventListener("click", () => {
    const api_key = el("wbApiKey").value.trim();
    el("wbApiKey").value = "";
    if (api_key) run("connect", { api_key });
  });
  el("wbApiCheckBtn").addEventListener("click", () => run("check"));
  el("wbApiDisconnectBtn").addEventListener("click", () => {
    if (confirm(`Отключить API от магазина «${context.name}»? Ключ и тестовые выгрузки будут удалены. Данные дашборда и загруженные файлы останутся.`)) run("disconnect");
  });
  el("wbApiPreviewBtn").addEventListener("click", () => run("preview_start", { date_from: el("wbApiDateFrom").value, date_to: el("wbApiDateTo").value }));
  const now = new Date(), closed = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const y = closed.getFullYear(), m = String(closed.getMonth() + 1).padStart(2, "0");
  el("wbApiDateFrom").value = `${y}-${m}-01`;
  el("wbApiDateTo").value = `${y}-${m}-${new Date(y, closed.getMonth() + 1, 0).getDate()}`;
  const max = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  for (const id of ["wbApiDateFrom", "wbApiDateTo"]) { el(id).min = "2024-01-29"; el(id).max = max; }
  window.WBApi = { setContext };
})();
