(function () {
  const el = id => document.getElementById(id);
  let context = null, generation = 0, connection = null, busy = false;
  const date = value => value ? new Date(value).toLocaleString('ru-RU') : '—';
  async function request(action, payload, ctx) {
    const session = await window.WBAuth.getSession();
    if (!session) throw new Error('Сессия истекла. Войдите заново');
    let response;
    try {
      response = await fetch(window.WB_CONFIG.SUPABASE_URL + '/functions/v1/wb-api', {
        method:'POST', cache:'no-store', signal:AbortSignal.timeout(55000),
        headers:{Authorization:'Bearer ' + session.access_token, apikey:window.WB_CONFIG.SUPABASE_ANON_KEY, 'Content-Type':'application/json'},
        body:JSON.stringify({...payload, action, shop_id:ctx.shopId}),
      });
    } catch { throw new Error('Не удалось связаться с сервером. Проверьте интернет и попробуйте ещё раз'); }
    let result;
    try { result = await response.json(); } catch { throw new Error('Сервер не вернул результат. Попробуйте ещё раз'); }
    if (!response.ok) throw new Error(result.error || 'Не удалось выполнить запрос');
    return result;
  }
  function message(value, error = false) { el('wbApiMessage').textContent = value; el('wbApiMessage').dataset.tone = error ? 'error' : 'neutral'; }
  function render() {
    el('wbApiConnectBtn').disabled = busy || !el('wbApiKey').value.trim();
    el('wbApiCheckBtn').disabled = busy || !connection;
    el('wbApiDisconnectBtn').disabled = busy || !connection;
    el('wbApiCheckBtn').hidden = !connection;
    el('wbApiDisconnectBtn').hidden = !connection;
    el('wbApiKey').disabled = busy;
    el('wbApiConnectBtn').textContent = connection ? 'Заменить ключ и проверить' : 'Сохранить и проверить';
    el('wbApiConnectionStatus').textContent = connection
      ? `Подключён продавец WB: ${connection.seller_name}. Персональный ключ. Проверено: ${date(connection.checked_at)}${connection.expires_at ? `. Действует до ${date(connection.expires_at)}` : ''}`
      : 'API ещё не подключён к этому магазину';
    el('wbApiConnectionStatus').dataset.connected = String(!!connection);
  }
  async function run(action, payload = {}) {
    if (busy || !context?.allowed) return;
    const current = ++generation, ctx = {...context};
    busy = true; render(); message('Проверяем подключение…');
    try {
      const result = await request(action, payload, ctx);
      if (current !== generation) return;
      connection = result.connection || null;
      message(action === 'disconnect' ? 'API отключён. Отчёты из файлов сохранены.' : 'Ключ проверен. Месяц загрузки выбирается в обзоре магазина.');
      window.WBApiCabinet?.reload();
    } catch (error) { if (current === generation) message(error.message, true); }
    finally { if (current === generation) { busy = false; render(); } }
  }
  async function setContext(next) {
    if (context?.shopId === next.shopId && context?.allowed === next.allowed) return;
    context = {...next}; const current = ++generation;
    connection = null; busy = false;
    el('wbApiKey').value = ''; el('secWbApi').hidden = !next.allowed;
    el('wbApiShopName').textContent = next.name || ''; message(''); render();
    if (!next.allowed) return;
    busy = true; render();
    try {
      const result = await request('status', {}, next);
      if (current === generation) connection = result.connection;
    } catch (error) { if (current === generation) message(error.message, true); }
    finally { if (current === generation) { busy = false; render(); } }
  }
  el('wbApiKey').addEventListener('input', render);
  el('wbApiConnectBtn').addEventListener('click', () => {
    const api_key = el('wbApiKey').value.trim(); el('wbApiKey').value = '';
    if (api_key) run('connect', {api_key});
  });
  el('wbApiCheckBtn').addEventListener('click', () => run('check'));
  el('wbApiDisconnectBtn').addEventListener('click', () => {
    if (context?.allowed && confirm(`Отключить API от магазина «${context.name}»? Ключ и API-выгрузки будут удалены. Отчёты из файлов сохранятся.`)) run('disconnect');
  });
  window.WBApi = {setContext, cabinet: async (action, month, refresh = false, payload = {}) => {
    if (!context?.allowed) throw new Error('API недоступен');
    return request(action, {...payload, month, refresh}, {...context});
  }};
})();
