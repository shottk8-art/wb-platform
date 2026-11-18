// Данные для админки: доступ проверяется на сервере (is_admin() внутри
// admin_overview() и RLS-политик support_questions) — эти функции просто
// оборачивают вызовы, сами по себе прав не дают.
(function () {
  const sb = () => window.supabaseClient;

  async function isAdmin() {
    const { data, error } = await sb().rpc("is_admin");
    if (error) throw error;
    return !!data;
  }

  async function getOverview() {
    const { data, error } = await sb().rpc("admin_overview");
    if (error) throw error;
    return data || { users: [], shops: [] };
  }

  async function listQuestions() {
    const { data, error } = await sb()
      .from("support_questions")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function setQuestionStatus(id, status) {
    const { error } = await sb().from("support_questions").update({ status }).eq("id", id);
    if (error) throw error;
  }

  // Бакет приватный — прямой URL не работает, нужна подписанная ссылка
  // с ограниченным временем жизни (RLS: доступна автору вопроса и админу).
  async function getAttachmentUrl(path) {
    const { data, error } = await sb().storage.from("question-photos").createSignedUrl(path, 3600);
    if (error) throw error;
    return data.signedUrl;
  }

  async function getSectionAccess(userId) {
    const {data,error}=await sb().rpc('admin_user_section_access',{p_user_id:userId});
    if(error)throw error;return data;
  }
  async function saveSectionAccess(userId,sections) {
    const {data,error}=await sb().rpc('admin_save_section_access',{p_user_id:userId,p_sections:sections});
    if(error)throw error;return data;
  }
  window.WBAdmin = { isAdmin, getOverview, listQuestions, setQuestionStatus, getAttachmentUrl, getSectionAccess, saveSectionAccess };
})();
