// Кнопка "Задать вопрос": сохраняем вопрос в БД (от имени текущего
// пользователя, через RLS) и дублируем его в Telegram админу через
// Edge Function (у неё есть доступ к TELEGRAM_BOT_TOKEN, у клиента — нет).
(function () {
  const sb = () => window.supabaseClient;

  async function submitQuestion(message) {
    const text = String(message || "").trim();
    if (!text) throw new Error("Введите вопрос");

    const { data: sessionData } = await sb().auth.getSession();
    const session = sessionData.session;
    if (!session) throw new Error("Не авторизован");

    const meta = session.user.user_metadata || {};
    const contact = meta.full_name || (meta.telegram_username ? "@" + meta.telegram_username : session.user.email);

    const { error: insertErr } = await sb()
      .from("support_questions")
      .insert({ user_id: session.user.id, message: text, contact });
    if (insertErr) throw insertErr;

    // Доставка в Telegram не критична для успеха операции — вопрос уже
    // сохранён и будет виден в админке, даже если это упадёт.
    try {
      await sb().functions.invoke("notify-question", { body: { message: text } });
    } catch (e) {
      console.error("notify-question failed", e);
    }
  }

  window.WBSupport = { submitQuestion };
})();
