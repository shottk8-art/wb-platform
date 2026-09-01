// Авторизация по magic link (без паролей) + создание/получение "своего" магазина.
(function () {
  const sb = () => window.supabaseClient;

  function slugify(name) {
    const translit = {
      а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",
      к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",
      х:"h",ц:"c",ч:"ch",ш:"sh",щ:"sch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya"
    };
    return name
      .toLowerCase()
      .split("")
      .map((ch) => translit[ch] ?? ch)
      .join("")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "shop";
  }

  async function signInWithMagicLink(email) {
    const redirectTo = window.location.origin + "/app.html";
    const { error } = await sb().auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
    if (error) throw error;
  }

  // tgUser — объект, который Telegram Login Widget передаёт в data-onauth
  // (id, first_name, last_name, username, photo_url, auth_date, hash).
  async function signInWithTelegram(tgUser) {
    const res = await fetch(window.WB_CONFIG.SUPABASE_URL + "/functions/v1/telegram-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tgUser),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Не удалось войти через Telegram");

    const { error } = await sb().auth.verifyOtp({ token_hash: body.token_hash, type: body.type });
    if (error) throw error;
  }

  async function signOut() {
    await sb().auth.signOut();
    window.location.href = "/index.html";
  }

  async function getSession() {
    const { data } = await sb().auth.getSession();
    return data.session;
  }

  // Возвращает первый магазин пользователя; если магазинов нет — создаёт.
  async function ensureShop(defaultName) {
    const session = await getSession();
    if (!session) return null;

    const { data: shops, error } = await sb()
      .from("shops")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw error;

    if (shops && shops.length) return shops[0];

    const name = defaultName || "Мой магазин";
    let slug = slugify(name);
    // на случай коллизии slug — добавим короткий суффикс
    const suffix = Math.random().toString(36).slice(2, 6);
    const { data: created, error: createErr } = await sb()
      .from("shops")
      .insert({ owner_id: session.user.id, name, slug: `${slug}-${suffix}` })
      .select()
      .single();
    if (createErr) throw createErr;
    return created;
  }

  async function listMyShops() {
    const { data, error } = await sb().from("shops").select("*").order("created_at");
    if (error) throw error;
    return data;
  }

  async function createShop(name) {
    const session = await getSession();
    if (!session) throw new Error("Не авторизован");
    const suffix = Math.random().toString(36).slice(2, 6);
    const { data, error } = await sb()
      .from("shops")
      .insert({ owner_id: session.user.id, name, slug: `${slugify(name)}-${suffix}` })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function updateShop(shopId, patch) {
    const { data, error } = await sb().from("shops").update(patch).eq("id", shopId).select().single();
    if (error) throw error;
    return data;
  }

  window.WBAuth = { signInWithMagicLink, signInWithTelegram, signOut, getSession, ensureShop, listMyShops, createShop, updateShop, slugify };
})();
