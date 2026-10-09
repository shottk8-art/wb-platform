(function () {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => value == null ? '—' : Number(value).toLocaleString('ru-RU', {maximumFractionDigits:2}) + ' ₽';
  const number = value => value == null ? '—' : Number(value).toLocaleString('ru-RU');
  let context = null, epoch = 0, timer = null, busy = false, cabinet = null;
  const now = new Date(), closed = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const defaultMonth = `${closed.getFullYear()}-${String(closed.getMonth() + 1).padStart(2,'0')}`;
  el('apiCabinetMonth').value = defaultMonth;
  el('apiCabinetMonth').max = defaultMonth;
  const oldest = new Date(now.getTime() - 365 * 86400000);
  oldest.setMonth(oldest.getMonth() + 1);
  el('apiCabinetMonth').min = `${oldest.getFullYear()}-${String(oldest.getMonth() + 1).padStart(2,'0')}`;
  const status = (message, error = false) => { el('apiCabinetStatus').textContent = message; el('apiCabinetStatus').dataset.error = String(error); };
  function render() {
    const loading = cabinet?.job?.status === 'loading';
    el('apiCabinetSync').disabled = busy || loading;
    el('apiCabinetRefresh').disabled = busy || loading;
    el('apiCabinetRefresh').hidden = !cabinet?.complete;
    el('apiCabinetMonth').disabled = busy;
    el('apiCabinetSync').textContent = loading ? 'Загрузка на сервере' : cabinet?.job?.status === 'error' ? 'Повторить загрузку' : cabinet?.complete ? 'Показать сохранённые данные' : 'Загрузить данные';
    const sources = cabinet?.sources || {};
    const labels = {downloaded:'Получено из API',loading:'Загружается',pending:'Ожидает загрузки',confirmed_by_user:'Подтверждено владельцем',needs_confirmation:'Нужно подтверждение'};
    el('apiCabinetSources').innerHTML = [['finance','Финансы'],['orders','Заказы'],['ads','Внутренняя реклама'],['media','WB Media']].map(([key,label]) => {
      const state = sources[key]?.status || 'pending';
      return `<li><span>${label}</span><strong data-state="${esc(state)}">${esc(labels[state] || 'Требует проверки')}</strong></li>`;
    }).join('');
    const f = cabinet?.finance, orders = sources.orders?.status === 'downloaded' ? sources.orders : null;
    const ads = sources.ads?.status === 'downloaded' ? sources.ads.totals : null;
    const balance = ads ? ads['Баланс']?.amount ?? 0 : null;
    const media = ['confirmed_by_user','downloaded'].includes(sources.media?.status) ? sources.media.amount : null;
    const metrics = [
      ['Сумма заказов', money(orders?.amount), 'Воронка продаж · по дате заказа'],
      ['Продажи по финансовому отчёту', money(f?.retailAmount), 'Продажи минус возвраты · цена из финансовой детализации'],
      ['Внутренняя реклама', money(balance), 'Списания с баланса · кэшбэк отдельно'],
      ['WB Media', money(media), media == null ? 'Нет подтверждённой суммы' : sources.media.status === 'confirmed_by_user' ? 'Подтверждено владельцем, не API' : 'Получено из API'],
      ['Заказали', number(orders?.count) + (orders ? ' шт.' : ''), 'Все товары, включая удалённые карточки'],
      ['Выкупили', f ? number(f.bought_qty) + ' шт.' : '—', 'Без повторного количества в корректировках'],
    ];
    el('apiCabinetMetrics').innerHTML = metrics.map(([title,value,hint])=>`<div class="kpi"><div class="api-metric-label">${title}</div><strong class="api-metric-value">${esc(value)}</strong><p class="hint">${hint}</p></div>`).join('');
    const pairs = rows => rows.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('');
    el('apiCabinetFinance').innerHTML = pairs([
      ['К перечислению за товар', money(f?.forPay)], ['Логистика', money(f?.deliveryService)], ['Хранение', money(f?.paidStorage)],
      ['Приёмка', money(f?.paidAcceptance)], ['Штрафы', money(f?.penalty)], ['Прочие удержания', money(f?.deduction)],
    ]);
    el('apiCabinetAds').innerHTML = ads && Object.keys(ads).length ? pairs(Object.entries(ads).map(([type,data])=>[type,money(data.amount)])) : '<p class="hint">Рекламные списания пока не получены.</p>';
    const missing = cabinet?.missing_costs?.length || 0;
    el('apiCabinetReadiness').innerHTML = [
      cabinet?.finance ? missing ? `Себестоимость не заполнена: ${missing} товаров с выкупами.` : 'Себестоимость заполнена для товаров с выкупами.' : 'Себестоимость проверим после загрузки финансов.',
      `Ставка налога: ${number(cabinet?.shop?.tax_rate)}%. Проверьте в настройках.`,
      'Операционные расходы и внешнее продвижение вводятся вручную в файловом обзоре.',
      sources.ads?.undated ? `Списания без даты: ${sources.ads.undated}. Не распределены по месяцам.` : 'Реклама распределяется по дате списания, время Москвы.',
    ].map(s=>`<li>${esc(s)}</li>`).join('');
    el('apiCabinetWarning').textContent = 'Чистая прибыль и общий ДРР пока не рассчитаны: сверяем финансовые корректировки, кэшбэк и базу суммы заказов. Данные API не заменяют загруженные файлы и не публикуются в витрине.';
    const products = [...(cabinet?.products || [])].sort((a,b)=>Number(b.orders_amount || 0)-Number(a.orders_amount || 0));
    el('apiCabinetProducts').innerHTML = products.length ? products.map(p=>`<tr><td><strong>${esc(p.name || p.article)}</strong><small>${esc(p.article)}</small></td><td>${number(p.orders_count)}</td><td>${money(p.orders_amount)}</td><td>${number(p.bought_qty)}</td><td>${money(p.for_pay)}</td><td>${Number(p.cost_price)>0 ? money(p.cost_price) : 'Не заполнена'}</td></tr>`).join('') : '<tr><td colspan="6" class="empty">Товары появятся после загрузки API.</td></tr>';
  }
  async function load(action = 'cabinet', refresh = false) {
    if (!context?.allowed || busy) return;
    const current = ++epoch, shopId = context.shopId, month = el('apiCabinetMonth').value;
    clearTimeout(timer); busy = true; render();
    status(action === 'cabinet_start' ? 'Ставим загрузку в очередь сервера…' : 'Читаем сохранённые данные…');
    try {
      const result = await window.WBApi.cabinet(action, month, refresh);
      if (current !== epoch || context.shopId !== shopId) return;
      cabinet = result.cabinet;
      const job = cabinet.job;
      if (!job) status('За этот месяц выгрузки нет. Нажмите «Загрузить данные».');
      else if (job.status === 'loading') {
        const stage = {finance:'финансы',orders:'заказы',ads:'внутренняя реклама'}[job.stage] || 'финансы';
        status(`Загружаются ${stage}. Сохранено ${number(job.row_count)} финансовых операций. Можно закрыть страницу.${job.error_message ? ' Последняя попытка: ' + job.error_message : ''}`);
      } else if (job.status === 'error') status(job.error_message || 'Загрузка остановлена. Проверьте ключ и повторите.', true);
      else status(`${cabinet.complete ? 'Выгрузка готова' : 'Получена часть источников'} · ${new Date(job.updated_at).toLocaleString('ru-RU')}.`);
    } catch (error) { if (current === epoch) status(error.message, true); }
    finally {
      if (current === epoch) { busy = false; render(); if (cabinet?.job?.status === 'loading') timer = setTimeout(()=>load(),15000); }
    }
  }
  function setContext(next) {
    if (context?.shopId === next.shopId && context?.allowed === next.allowed) return;
    context = {...next}; ++epoch; clearTimeout(timer); busy = false; cabinet = null;
    el('secApiCabinet').hidden = !next.allowed;
    el('apiCabinetNav').hidden = !next.allowed;
    el('apiCabinetMonth').value = defaultMonth;
    status(''); render();
    if (next.allowed) load();
  }
  el('apiCabinetMonth').addEventListener('change',()=>{ cabinet = null; render(); load(); });
  el('apiCabinetSync').addEventListener('click',()=>load('cabinet_start'));
  el('apiCabinetRefresh').addEventListener('click',()=>load('cabinet_start',true));
  window.WBApiCabinet = {setContext, reload:()=>load()};
})();
