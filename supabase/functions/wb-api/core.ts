// The pilot is pinned to an immutable auth ID, not editable user_metadata.
export const PILOT_USER_ID = "bbb002c4-cd7a-490d-b9c0-72aed5424261";
export const PILOT_SHOP_ID = "63175e7a-5b26-425e-893f-68889b32f02f";
export const FINANCE_FIELDS = [
  "rrdId", "reportId", "dateFrom", "dateTo", "currency", "docTypeName", "sellerOperName",
  "saleDt", "rrDate", "retailAmount", "forPay", "deliveryService", "paidStorage", "paidAcceptance", "penalty",
  "deduction", "bonusTypeName", "cashbackAmount", "cashbackDiscount", "cashbackCommissionChange",
  "nmId", "vendorCode", "title", "quantity", "retailPriceWithDisc", "additionalPayment",
  "rebillLogisticCost", "ppvzSalesCommission", "ppvzReward", "acquiringFee", "vw", "vwNds",
  "installmentCofinancingAmount", "paymentSchedule", "reportType",
];

export class ApiError extends Error {
  status: number;
  retryAfter: number;
  constructor(status: number, message: string, retryAfter = 0) {
    super(message); this.status = status; this.retryAfter = retryAfter;
  }
}
export function validateShopId(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new ApiError(400, "Выберите магазин");
  return value;
}
export function validatePeriod(from: unknown, to: unknown, now = new Date()) {
  const parse = (value: unknown) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ApiError(400, "Укажите даты отчёта");
    const date = new Date(value + "T00:00:00Z");
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new ApiError(400, "Некорректная дата");
    return date;
  };
  const start = parse(from), end = parse(to);
  const today = new Date(now.getTime() + 3 * 3600000).toISOString().slice(0, 10);
  if (start > end || String(from) < "2024-01-29" || String(to) > today) throw new ApiError(400, "Выберите период с 29 января 2024 года, без будущих дат");
  return { dateFrom: String(from), dateTo: String(to) };
}
export function validateKey(value: unknown) {
  if (typeof value !== "string") throw new ApiError(400, "Введите API-ключ WB");
  const token = value.trim().replace(/^Bearer\s+/i, "");
  if (token.length < 100 || token.length > 10000 || !/^[A-Za-z0-9_.-]+$/.test(token)) throw new ApiError(400, "Проверьте API-ключ: вставьте токен целиком, без пробелов");
  let expiresAt: string | null = null;
  // Claims are only local validation/UX. WB authenticates the actual token.
  try {
    const part = token.split(".")[1];
    const payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=")));
    if (payload.t === true || payload.acc === 2) throw new ApiError(400, "Нужен рабочий токен магазина, не тестовый токен песочницы");
    if (Number.isFinite(payload.exp)) {
      if (payload.exp * 1000 <= Date.now()) throw new ApiError(400, "Срок действия ключа истёк. Создайте новый токен в WB");
      expiresAt = new Date(payload.exp * 1000).toISOString();
    }
    if (payload.acc !== 3) throw new ApiError(400, "Для личного подключения нужен персональный ключ WB. Создайте его для своего магазина с категорией «Финансы»");
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(400, "Не удалось распознать персональный ключ WB. Вставьте токен целиком");
  }
  return { token, expiresAt };
}
// Only non-sensitive metadata is returned to the UI; never return JWT claims.
export function keyInfo(token: string) {
  try {
    const part = token.split(".")[1];
    const payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=")));
    if (payload.acc === 3 && payload.t !== true) return { key_type: "personal", finance_interval_seconds: 60 };
  } catch { /* A legacy/unrecognized key must not be described as personal. */ }
  return { key_type: "unknown", finance_interval_seconds: null };
}
export function upstreamError(status: number, retryAfter: number) {
  if (status === 401) return new ApiError(400, "WB отклонил ключ. Проверьте токен и срок его действия");
  if (status === 403) return new ApiError(400, "Нет доступа к этому методу WB. Для отчётов включите категорию «Финансы»");
  if (status === 402) return new ApiError(400, "WB требует оплату доступа к API. Проверьте условия в кабинете WB");
  if (status === 429) return new ApiError(429, "Лимит запросов WB. Загрузка продолжится после ожидания", Math.max(63, retryAfter));
  if (status === 400) return new ApiError(502, "WB отклонил параметры отчёта. Попробуйте другой период");
  return new ApiError(502, "WB временно недоступен. Попробуйте позже");
}
export function sanitizeRows(rows: unknown) {
  if (!Array.isArray(rows)) throw new ApiError(502, "WB вернул неожиданный формат отчёта");
  const unique = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (!row || typeof row !== "object") throw new ApiError(502, "WB вернул некорректную строку");
    // Do not silently round financial row IDs; otherwise pagination/dedup breaks.
    const id = row.rrdId;
    if ((typeof id === "number" && !Number.isSafeInteger(id)) || !/^\d+$/.test(String(id)) || BigInt(id) <= 0n || BigInt(id) > BigInt(Number.MAX_SAFE_INTEGER)) throw new ApiError(502, "Не удалось прочитать ID финансовой операции WB");
    if (row.currency && row.currency !== "RUB" && row.currency !== "руб") throw new ApiError(502, "В тесте поддерживаются только отчёты в рублях");
    const safe: Record<string, unknown> = {};
    for (const key of FINANCE_FIELDS) if (key in row) safe[key] = row[key];
    safe.rrdId = String(id);
    unique.set(String(id), safe);
  }
  return [...unique.values()];
}
export function pageCursor(rows: Record<string, unknown>[], previous: string) {
  if (!rows.length) return previous;
  let last = 0n;
  for (const row of rows) {
    const id = BigInt(String(row.rrdId));
    // Staging/bootstrap use ordered IDs. Stop rather than silently skipping a
    // non-monotonic page. Duplicate boundary IDs are handled by the caller.
    if (id < last) throw new ApiError(400, "WB вернул операции не по порядку. Загрузка остановлена, чтобы не пропустить данные");
    last = id;
  }
  if (last <= BigInt(previous)) throw new ApiError(502, "WB не продвинул страницу отчёта. Проверьте загрузку позже");
  return String(last); // WB contract: ID of the LAST row, not the maximum ID.
}
export function cents(value: unknown) {
  if (value === null || value === undefined || value === "") return 0n;
  const match = String(value).match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new ApiError(502, "WB вернул некорректную денежную сумму");
  return (match[1] ? -1n : 1n) * (BigInt(match[2]) * 100n + BigInt((match[3] || "").padEnd(2, "0")));
}
export function rub(value: bigint) {
  const negative = value < 0n, abs = negative ? -value : value;
  return `${negative ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}
export function summarize(rows: Record<string, unknown>[]) {
  const totals: Record<string, bigint> = {};
  const deductions = new Map<string, { amount: bigint; count: number }>();
  for (const row of rows) {
    const sign = String(row.docTypeName || "").toLowerCase() === "возврат" ? -1n : 1n;
    for (const key of ["retailAmount", "forPay", "deliveryService", "paidStorage", "paidAcceptance", "penalty", "deduction", "cashbackAmount", "cashbackDiscount", "cashbackCommissionChange"]) {
      const signed = ["retailAmount", "forPay", "cashbackAmount", "cashbackDiscount", "cashbackCommissionChange"].includes(key);
      totals[key] = (totals[key] || 0n) + cents(row[key]) * (signed ? sign : 1n);
    }
    const amount = cents(row.deduction);
    if (amount) {
      const label = String(row.bonusTypeName || row.sellerOperName || "Без пояснения WB").slice(0, 500);
      const existing = deductions.get(label) || { amount: 0n, count: 0 };
      deductions.set(label, { amount: existing.amount + amount, count: existing.count + 1 });
    }
  }
  return {
    row_count: rows.length,
    totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, rub(value)])),
    deductions: [...deductions].map(([label, value]) => ({ label, amount: rub(value.amount), count: value.count })),
  };
}

// Merge page totals in integer kopecks, without retaining the full history in memory.
export function mergeSummaries(previous: any, page: any) {
  if (!previous) return page;
  const keys = new Set([...Object.keys(previous.totals || {}), ...Object.keys(page.totals || {})]);
  const deductions = new Map<string, { amount: bigint; count: number }>();
  for (const item of [...(previous.deductions || []), ...(page.deductions || [])]) {
    const old = deductions.get(item.label) || { amount: 0n, count: 0 };
    deductions.set(item.label, { amount: old.amount + cents(item.amount), count: old.count + item.count });
  }
  return {
    row_count: (previous.row_count || 0) + (page.row_count || 0),
    totals: Object.fromEntries([...keys].map((key) => [key, rub(cents(previous.totals?.[key]) + cents(page.totals?.[key]))])),
    deductions: [...deductions].map(([label, item]) => ({ label, amount: rub(item.amount), count: item.count })),
  };
}
