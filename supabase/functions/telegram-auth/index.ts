// Проверяет подпись данных от Telegram Login Widget и выдаёт Supabase
// magic-link токен, который фронтенд сразу же обменивает на сессию
// (см. assets/auth.js → signInWithTelegram). Письмо никуда не уходит —
// это замена email-логина на вход через Telegram.
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(input: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
}

async function hmacSha256Hex(keyBytes: ArrayBuffer, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toHex(sig);
}

// https://core.telegram.org/widgets/login#checking-authorization
async function verifyTelegramAuth(fields: Record<string, unknown>, botToken: string): Promise<boolean> {
  const { hash, ...rest } = fields;
  if (typeof hash !== "string") return false;

  const dataCheckString = Object.keys(rest)
    .filter((k) => rest[k] !== undefined && rest[k] !== null)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join("\n");

  const secretKey = await sha256(botToken);
  const computed = await hmacSha256Hex(secretKey, dataCheckString);
  return computed === hash;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN не настроен на сервере");

    const payload = await req.json();
    if (!payload || typeof payload.id === "undefined") {
      throw new Error("Некорректные данные от Telegram");
    }

    const ok = await verifyTelegramAuth(payload, botToken);
    if (!ok) {
      return new Response(JSON.stringify({ error: "Подпись Telegram не прошла проверку" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authDateMs = Number(payload.auth_date) * 1000;
    if (!authDateMs || Date.now() - authDateMs > 24 * 60 * 60 * 1000) {
      return new Response(JSON.stringify({ error: "Данные входа устарели, попробуйте войти ещё раз" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const telegramId = String(payload.id);
    const email = `tg${telegramId}@telegram.wbplatform.local`;
    const displayName =
      [payload.first_name, payload.last_name].filter(Boolean).join(" ") ||
      payload.username ||
      `Telegram ${telegramId}`;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: {
        data: {
          telegram_id: telegramId,
          telegram_username: payload.username ?? null,
          full_name: displayName,
          avatar_url: payload.photo_url ?? null,
        },
      },
    });
    if (error) throw error;

    // Разрешаем ожидающие приглашения: если владелец другого магазина уже
    // добавил этот ник в shop_members (user_id ещё пуст), привязываем его
    // к только что вошедшему пользователю. Не критично для входа —
    // ошибку здесь не считаем фатальной.
    const username = typeof payload.username === "string" ? payload.username.trim().toLowerCase() : null;
    if (username) {
      try {
        await admin
          .from("shop_members")
          .update({ user_id: data.user.id })
          .eq("telegram_username", username)
          .is("user_id", null);
      } catch (_e) {
        // молча игнорируем — вход важнее
      }
    }

    return new Response(
      JSON.stringify({
        token_hash: data.properties.hashed_token,
        type: data.properties.verification_type,
        email,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
