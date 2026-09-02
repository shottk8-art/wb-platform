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

  // Возвращает первый доступный магазин пользователя (свой или тот, куда
  // его добавили как участника); если нет ни одного — создаёт свой.
  async function ensureShop(defaultName) {
    const session = await getSession();
    if (!session) return null;

    const shops = await listMyShops();
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

  // Свои магазины + магазины, куда пользователя добавили участником.
  // ВАЖНО: явный фильтр по owner_id обязателен для "своих" — RLS-политика
  // на чтение shops разрешает читать И свои магазины, И любые чужие с
  // share_enabled = true (это нужно для публичной витрины) — без этого
  // фильтра пользователю мог бы достаться чужой магазин.
  async function listMyShops() {
    const session = await getSession();
    if (!session) return [];
    const [{ data: owned, error: e1 }, { data: memberRows, error: e2 }] = await Promise.all([
      sb().from("shops").select("*").eq("owner_id", session.user.id).order("created_at"),
      sb().from("shop_members").select("shops(*)").eq("user_id", session.user.id),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;
    const merged = [...(owned || [])];
    const seen = new Set(merged.map((s) => s.id));
    for (const row of memberRows || []) {
      const s = row.shops;
      if (s && !seen.has(s.id)) { merged.push(s); seen.add(s.id); }
    }
    return merged;
  }

  // ---- Участники магазина (доступ по нику в Telegram) ----
  function normalizeUsername(username) {
    return String(username || "").trim().replace(/^@/, "").toLowerCase();
  }

  async function listMembers(shopId) {
    const { data, error } = await sb()
      .from("shop_members")
      .select("*")
      .eq("shop_id", shopId)
      .order("invited_at");
    if (error) throw error;
    return data || [];
  }

  async function addMember(shopId, username) {
    const telegram_username = normalizeUsername(username);
    if (!telegram_username) throw new Error("Введите ник в Telegram");
    const { data, error } = await sb()
      .from("shop_members")
      .insert({ shop_id: shopId, telegram_username })
      .select()
      .single();
    if (error) {
      if (error.code === "23505") throw new Error("Этот ник уже добавлен");
      throw error;
    }
    return data;
  }

  async function removeMember(memberId) {
    const { error } = await sb().from("shop_members").delete().eq("id", memberId);
    if (error) throw error;
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

  // Удаляет магазин и каскадно все его данные (отчёты, продажи,
  // себестоимость — foreign key ... on delete cascade в schema.sql).
  async function deleteShop(shopId) {
    const { error } = await sb().from("shops").delete().eq("id", shopId);
    if (error) throw error;
  }

  window.WBAuth = {
    signInWithMagicLink, signInWithTelegram, signOut, getSession,
    ensureShop, listMyShops, createShop, updateShop, deleteShop, slugify,
    listMembers, addMember, removeMember,
  };
})();
