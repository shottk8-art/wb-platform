// Единая точка инициализации Supabase-клиента для всех страниц.
(function () {
  if (!window.WB_CONFIG) {
    console.error(
      "Не найден assets/config.js. Скопируйте config.example.js в config.js и впишите свои ключи Supabase."
    );
    return;
  }
  window.supabaseClient = window.supabase.createClient(
    window.WB_CONFIG.SUPABASE_URL,
    window.WB_CONFIG.SUPABASE_ANON_KEY
  );
})();
