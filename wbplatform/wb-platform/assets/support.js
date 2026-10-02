// Кнопка "Задать вопрос": сохраняем вопрос в БД (от имени текущего
// пользователя, через RLS), при наличии — загружаем фото в приватный
// бакет question-photos, и дублируем всё в Telegram админу через
// Edge Function (у неё есть доступ к TELEGRAM_BOT_TOKEN, у клиента — нет).
(function () {
  const sb = () => window.supabaseClient;

  const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // синхронно с file_size_limit бакета
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

  function validatePhoto(file) {
    if (!ALLOWED_TYPES.includes(file.type)) throw new Error("Можно прикрепить только изображение (JPG, PNG, WEBP, GIF)");
    if (file.size > MAX_PHOTO_BYTES) throw new Error("Файл слишком большой — максимум 8 МБ");
  }

  async function submitQuestion(message, photoFile) {
    const text = String(message || "").trim();
    if (!text) throw new Error("Введите вопрос");

    const { data: sessionData } = await sb().auth.getSession();
    const session = sessionData.session;
    if (!session) throw new Error("Не авторизован");

    const meta = session.user.user_metadata || {};
    const contact = meta.full_name || (meta.telegram_username ? "@" + meta.telegram_username : session.user.email);

    let attachment_path = null;
    if (photoFile) {
      validatePhoto(photoFile);
      const ext = (photoFile.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const path = `${session.user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await sb().storage
        .from("question-photos")
        .upload(path, photoFile, { contentType: photoFile.type });
      if (upErr) throw upErr;
      attachment_path = path;
    }

    const { error: insertErr } = await sb()
      .from("support_questions")
      .insert({ user_id: session.user.id, message: text, contact, attachment_path });
    if (insertErr) throw insertErr;

    // Доставка в Telegram не критична для успеха операции — вопрос уже
    // сохранён и будет виден в админке, даже если это упадёт.
    try {
      await sb().functions.invoke("notify-question", { body: { message: text, attachment_path } });
    } catch (e) {
      console.error("notify-question failed", e);
    }
  }

  window.WBSupport = { submitQuestion, validatePhoto, MAX_PHOTO_BYTES };
})();
