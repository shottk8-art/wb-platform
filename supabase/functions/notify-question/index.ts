// Дублирует вопрос пользователя (уже сохранённый в support_questions клиентом
// напрямую через RLS) в Telegram админу. Требует авторизации — вызывается
// через supabase.functions.invoke(), который сам подставляет JWT текущего
// пользователя в Authorization header.
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Не авторизован");

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) throw new Error("Не авторизован");

    const { message } = await req.json();
    if (!message || typeof message !== "string" || !message.trim()) {
      throw new Error("Пустой вопрос");
    }

    const meta = userData.user.user_metadata || {};
    const who =
      meta.full_name ||
      (meta.telegram_username ? "@" + meta.telegram_username : userData.user.email);

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const chatId = Deno.env.get("ADMIN_TELEGRAM_CHAT_ID");
    if (botToken && chatId) {
      const text = `❓ Новый вопрос от ${who}\n\n${message.trim()}`;
      const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      if (!tgRes.ok) {
        // Вопрос уже сохранён в БД клиентом до вызова этой функции — сбой
        // отправки в Telegram не должен выглядеть как сбой всей операции,
        // но админ должен об этом узнать через логи функции.
        console.error("Telegram sendMessage failed", await tgRes.text());
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
