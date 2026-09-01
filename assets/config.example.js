// Скопируйте этот файл в assets/config.js и подставьте свои значения
// из Supabase → Project Settings → API.
// ВАЖНО: anon key — публичный ключ, его можно спокойно класть в статический
// фронтенд: реальная защита данных обеспечивается политиками RLS в базе
// (см. supabase/schema.sql), а не секретностью этого ключа.

window.WB_CONFIG = {
  SUPABASE_URL: "https://ВАШ-ПРОЕКТ.supabase.co",
  SUPABASE_ANON_KEY: "ВАШ-ANON-KEY",
};
